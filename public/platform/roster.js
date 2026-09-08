// public/platform/roster.js
// Lista genérica de jugadores del lobby: ícono + nombre, marcado como
// desconectado si corresponde. Cada juego decide sus propias reglas de
// mínimo/máximo de jugadores a partir del conteo que le llega por
// `onCount` — esto solo dibuja la lista.
window.Platform = window.Platform || {};
window.Platform.roster = {
  renderLobbyList(listEl, players, { onCount } = {}) {
    listEl.innerHTML = "";
    const connected = players.filter((p) => p.connected);
    onCount?.(connected.length);
    players.forEach((p) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="player-icon">${p.icon || "❔"}</span> ${p.name}${
        p.connected ? "" : " (desconectado)"
      }`;
      li.className = p.connected ? "player online" : "player offline";
      listEl.appendChild(li);
    });
  },
};
