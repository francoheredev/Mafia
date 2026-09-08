// platform/routes/hub.js
// La página de selección de juego (GET /) y el endpoint que la alimenta
// (GET /api/games) — construido siempre a partir del registry, nunca
// hand-duplicado, para que agregar un juego nuevo (games/index.js +
// registerGame) alcance para que aparezca acá sin tocar este archivo.

const express = require("express");
const path = require("path");
const { listGames } = require("../core/registry");

const router = express.Router();

router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "hub", "index.html"));
});

router.get("/api/games", (req, res) => {
  res.json({
    games: listGames().map((plugin) => ({ id: plugin.id })),
  });
});

module.exports = router;
