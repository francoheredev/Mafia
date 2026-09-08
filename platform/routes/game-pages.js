// platform/routes/game-pages.js
// Rutas por juego: GET /:gameId/screen y GET /:gameId/player sirven la
// pantalla/celular de ESE juego (usa plugin.publicDir, sin saber qué hay
// adentro); un gameId que no está registrado redirige al hub en vez de
// romper. También monta, para cada plugin registrado, sus estáticos
// (screen.js, player.js, *.css, etc.) bajo /games/<id>/ — independiente de
// dónde viva físicamente publicDir.

const express = require("express");
const path = require("path");
const { listGames, getGame } = require("../core/registry");

const router = express.Router();

router.get("/:gameId/screen", (req, res) => {
  const plugin = getGame(req.params.gameId);
  if (!plugin) return res.redirect("/");
  res.sendFile(path.join(plugin.publicDir, "screen.html"));
});

router.get("/:gameId/player", (req, res) => {
  const plugin = getGame(req.params.gameId);
  if (!plugin) return res.redirect("/");
  res.sendFile(path.join(plugin.publicDir, "player.html"));
});

// Monta los estáticos de cada juego registrado bajo /games/<id>/ — server.js
// llama esto una vez al bootear, después de que games/index.js ya registró
// todos los plugins.
function mountGameStatics(app) {
  listGames().forEach((plugin) => {
    if (plugin.publicDir) {
      app.use(`/games/${plugin.id}`, express.static(plugin.publicDir));
    }
  });
}

module.exports = { router, mountGameStatics };
