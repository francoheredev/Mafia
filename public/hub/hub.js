// public/hub/hub.js
// Selector de juego: lee /api/games (armado por platform/routes/hub.js a
// partir del registry, nunca hardcodeado acá) y arma un link a la pantalla
// y otro al celular de cada uno.
function prettifyId(id) {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

async function loadGames() {
  const list = document.getElementById("gameList");
  try {
    const res = await fetch("/api/games");
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
    list.innerHTML = `<li class="hint">No se pudo cargar la lista de juegos.</li>`;
  }
}

loadGames();
