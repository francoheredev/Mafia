// public/hub/hub.js
// Selector de juego: lee /api/games (armado por platform/routes/hub.js a
// partir del registry, nunca hardcodeado acá) y arma un link a la pantalla
// y otro al celular de cada uno. Los textos salen de Platform.i18n.
const { t } = window.Platform.i18n;

// Nombre visible del juego: su clave hub.game.<id> si existe en el
// catálogo; si no, el id capitalizado.
function gameName(id) {
  const key = `hub.game.${id}`;
  const name = t(key);
  return name === key ? id.charAt(0).toUpperCase() + id.slice(1) : name;
}

// En el deploy, /api/games viaja a Render, que puede estar "dormido": se
// reintenta durante ~90 s antes de rendirse, avisando que está despertando.
const MAX_ATTEMPTS = 18;
const RETRY_MS = 5000;

async function loadGames(attempt = 1) {
  const list = document.getElementById("gameList");
  try {
    const res = await fetch("/api/games");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.games || data.games.length === 0) {
      list.innerHTML = `<li class="hint">${t("hub.empty")}</li>`;
      return;
    }
    list.innerHTML = data.games
      .map(
        (g) => `
          <li class="game-card">
            <h2>${gameName(g.id)}</h2>
            <div class="game-links">
              <a href="/${g.id}/screen">${t("hub.openScreen")}</a>
              <a href="/${g.id}/player">${t("hub.joinHere")}</a>
            </div>
          </li>
        `
      )
      .join("");
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      list.innerHTML = `<li class="hint">${t("hub.waking")}</li>`;
      setTimeout(() => loadGames(attempt + 1), RETRY_MS);
      return;
    }
    list.innerHTML = `<li class="hint">${t("hub.loadError")}</li>`;
  }
}

window.Platform.i18n.renderSelector(document.getElementById("langSelector"));
window.Platform.i18n.ready.then(() => loadGames());
