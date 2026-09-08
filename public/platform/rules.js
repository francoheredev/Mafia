// public/platform/rules.js
// Wiring genérico del modal de reglas: abre/cierra el panel, pero el HTML
// que muestra lo arma el juego (buildHtml) — la plataforma no sabe nada de
// roles ni de ninguna regla en particular.
window.Platform = window.Platform || {};
window.Platform.rules = {
  init({ fabId, modalId, closeId, contentId, buildHtml }) {
    const modal = document.getElementById(modalId);
    const fab = document.getElementById(fabId);
    const content = document.getElementById(contentId);
    if (!fab || !modal) return;

    fab.addEventListener("click", () => {
      content.innerHTML = buildHtml();
      modal.classList.remove("hidden");
    });
    document.getElementById(closeId)?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });
  },
};
