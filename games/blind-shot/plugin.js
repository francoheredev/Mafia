// games/blind-shot/plugin.js
// Punto de entrada del plugin de Blind Shot: junta la lógica pura
// (logic.js) y arma el objeto que la plataforma necesita —
// socketHandlers para los eventos custom del juego, más los hooks del
// contrato de plugin (onReconnect, remapPlayerId, onKick, chatChannels,
// staticRoutes) — y lo registra con registerGame(...). server.js NUNCA
// importa nada de acá directamente: solo hace require("./games"), que a
// su vez requiere este archivo por su efecto secundario (el registerGame
// de más abajo).

const { registerGame } = require("../../platform/core/registry");
const { pushHistory, publicPlayerList } = require("../../platform/core/rooms");
const {
  MIN_PLAYERS,
  MAX_PLAYERS,
  ARENA_HALF_WIDTH,
  ARENA_HALF_HEIGHT,
  clampToZone,
  spawnPositions,
  createGameState,
  startMovementPhase,
  blindShotRemapPlayerId,
  blindShotOnReconnect,
  blindShotOnKick,
} = require("./logic");

// --- Handlers custom de Blind Shot (game:start, round:submit,
//     round:advance, game:restart), despachados por
//     platform/core/connection.js según room.gameId — ver contrato de
//     plugin. ctx = { io, socket, room, roomCode }.
const blindShotSocketHandlers = {
  // --- La pantalla arranca la partida: se spawnea a todos en la arena ---
  "game:start": (ctx, _data, ack) => {
    const { io, socket, room, roomCode } = ctx;

    if (socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede empezar la partida." });
      return;
    }

    const connectedIds = Object.entries(room.players)
      .filter(([, p]) => p.connected)
      .map(([id]) => id);

    if (connectedIds.length < MIN_PLAYERS || connectedIds.length > MAX_PLAYERS) {
      ack?.({
        ok: false,
        error: `Se necesitan entre ${MIN_PLAYERS} y ${MAX_PLAYERS} jugadores conectados (hay ${connectedIds.length}).`,
      });
      return;
    }

    const positions = spawnPositions(connectedIds.length);
    room.gameState.players = {};
    connectedIds.forEach((id, i) => {
      room.gameState.players[id] = { x: positions[i].x, y: positions[i].y, aim: 0, submission: null };
    });
    // getAliveIds (logic.js) filtra room.players por `alive` sin volver a
    // mirar gameState — así que acá hay que dejar alive:false explícito
    // para cualquiera que NO haya entrado a esta partida (ej. alguien que
    // se unió y se desconectó antes de que la pantalla arrancara): su
    // `alive` por default sigue en true desde player:join, y sin este
    // paso quedaría "vivo" para el juego sin tener una entrada en
    // gameState.players, lo que rompe el loop de ronda.
    Object.keys(room.players).forEach((id) => {
      room.players[id].alive = connectedIds.includes(id);
    });
    room.gameState.zone = { halfWidth: ARENA_HALF_WIDTH, halfHeight: ARENA_HALF_HEIGHT };
    room.gameState.roundNumber = 0;
    room.started = true;
    room.history = [];

    ack?.({ ok: true });
    io.to(roomCode).emit("game:started", { playerCount: connectedIds.length });
    pushHistory(io, room, roomCode, "🎯", `La partida arrancó con ${connectedIds.length} jugadores en la arena.`);

    startMovementPhase(io, room, roomCode);
  },

  // --- El celular manda su posición + puntería al cierre de la ronda (o
  //     antes, si el jugador terminó de decidir) — nunca hay broadcast acá,
  //     es justamente la "ceguera": ni la pantalla se entera de nada hasta
  //     round:resolved. ---
  "round:submit": (ctx, data, ack) => {
    const { room, socket } = ctx;

    if (room.phase !== "round-active") {
      ack?.({ ok: false, error: "No es momento de moverse." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés actuar." });
      return;
    }
    const p = room.gameState.players[socket.id];
    if (!p) {
      ack?.({ ok: false, error: "No estás en esta partida." });
      return;
    }
    if (p.submission) {
      ack?.({ ok: false, error: "Ya mandaste tu jugada esta ronda." });
      return;
    }

    const { x, y, angle } = data || {};
    if (typeof x !== "number" || typeof y !== "number" || Number.isNaN(x) || Number.isNaN(y)) {
      ack?.({ ok: false, error: "Posición inválida." });
      return;
    }

    // El servidor re-clampea a la zona vigente — nunca confía en el clamp
    // que ya hizo el cliente en vivo.
    const clamped = clampToZone(x, y, room.gameState.zone.halfWidth, room.gameState.zone.halfHeight);
    p.submission = {
      x: clamped.x,
      y: clamped.y,
      angle: typeof angle === "number" && !Number.isNaN(angle) ? angle : null,
    };

    ack?.({ ok: true });
  },

  // --- La pantalla corta antes de tiempo la red de seguridad de la
  //     revelación y arranca la próxima ronda ya mismo ---
  "round:advance": (ctx, _data, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede avanzar de fase." });
      return;
    }
    if (room.phase === "reveal") {
      clearTimeout(room.gameState.round?.timer);
      startMovementPhase(io, room, roomCode);
      ack?.({ ok: true });
    } else {
      // A propósito no hay rama para "round-active" (la ronda la corta su
      // propio timer, nunca un botón) ni "game-over" (ahí termina la
      // partida, no hay próxima fase a la que avanzar).
      ack?.({ ok: false, error: "No hay nada para avanzar ahora." });
    }
  },

  // --- La pantalla reinicia la partida en la MISMA sala una vez terminada
  //     (mismo patrón que Mafia): vuelve todo al lobby sin recrear la sala
  //     ni volver a escanear el QR. ---
  "game:restart": (ctx, _data, ack) => {
    const { io, room, roomCode } = ctx;
    if (ctx.socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede reiniciar la partida." });
      return;
    }
    if (room.phase !== "game-over") {
      ack?.({ ok: false, error: "La partida no terminó todavía." });
      return;
    }

    clearTimeout(room.gameState.round?.timer);

    room.started = false;
    room.phase = "lobby";
    room.gameState.zone = { halfWidth: ARENA_HALF_WIDTH, halfHeight: ARENA_HALF_HEIGHT };
    room.gameState.roundNumber = 0;
    room.gameState.round = null;
    room.gameState.players = {};
    room.history = []; // partida nueva, log nuevo

    Object.keys(room.players).forEach((id) => {
      if (room.players[id].kicked) delete room.players[id];
      else room.players[id].alive = true;
    });

    ack?.({ ok: true });
    io.to(roomCode).emit("game:restarted");
    io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
  },
};

// --- Chat: un solo canal "general", abierto a todos los conectados en
//     cualquier momento (a diferencia de Mafia, acá no hay un bando propio
//     de "eliminados" con secretos que discutir entre ellos — un jugador
//     caído sigue siendo, de ahí en más, un espectador más de la misma
//     conversación). Implementa el campo chatChannels del contrato de
//     plugin. ---
const blindShotChatChannels = [
  {
    id: "general",
    canSend: () => true,
    recipients: (room) => Object.keys(room.players),
  },
];

module.exports = registerGame({
  id: "blind-shot",
  createGameState,
  socketHandlers: blindShotSocketHandlers,
  onReconnect: blindShotOnReconnect,
  remapPlayerId: blindShotRemapPlayerId,
  onKick: blindShotOnKick,
  chatChannels: blindShotChatChannels,
  staticRoutes: [],
  publicDir: __dirname + "/../../public/games/blind-shot",
});
