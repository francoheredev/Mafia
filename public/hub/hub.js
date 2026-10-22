// public/hub/hub.js
// Selector de juego: lee /api/games (armado por platform/routes/hub.js a
// partir del registry, nunca hardcodeado acá) y arma un link a la pantalla
// y otro al celular de cada uno.
function prettifyId(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
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
      list.innerHTML = `<li class="hint">Todavía no hay juegos registrados.</li>`;
      return;
    }
    list.innerHTML = data.games
      .map(
        (g) => `
          <li class="game-card">
            <h2>${prettifyId(g.id)}</h2>
            <div class="game-links">
              <a href="/${g.id}/screen">🖥️ Abrir pantalla</a>
              <a href="/${g.id}/player">📱 Unirme desde acá</a>
            </div>
          </li>
        `
      )
      .join("");
  } catch (err) {
    if (attempt < MAX_ATTEMPTS) {
      list.innerHTML = `<li class="hint">⏳ Despertando el servidor… El primer ingreso puede tardar hasta un minuto.</li>`;
      setTimeout(() => loadGames(attempt + 1), RETRY_MS);
      return;
    }
    list.innerHTML = `<li class="hint">No se pudo cargar la lista de juegos. Recargá la página en unos segundos.</li>`;
  }
}

loadGames();
