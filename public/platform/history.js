// public/platform/history.js
// Historial público de la partida (pantalla y celular comparten esta misma
// UI): pide history:get al abrir, y agrega cada history:entry nuevo que
// llegue mientras el modal está abierto. No sabe qué significa ninguna
// entrada — solo tiene icon + text.
window.Platform = window.Platform || {};
window.Platform.history = {
  init({ socket, fabId, modalId, closeId, listId }) {
    const modal = document.getElementById(modalId);
    const fab = document.getElementById(fabId);
    const list = document.getElementById(listId);

    // Cada entrada trae su clave de traducción (ver pushHistory en el
    // servidor); las que no la tienen se muestran tal cual.
    function entryHtml(entry) {
      return `<li>${entry.icon} ${window.Platform.i18n.tMessage(entry)}</li>`;
    }

    function renderEntries(entries) {
      list.innerHTML = entries.length
        ? entries.map(entryHtml).join("")
        : `<li class="hint">${window.Platform.i18n.t("platform.history.empty")}</li>`;
      list.scrollTop = list.scrollHeight;
    }

    fab.addEventListener("click", () => {
      socket.emit("history:get", null, (res) => {
        if (res.ok) renderEntries(res.entries);
      });
      modal.classList.remove("hidden");
    });
    document.getElementById(closeId)?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
    socket.on("history:entry", (entry) => {
      if (!modal.classList.contains("hidden")) {
        list.insertAdjacentHTML("beforeend", entryHtml(entry));
        list.scrollTop = list.scrollHeight;
      }
    });
  },
};
