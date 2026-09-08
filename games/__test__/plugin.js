// games/__test__/plugin.js
// Plugin trivial que existe SOLO para que tests/platform/*.js (lobby,
// reconexión, kick, chat) puedan probar la plataforma sin depender de
// ninguna lógica de Mafia. Se registra únicamente bajo NODE_ENV=test (ver
// games/index.js) — nunca en producción.
const path = require("path");
const { registerGame } = require("../../platform/core/registry");

module.exports = registerGame({
  id: "test-game",

  createGameState: () => ({}),

  // Un solo evento custom, para poder simular "la partida arrancó" sin
  // tener que inventar reglas de juego — onReconnect/onKick de la
  // plataforma solo entran a tallar en la rama "room.started".
  socketHandlers: {
    "test:start": (ctx, _data, ack) => {
      ctx.room.started = true;
      ack?.({ ok: true });
    },
  },

  // No guarda nada propio en gameState, así que no hay nada que remapear.
  remapPlayerId: () => {},

  // Le avisa al jugador reconectado que el hook se disparó — es lo único
  // que los tests de plataforma necesitan poder observar.
  onReconnect: ({ io, playerId }) => {
    io.to(playerId).emit("test:onReconnect", {});
  },

  // Igual que Mafia (player:removed), para que un test de plataforma
  // pueda esperar el mismo tipo de evento sin acoplarse a nada de Mafia.
  onKick: ({ io, room, roomCode, targetId }) => {
    delete room.players[targetId];
    io.to(roomCode).emit("player:removed", { removedIds: [targetId] });
    return { ok: true };
  },

  chatChannels: [
    {
      id: "general",
      canSend: () => true,
      recipients: (room) => Object.keys(room.players),
    },
  ],

  staticRoutes: [],
  publicDir: path.join(__dirname),
});
