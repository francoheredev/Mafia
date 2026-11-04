// public/platform/i18n.js
// Traducciones del lado del cliente. Ningún texto visible está escrito en
// el HTML ni en los scripts: todo se pide por clave con Platform.i18n.t().
//
// - El catálogo fuente (español) es public/locales/es.json y la lista de
//   idiomas, public/locales/languages.json — archivos estáticos, así el
//   texto base está disponible al instante.
// - Para otro idioma se pide /api/i18n/<lang> al servidor, que lo traduce
//   con la API de DeepL (ver platform/core/i18n.js) y lo guarda en caché.
// - El idioma se elige con ?lang=, el selector (guardado en localStorage)
//   o, la primera vez, el idioma del navegador.
//
// Hay que cargarlo antes que platform.js: el socket espera a que el
// catálogo esté listo (Platform.i18n.ready) para conectarse, así ningún
// evento llega antes de que haya textos para mostrarlo.
window.Platform = window.Platform || {};
window.Platform.i18n = (function () {
  const STORAGE_KEY = "qrmania:lang";
  const MAX_ATTEMPTS = 18; // ~90 s: el servidor puede estar despertando
  const RETRY_MS = 5000;

  let config = { source: "es", languages: [] };
  let source = {};
  let messages = {};
  let lang = "es";

  function readStoredLang() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }
  function storeLang(code) {
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch {
      // Sin almacenamiento (modo privado): el idioma vale solo para esta carga.
    }
  }

  function detectLang() {
    const codes = config.languages.map((l) => l.code);
    const fromUrl = new URLSearchParams(window.location.search).get("lang");
    if (fromUrl && codes.includes(fromUrl)) {
      storeLang(fromUrl);
      return fromUrl;
    }
    const stored = readStoredLang();
    if (stored && codes.includes(stored)) return stored;
    const browser = (navigator.languages || [navigator.language || ""])
      .map((l) => l.slice(0, 2).toLowerCase())
      .find((l) => codes.includes(l));
    return browser || config.source;
  }

  function format(template, params = {}) {
    return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
  }

  function t(key, params) {
    return format(messages[key] ?? source[key] ?? key, params);
  }

  // Mensaje que viene del servidor: { key, params, text } o texto plano
  // (Blind Shot todavía manda texto plano).
  function tMessage(msg) {
    if (!msg) return "";
    if (typeof msg === "string") return msg;
    return msg.key ? t(msg.key, msg.params) : msg.text || "";
  }

  // Ack de error del servidor (ver fail() en platform/core/i18n.js).
  function tError(res) {
    if (!res) return "";
    return res.errorKey ? t(res.errorKey, res.errorParams) : res.error || "";
  }

  function role(roleId, field) {
    return t(`roles.${roleId}.${field}`);
  }

  // Aplica los atributos data-i18n* de un fragmento del DOM:
  //   data-i18n="clave"             → textContent
  //   data-i18n-html="clave"        → innerHTML (textos con <strong>, etc.)
  //   data-i18n-placeholder="clave" → placeholder
  function applyDom(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.dataset.i18nHtml);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchTranslation(code) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await fetchJson(`/api/i18n/${code}`);
      } catch {
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
    return null;
  }

  async function load() {
    config = await fetchJson("/locales/languages.json");
    source = await fetchJson(`/locales/${config.source}.json`);
    messages = source;
    lang = detectLang();
    document.documentElement.lang = lang;
    applyDom();

    if (lang !== config.source) {
      document.documentElement.classList.add("i18n-loading");
      const catalog = await fetchTranslation(lang);
      if (catalog?.messages) messages = { ...source, ...catalog.messages };
      document.documentElement.classList.remove("i18n-loading");
      applyDom();
    }
  }

  const ready = load().catch((err) => {
    console.error("[i18n] No se pudo cargar el catálogo:", err);
  });

  // Selector de idioma. Cambiar de idioma recarga la página, y recargar no
  // reincorpora a nadie a su sala (connect.js solo reconecta si se cae el
  // socket) — por eso se ofrece únicamente antes de entrar a una: en el
  // menú (que fija el idioma de la pantalla compartida) y en el formulario
  // de unirse del celular.
  function renderSelector(container) {
    if (!container) return;
    ready.then(() => {
      const options = config.languages
        .map((l) => `<option value="${l.code}"${l.code === lang ? " selected" : ""}>${l.name}</option>`)
        .join("");
      container.innerHTML = `
        <label class="lang-select">
          <span>🌐 ${t("lang.label")}</span>
          <select>${options}</select>
        </label>
      `;
      container.querySelector("select").addEventListener("change", (e) => {
        storeLang(e.target.value);
        const url = new URL(window.location.href);
        url.searchParams.delete("lang");
        window.location.replace(url.toString());
      });
    });
  }

  return {
    ready,
    t,
    tMessage,
    tError,
    role,
    applyDom,
    renderSelector,
    get lang() {
      return lang;
    },
  };
})();
