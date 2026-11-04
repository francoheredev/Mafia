// Traducciones (platform/core/i18n.js + public/platform/i18n.js):
//  1. Toda clave que el código pide con t("...") / data-i18n existe en el
//     catálogo fuente (public/locales/es.json) — nada queda sin texto.
//  2. El pipeline de traducción por API funciona: se reemplaza DeepL por un
//     traductor falso (no gasta cuota ni necesita API key), y se verifica
//     que traduzca todo el catálogo, respete los {marcadores} y use la
//     caché (no vuelve a pedir lo que ya tradujo).
//  3. El endpoint /api/i18n del server levantado por run-tests.js responde
//     con la lista de idiomas y un catálogo completo.
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.I18N_CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-test-"));
const i18n = require("../../platform/core/i18n");

const ROOT = path.join(__dirname, "..", "..");
let failed = false;
function check(ok, msg) {
  console.log(`${ok ? "✅" : "❌"} ${msg}`);
  if (!ok) failed = true;
}

// --- 1. Claves usadas en el código ---
const FILES = [
  "public/hub/hub.js",
  "public/hub/index.html",
  "public/platform/i18n.js",
  "public/platform/platform.js",
  "public/platform/chat.js",
  "public/platform/history.js",
  "public/platform/roster.js",
  "public/games/mafia/screen.js",
  "public/games/mafia/player.js",
  "public/games/mafia/screen.html",
  "public/games/mafia/player.html",
  "games/mafia/plugin.js",
  "games/mafia/logic.js",
  "platform/core/connection.js",
];
const KEY_PATTERNS = [
  /\b(?:t|fail|message)\(\s*"([\w.-]+)"/g,
  /\bkey:\s*"([\w.-]+)"/g,
  /data-i18n(?:-html|-placeholder)?="([\w.-]+)"/g,
  /"(mafia\.[\w.-]+)"/g,
];
const usedKeys = new Set();
FILES.forEach((rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  KEY_PATTERNS.forEach((re) => {
    // Toda clave real tiene al menos un punto (ej. "hub.title"); así se
    // ignoran ejemplos de los comentarios como data-i18n="clave".
    for (const m of src.matchAll(re)) if (m[1].includes(".")) usedKeys.add(m[1]);
  });
});
const missing = [...usedKeys].filter((k) => !(k in i18n.source));
check(missing.length === 0, `Las ${usedKeys.size} claves usadas en el código existen en es.json${missing.length ? ` — faltan: ${missing.join(", ")}` : ""}`);

// Claves armadas dinámicamente (roles, reglas, ganadores, equipos).
const { ROLE_INFO } = require("../../games/mafia/roles");
const { GENERAL_RULES } = require("../../games/mafia/rules");
const dynamicKeys = [
  ...Object.keys(ROLE_INFO).flatMap((id) => ["name", "narrativeName", "description", "tip"].map((f) => `roles.${id}.${f}`)),
  ...GENERAL_RULES.flatMap((r) => [r.titleKey, r.textKey]),
  ...["mafia", "ciudad", "bufon", "draw"].map((w) => `mafia.history.winner.${w}`),
  ...["mafia", "ciudad", "bufon", "draw"].map((w) => `mafia.player.over.${w}`),
  ...["mafia", "ciudad", "independiente"].map((team) => `mafia.player.team.${team}`),
];
const missingDynamic = dynamicKeys.filter((k) => !(k in i18n.source));
check(missingDynamic.length === 0, `Las ${dynamicKeys.length} claves dinámicas existen${missingDynamic.length ? ` — faltan: ${missingDynamic.join(", ")}` : ""}`);

async function main() {
  // --- 2. Pipeline de traducción con un traductor falso ---
  let calls = 0;
  let textsSent = 0;
  i18n.setTranslator(async (texts, targetLang) => {
    calls++;
    textsSent += texts.length;
    // Simula la API: protege los marcadores igual que con DeepL y "traduce"
    // anteponiendo el idioma destino.
    return texts.map((tx) => i18n.restorePlaceholders(`[${targetLang}] ${i18n.protectPlaceholders(tx)}`));
  });

  const first = await i18n.getCatalog("en");
  const total = Object.keys(i18n.source).length;
  check(!first.fallback, "El catálogo en inglés no cae al español");
  check(Object.keys(first.messages).length === total, `Trae las ${total} claves traducidas`);
  check(first.messages["mafia.player.join"] === "[EN-US] Unirme", "Cada texto pasa por la API");
  check(
    first.messages["mafia.screen.beat.pounce"].includes("{icon} {name}"),
    "Los {marcadores} vuelven intactos de la API"
  );
  check(calls === Math.ceil(total / 50), `Se pide en lotes de 50 (${calls} pedidos)`);

  const sentBefore = textsSent;
  await i18n.getCatalog("en");
  check(textsSent === sentBefore, "La segunda vez sale de la caché, sin volver a llamar a la API");

  const cacheFile = path.join(process.env.I18N_CACHE_DIR, "en.json");
  check(fs.existsSync(cacheFile), "La caché queda guardada en disco");

  const es = await i18n.getCatalog("es");
  check(es.messages === i18n.source, "El español se sirve directo del catálogo fuente");
  check((await i18n.getCatalog("xx")) === null, "Un idioma no soportado se rechaza");

  i18n.setTranslator(async () => {
    throw new Error("API caída");
  });
  fs.rmSync(cacheFile);
  const broken = await i18n.getCatalog("en");
  check(broken.fallback && broken.messages === i18n.source, "Si la API falla, se cae al español sin romper");

  // --- 3. Endpoint del server ---
  const langs = await fetch("http://localhost:3000/api/i18n").then((r) => r.json());
  check(langs.languages?.some((l) => l.code === "en"), "GET /api/i18n lista los idiomas");
  const remote = await fetch("http://localhost:3000/api/i18n/en").then((r) => r.json());
  check(Object.keys(remote.messages || {}).length === total, "GET /api/i18n/en devuelve el catálogo completo");
  const notFound = await fetch("http://localhost:3000/api/i18n/xx");
  check(notFound.status === 404, "GET /api/i18n/xx responde 404");

  fs.rmSync(process.env.I18N_CACHE_DIR, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});
