// platform/core/registry.js
// Catálogo de juegos ("plugins") registrados sobre la plataforma. Cada
// juego nuevo se suma llamando registerGame(...) una vez al bootear el
// server (ver games/index.js) — la plataforma nunca conoce juegos por
// nombre, solo por lo que el plugin declara acá.

const games = {};

// Contrato completo de un plugin (ver plan de migración):
//   id, createGameState, chatChannels, socketHandlers, onReconnect,
//   remapPlayerId, onKick, staticRoutes, publicDir.
// Ningún campo es obligatorio salvo `id` — cada hook que un plugin no
// implemente simplemente no se invoca para ese juego.
function registerGame(plugin) {
  if (!plugin || !plugin.id) {
    throw new Error("registerGame: el plugin necesita un 'id'.");
  }
  games[plugin.id] = plugin;
  return plugin;
}

function getGame(id) {
  return games[id];
}

function listGames() {
  return Object.values(games);
}

module.exports = { registerGame, getGame, listGames };
