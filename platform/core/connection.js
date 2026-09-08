// platform/core/connection.js
// Despacho genérico de los eventos "custom" que cada plugin declara en
// `socketHandlers` (ver contrato de plugin). La plataforma no sabe qué
// significa "night:action" o cualquier otro nombre de evento — solo sabe
// que, para el socket que lo mandó, hay que mirar en qué sala está
// (`socket.data.roomCode`), de qué juego es esa sala (`room.gameId`) y
// buscar el handler correspondiente en el registry.
//
// El aislamiento entre juegos concurrentes en el mismo `io` no viene de un
// namespace de socket.io ni de un prefijo literal en el nombre del evento:
// viene de que el despacho SIEMPRE resuelve el handler a través de
// room.gameId en el momento de la llamada. Dos plugins pueden declarar el
// mismo nombre de evento (ej. los dos usan "start") sin pisarse nunca,
// porque cada socket solo puede disparar el handler del plugin dueño de la
// sala en la que está en ese momento.
const { randomUUID } = require("crypto");
const { rooms, publicPlayerList, capPush, generateRoomCode } = require("./rooms");
const { getGame, listGames } = require("./registry");

// Cada jugador recibe uno de estos como avatar al unirse. Nota de alcance:
// el contrato de plugin (ver plan de migración) no define ningún hook para
// que un juego provea su propio catálogo de íconos, así que por ahora esto
// queda como comportamiento genérico de la plataforma — cualquier juego
// nuevo hereda este mismo pool de animalitos hasta que eso se revise.
const PLAYER_ICONS = [
  "🦊", "🐻", "🦉", "🦌", "🦔", "🐿️", "🦇", "🐗", "🦅", "🐢",
  "🦆", "🐸", "🦋", "🐝", "🦎", "🐍", "🦂", "🐌", "🦡", "🐇",
  "🦃", "🦩", "🦚", "🦜", "🐦", "🦢", "🐴", "🐐", "🐑", "🐖",
];
function pickIcon(room) {
  const used = new Set(Object.values(room.players).map((p) => p.icon));
  const available = PLAYER_ICONS.filter((i) => !used.has(i));
  const pool = available.length > 0 ? available : PLAYER_ICONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Unión de todos los nombres de evento custom que declaró CUALQUIER plugin
// registrado — se recalcula en cada conexión porque es barato y así no hay
// que preocuparse por el orden entre registerGame(...) y el primer socket
// que se conecta.
function collectCustomEventNames() {
  const names = new Set();
  listGames().forEach((plugin) => {
    Object.keys(plugin.socketHandlers || {}).forEach((name) => names.add(name));
  });
  return names;
}

// Engancha, sobre un socket recién conectado, un socket.on(...) genérico por
// cada evento custom declarado por algún plugin. Se llama una sola vez por
// conexión, desde el io.on("connection") de la plataforma.
function attachPluginEvents(io, socket) {
  collectCustomEventNames().forEach((eventName) => {
    socket.on(eventName, (data, ack) => {
      const { roomCode } = socket.data;
      const room = roomCode && rooms[roomCode];
      if (!room) {
        ack?.({ ok: false, error: "La sala ya no existe." });
        return;
      }
      const plugin = getGame(room.gameId);
      const handler = plugin?.socketHandlers?.[eventName];
      if (!handler) {
        ack?.({ ok: false, error: "Evento no soportado en este juego." });
        return;
      }
      handler({ io, socket, room, roomCode }, data, ack);
    });
  });
}

// Cada jugador se identifica por su socket.id, que cambia al reconectar —
// así que un rejoin exitoso tiene que "mudar" el id viejo al nuevo en todo
// lo que pueda referenciarlo. La parte genérica (quién es el jugador, y sus
// mensajes de chat ya mandados) la resuelve la plataforma sin saber nada
// del juego; lo que sea semánticamente propio de cada juego (asignación de
// roles, votos en curso, etc.) se delega al hook remapPlayerId(gameState,
// chat, oldId, newId) del plugin dueño de la sala. Los canales de chat de
// room.chat ya son genéricos (sus claves salen de plugin.chatChannels al
// crear la sala — ver screen:create), así que recorrer Object.keys(room.chat)
// alcanza para remapear el senderId de los mensajes ya mandados sin que la
// plataforma necesite conocer el nombre de ningún canal en particular.
function remapPlayerId(room, oldId, newId, plugin) {
  room.players[newId] = room.players[oldId];
  delete room.players[oldId];

  Object.keys(room.chat || {}).forEach((channel) => {
    (room.chat[channel] || []).forEach((msg) => {
      if (msg.senderId === oldId) msg.senderId = newId;
    });
  });

  plugin?.remapPlayerId?.(room.gameState, room.chat, oldId, newId);
}

// Engancha los eventos de reconexión, 100% genéricos: la plataforma solo
// sabe buscar la sesión por token, mudar el id de socket viejo al nuevo, y
// delegarle al plugin dueño de la sala qué mandarle de vuelta al jugador
// reconectado (onReconnect) — no conoce fases, roles ni ningún concepto de
// un juego en particular.
function attachConnectionHandlers(io, socket) {
  // --- La pantalla compartida crea una sala nueva ---
  socket.on("screen:create", (data) => {
    const gameId = data?.gameId;
    const plugin = getGame(gameId);
    if (!plugin) {
      // No hay default (ver plan de migración, paso 12): un cliente tiene
      // que mandar siempre el gameId que le corresponde a su propia
      // página — si no lo manda, o manda uno que no está registrado, no
      // hay sala que crear.
      socket.emit("screen:createError", { error: "Juego desconocido." });
      return;
    }
    const code = generateRoomCode();
    const chat = {};
    (plugin.chatChannels || []).forEach((c) => {
      chat[c.id] = [];
    });
    rooms[code] = {
      screenSocketId: socket.id,
      gameId,
      players: {},
      phase: "lobby",
      chat,
      history: [],
      gameState: plugin.createGameState ? plugin.createGameState() : {},
    };
    socket.join(code);
    socket.data.role = "screen";
    socket.data.roomCode = code;
    socket.emit("screen:created", { code });
  });

  // --- Un celular se une a una sala existente ---
  socket.on("player:join", ({ code, name }, ack) => {
    const room = rooms[code];
    if (!room) {
      ack?.({ ok: false, error: "Esa sala no existe. Revisá el código." });
      return;
    }
    if (room.started) {
      // Sin esto, alguien que se une después de repartidos los roles queda
      // "adentro" pero sin rol asignado — y si termina siendo blanco de una
      // acción de otro jugador (ej. el Vidente lo investiga), el servidor
      // se cae al intentar leer un rol que no existe.
      ack?.({ ok: false, error: "La partida ya empezó — pedile al anfitrión que arranque una nueva." });
      return;
    }
    const cleanName = (name || "").trim().slice(0, 20) || "Jugador";

    const nameTaken = Object.values(room.players).some(
      (p) => p.connected && p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (nameTaken) {
      ack?.({ ok: false, error: "Ya hay alguien conectado con ese nombre en la sala." });
      return;
    }

    const token = randomUUID();
    room.players[socket.id] = {
      name: cleanName,
      connected: true,
      alive: true,
      icon: pickIcon(room),
      token,
    };
    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;

    ack?.({ ok: true, code, name: cleanName, icon: room.players[socket.id].icon, token });

    // Avisa a la pantalla (y a los demás celulares) la lista actualizada
    io.to(code).emit("lobby:update", { players: publicPlayerList(room) });
  });

  // --- La pantalla pide la lista de jugadores para el panel de expulsión ---
  socket.on("screen:getRoster", (_data, ack) => {
    const { role, roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || role !== "screen") {
      ack?.({ ok: false, error: "No autorizado." });
      return;
    }
    ack?.({
      ok: true,
      players: Object.entries(room.players).map(([id, p]) => ({
        id,
        name: p.name,
        icon: p.icon,
        connected: p.connected,
        alive: room.started ? p.alive : undefined,
      })),
    });
  });

  socket.on("player:rejoin", ({ code, token }, ack) => {
    const room = rooms[code];
    if (!room) {
      ack?.({ ok: false, error: "Esa sala ya no existe." });
      return;
    }
    const entry = Object.entries(room.players).find(([, p]) => p.token === token);
    if (!entry) {
      ack?.({ ok: false, error: "No encontramos tu sesión en esta sala." });
      return;
    }
    const [oldId, player] = entry;
    if (player.kicked) {
      ack?.({ ok: false, error: "Fuiste expulsado de esta sala." });
      return;
    }

    // Socket viejo todavía "vivo" (ej. dos pestañas con la misma sesión) —
    // lo desconectamos para que no quede un jugador fantasma.
    const oldSocket = io.sockets.sockets.get(oldId);
    if (oldSocket && oldSocket.id !== socket.id) oldSocket.disconnect(true);

    const plugin = getGame(room.gameId);
    remapPlayerId(room, oldId, socket.id, plugin);
    room.players[socket.id].connected = true;
    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;

    ack?.({ ok: true, code, name: room.players[socket.id].name, icon: room.players[socket.id].icon });

    if (!room.started) {
      io.to(code).emit("lobby:update", { players: publicPlayerList(room) });
      return;
    }

    plugin?.onReconnect?.({ io, room, roomCode: code, playerId: socket.id });
    io.to(code).emit("lobby:update", { players: publicPlayerList(room) });
  });

  // --- La pantalla expulsa a un jugador (lobby o mid-partida) --- La
  //     plataforma resuelve por sí sola el caso "todavía en el lobby"
  //     (borrarlo sin más, sin ningún concepto de juego de por medio); una
  //     vez arrancada la partida, delega en plugin.onKick(...) — ver
  //     contrato de plugin — qué significa "morir" para ese juego.
  socket.on("player:kick", ({ targetId }, ack) => {
    if (socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede expulsar." });
      return;
    }
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) {
      ack?.({ ok: false, error: "La sala ya no existe." });
      return;
    }
    ack?.(kickPlayer(io, room, roomCode, targetId));
  });

  // --- Chat: cada juego declara sus propios canales (ver plugin.chatChannels
  //     — { id, canSend, recipients }). La plataforma no sabe qué significa
  //     "fantasmas" ni ningún otro canal: solo valida que exista, le
  //     pregunta al canal si este socket puede usarlo (canSend) y le
  //     pregunta a quién entregarle el mensaje (recipients) — nunca a toda
  //     la sala, para que la pantalla compartida nunca reciba tráfico de
  //     chat y un canal restringido nunca se filtre a quien no corresponde. ---
  socket.on("chat:send", ({ channel, text }, ack) => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) {
      ack?.({ ok: false, error: "La sala ya no existe." });
      return;
    }
    const channelConfig = findChatChannel(room, channel);
    if (!channelConfig || !room.chat[channel]) {
      ack?.({ ok: false, error: "Canal de chat inválido." });
      return;
    }
    const sender = room.players[socket.id];
    if (!sender) {
      ack?.({ ok: false, error: "No estás en esta sala." });
      return;
    }
    if (!channelConfig.canSend(room, socket.id)) {
      ack?.({ ok: false, error: "No podés usar este canal de chat." });
      return;
    }
    const cleanText = (text || "").trim().slice(0, 300);
    if (!cleanText) {
      ack?.({ ok: false, error: "Escribí algo primero." });
      return;
    }

    const msg = {
      id: randomUUID(),
      senderId: socket.id,
      senderName: sender.name,
      senderIcon: sender.icon,
      text: cleanText,
      ts: Date.now(),
    };
    capPush(room.chat[channel], msg);

    ack?.({ ok: true });
    channelConfig.recipients(room).forEach((id) => io.to(id).emit("chat:message", { channel, ...msg }));
  });

  socket.on("chat:getHistory", ({ channel }, ack) => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) {
      ack?.({ ok: false, error: "La sala ya no existe." });
      return;
    }
    const channelConfig = findChatChannel(room, channel);
    if (!channelConfig || !room.chat[channel]) {
      ack?.({ ok: false, error: "Canal de chat inválido." });
      return;
    }
    if (!channelConfig.canSend(room, socket.id)) {
      ack?.({ ok: false, error: "No podés usar este canal de chat." });
      return;
    }
    ack?.({ ok: true, messages: room.chat[channel] });
  });

  // --- Historial público de la partida (pantalla y celulares) ---
  socket.on("history:get", (_data, ack) => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room) {
      ack?.({ ok: false, error: "La sala ya no existe." });
      return;
    }
    ack?.({ ok: true, entries: room.history });
  });

  socket.on("disconnect", () => {
    const { role, roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    if (role === "player" && room.players[socket.id]) {
      // No lo borramos: queda "congelado" (marcado como desconectado) en
      // vez de eliminarse, para que pueda reconectar más tarde.
      room.players[socket.id].connected = false;
      io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
    }

    if (role === "screen") {
      // Si se cae la pantalla, por ahora solo lo logueamos. Decidir más
      // adelante si la partida se recupera o se cierra la sala es una
      // decisión de plataforma, no de ningún juego en particular — queda
      // fuera de alcance de esta extracción.
      console.log(`Pantalla desconectada de la sala ${roomCode}`);
    }
  });
}

function findChatChannel(room, channelId) {
  const plugin = getGame(room.gameId);
  return (plugin?.chatChannels || []).find((c) => c.id === channelId);
}

function kickPlayer(io, room, roomCode, targetId) {
  const target = room.players[targetId];
  if (!target) return { ok: false, error: "Ese jugador no existe." };
  const targetSocket = io.sockets.sockets.get(targetId);

  if (!room.started) {
    delete room.players[targetId];
    if (targetSocket) {
      targetSocket.emit("player:kicked", { reason: "Fuiste expulsado por el anfitrión." });
      targetSocket.disconnect(true);
    }
    io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
    return { ok: true };
  }

  target.kicked = true; // para que un rejoin posterior con ese token se rechace
  const plugin = getGame(room.gameId);
  return plugin?.onKick?.({ io, room, roomCode, targetId }) || { ok: true };
}

module.exports = { attachPluginEvents, attachConnectionHandlers };
