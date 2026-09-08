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
const { rooms, publicPlayerList } = require("./rooms");
const { getGame, listGames } = require("./registry");

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
// chat, oldId, newId) del plugin dueño de la sala.
//
// TODO(paso 7): el recorrido de canales de chat sigue hardcodeado a
// ["general", "fantasmas"] hasta que se generalicen los canales de chat vía
// plugin.chatChannels.
function remapPlayerId(room, oldId, newId, plugin) {
  room.players[newId] = room.players[oldId];
  delete room.players[oldId];

  if (room.chat) {
    ["general", "fantasmas"].forEach((channel) => {
      (room.chat[channel] || []).forEach((msg) => {
        if (msg.senderId === oldId) msg.senderId = newId;
      });
    });
  }

  plugin?.remapPlayerId?.(room.gameState, room.chat, oldId, newId);
}

// Engancha los eventos de reconexión, 100% genéricos: la plataforma solo
// sabe buscar la sesión por token, mudar el id de socket viejo al nuevo, y
// delegarle al plugin dueño de la sala qué mandarle de vuelta al jugador
// reconectado (onReconnect) — no conoce fases, roles ni ningún concepto de
// un juego en particular.
function attachConnectionHandlers(io, socket) {
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
