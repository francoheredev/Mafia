// platform/core/i18n.js
// Traducciones de la plataforma. El único texto "fuente" vive en
// public/locales/es.json (catálogo clave → texto en español) y la lista de
// idiomas en public/locales/languages.json — el código nunca escribe un
// texto visible a mano, siempre pide una clave.
//
// Los demás idiomas NO están escritos en ningún archivo: se le piden a la
// API de DeepL la primera vez que alguien los necesita y se guardan en
// caché (memoria + disco). La caché recuerda contra qué texto en español
// se tradujo cada clave, así que si el catálogo cambia solo se re-traduce
// lo que cambió.
//
// Configuración por variables de entorno (nunca en el repo):
//   DEEPL_API_KEY   clave de la API (sin ella, todo cae al español).
//   DEEPL_API_URL   opcional; por defecto la API Free de DeepL.
//   I18N_CACHE_DIR  opcional; dónde guardar la caché en disco.

const fs = require("fs");
const path = require("path");

const LOCALES_DIR = path.join(__dirname, "..", "..", "public", "locales");
const CACHE_DIR = process.env.I18N_CACHE_DIR || path.join(__dirname, "..", "..", ".i18n-cache");
const DEEPL_API_URL = process.env.DEEPL_API_URL || "https://api-free.deepl.com";
const BATCH_SIZE = 50; // máximo de textos por pedido que acepta DeepL

const languagesConfig = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "languages.json"), "utf8"));
const SOURCE_LANG = languagesConfig.source;
const source = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${SOURCE_LANG}.json`), "utf8"));

function getLanguage(code) {
  return languagesConfig.languages.find((l) => l.code === code);
}

// Reemplaza los {marcadores} de una plantilla por los valores de params.
function format(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

// Texto en el idioma fuente — lo usa el servidor para mandar, junto con la
// clave, un texto de respaldo legible (logs, tests, clientes viejos).
function t(key, params) {
  return format(source[key] ?? key, params);
}

// Ack de error estándar: el cliente traduce `errorKey` a su idioma y, si no
// puede, muestra `error`.
function fail(key, params) {
  return { ok: false, error: t(key, params), errorKey: key, errorParams: params };
}

// Mensaje traducible que viaja dentro de un evento (ej. motivo de un kick).
function message(key, params) {
  return { key, params, text: t(key, params) };
}

// --- Protección de marcadores y HTML frente a la API ---
// Con tag_handling "html", DeepL respeta las etiquetas y no traduce lo que
// esté marcado translate="no". Los {marcadores} se envuelven así para que
// vuelvan intactos, y después se desenvuelven.
function protectPlaceholders(text) {
  return text.replace(/\{(\w+)\}/g, '<span translate="no">{$1}</span>');
}
function restorePlaceholders(text) {
  return text.replace(/<span translate="no">\s*\{(\w+)\}\s*<\/span>/g, "{$1}");
}

async function deeplTranslate(texts, targetLang) {
  const apiKey = process.env.DEEPL_API_KEY;
  const res = await fetch(`${DEEPL_API_URL}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: texts.map(protectPlaceholders),
      source_lang: getLanguage(SOURCE_LANG).deepl,
      target_lang: targetLang,
      tag_handling: "html",
      preserve_formatting: true,
    }),
  });
  if (!res.ok) throw new Error(`DeepL respondió ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.translations.map((tr) => restorePlaceholders(tr.text));
}

// Se puede reemplazar desde los tests para no gastar cuota de la API.
let translateBatch = deeplTranslate;
function setTranslator(fn) {
  translateBatch = fn;
  memoryCache.clear();
  inFlight.clear();
}

// cache[lang] = { [key]: { src, text } }
const memoryCache = new Map();
const inFlight = new Map();

function cacheFile(lang) {
  return path.join(CACHE_DIR, `${lang}.json`);
}

function readDiskCache(lang) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(lang), "utf8"));
  } catch {
    return {};
  }
}

function writeDiskCache(lang, cache) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFile(lang), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn(`[i18n] No se pudo guardar la caché de "${lang}": ${err.message}`);
  }
}

async function buildCatalog(lang) {
  const language = getLanguage(lang);
  const cache = memoryCache.get(lang) || readDiskCache(lang);
  const missing = Object.keys(source).filter((key) => cache[key]?.src !== source[key]);

  for (let i = 0; i < missing.length; i += BATCH_SIZE) {
    const keys = missing.slice(i, i + BATCH_SIZE);
    const translated = await translateBatch(keys.map((k) => source[k]), language.deepl);
    keys.forEach((key, j) => {
      cache[key] = { src: source[key], text: translated[j] };
    });
  }

  memoryCache.set(lang, cache);
  if (missing.length > 0) {
    writeDiskCache(lang, cache);
    console.log(`[i18n] Traducidos ${missing.length} textos al idioma "${lang}" con la API.`);
  }

  const messages = {};
  Object.keys(source).forEach((key) => {
    messages[key] = cache[key].text;
  });
  return messages;
}

let warnedNoKey = false;

// Devuelve { lang, fallback, messages }. `fallback: true` significa que no
// se pudo traducir (sin API key o la API falló) y se entrega el español.
async function getCatalog(lang) {
  if (lang === SOURCE_LANG) return { lang, fallback: false, messages: source };
  if (!getLanguage(lang)) return null;

  if (translateBatch === deeplTranslate && !process.env.DEEPL_API_KEY) {
    if (!warnedNoKey) {
      console.warn("[i18n] Falta DEEPL_API_KEY: los demás idiomas se muestran en español.");
      warnedNoKey = true;
    }
    return { lang, fallback: true, messages: source };
  }

  // Un solo pedido a la API por idioma aunque lleguen varios clientes juntos.
  if (!inFlight.has(lang)) {
    inFlight.set(
      lang,
      buildCatalog(lang).finally(() => inFlight.delete(lang))
    );
  }
  try {
    const messages = await inFlight.get(lang);
    return { lang, fallback: false, messages };
  } catch (err) {
    console.error(`[i18n] Error traduciendo a "${lang}": ${err.message}`);
    return { lang, fallback: true, messages: source };
  }
}

module.exports = {
  SOURCE_LANG,
  languagesConfig,
  source,
  format,
  t,
  fail,
  message,
  getCatalog,
  setTranslator,
  protectPlaceholders,
  restorePlaceholders,
};
