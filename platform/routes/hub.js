// platform/routes/hub.js
// La página de selección de juego (GET /) y el endpoint que la alimenta
// (GET /api/games) — construido siempre a partir del registry, nunca
// hand-duplicado, para que agregar un juego nuevo (games/index.js +
// registerGame) alcance para que aparezca acá sin tocar este archivo.

const express = require("express");
const path = require("path");
const { listGames } = require("../core/registry");
const { languagesConfig, getCatalog } = require("../core/i18n");

const router = express.Router();

router.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "..", "public", "hub", "index.html"));
});

router.get("/api/games", (req, res) => {
  res.json({
    games: listGames().map((plugin) => ({ id: plugin.id })),
  });
});

// Traducciones (ver platform/core/i18n.js): la lista de idiomas y el
// catálogo completo de un idioma, traducido por la API la primera vez.
router.get("/api/i18n", (req, res) => {
  res.json(languagesConfig);
});

router.get("/api/i18n/:lang", async (req, res) => {
  const catalog = await getCatalog(req.params.lang);
  if (!catalog) return res.status(404).json({ error: "Idioma no soportado." });
  // Un catálogo de respaldo (sin traducir) no se cachea, para que se
  // reintente apenas la API vuelva a estar disponible.
  res.set("Cache-Control", catalog.fallback ? "no-store" : "public, max-age=300");
  res.json(catalog);
});

module.exports = router;
