// public/platform/platform.js
// Núcleo del namespace window.Platform que comparte todo cliente montado
// sobre esta plataforma (pantalla o celular, de cualquier juego): el socket
// único, sessionStorage con prefijo por juego (para que un jugador que pasa
// de un juego a otro en la misma pestaña no arrastre sesión vieja), y el
// patrón genérico de FAB + modal que reutilizan roster/chat/historial/
// reglas/host. No sabe nada de ningún juego en particular — cada juego lo
// consume, nunca al revés.
window.Platform = (function () {
  const socket = io(window.PLATFORM_SERVER_URL || undefined);

  // Aviso de conexión: el servidor del deploy (Render, plan free) se
  // "duerme" sin tráfico y el primer ingreso puede tardar cerca de un
  // minuto. Si el socket no conecta enseguida, mostramos un cartel en vez
  // de una pantalla muerta; se va solo al conectar y vuelve si se cae.
  const banner = document.createElement("div");
  banner.className = "connection-banner hidden";
  banner.textContent = "⏳ Conectando con el servidor… El primer ingreso puede tardar hasta un minuto.";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(banner));
  let bannerTimer = setTimeout(() => banner.classList.remove("hidden"), 1500);
  socket.on("connect", () => {
    clearTimeout(bannerTimer);
    banner.classList.add("hidden");
  });
  socket.on("disconnect", () => {
    bannerTimer = setTimeout(() => banner.classList.remove("hidden"), 1500);
  });

  function sessionKey(gameId, key) {
    return `${gameId}:${key}`;
  }

  const session = {
    save(gameId, { code, name, icon, token }) {
      sessionStorage.setItem(sessionKey(gameId, "code"), code);
      sessionStorage.setItem(sessionKey(gameId, "name"), name);
      sessionStorage.setItem(sessionKey(gameId, "icon"), icon);
      sessionStorage.setItem(sessionKey(gameId, "token"), token);
    },
    load(gameId) {
      return {
        code: sessionStorage.getItem(sessionKey(gameId, "code")),
        name: sessionStorage.getItem(sessionKey(gameId, "name")),
        icon: sessionStorage.getItem(sessionKey(gameId, "icon")),
        token: sessionStorage.getItem(sessionKey(gameId, "token")),
      };
    },
    clear(gameId) {
      ["code", "name", "icon", "token"].forEach((k) => sessionStorage.removeItem(sessionKey(gameId, k)));
    },
  };

  // Wiring genérico del patrón "botón flotante que abre un panel
  // superpuesto" — rol, reglas, chat, historial y el panel del host lo usan
  // todos con el mismo comportamiento: abrir con el FAB, cerrar con el
  // botón de cierre o clickeando afuera del panel.
  function wireModal({ fabId, modalId, closeId, onOpen }) {
    const fab = document.getElementById(fabId);
    const modal = document.getElementById(modalId);
    const closeBtn = closeId ? document.getElementById(closeId) : null;
    if (!fab || !modal) return null;

    const open = () => {
      onOpen?.();
      modal.classList.remove("hidden");
    };
    const close = () => modal.classList.add("hidden");

    fab.addEventListener("click", open);
    closeBtn?.addEventListener("click", close);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close();
    });

    return { fab, modal, open, close };
  }

  return { socket, session, wireModal };
})();
