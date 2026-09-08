// public/platform/chat.js
// Chat genérico por canales — no sabe qué significa ningún canal en
// particular, solo pide su historial (chat:getHistory), manda mensajes
// (chat:send) y los renderiza. Cada juego le pasa los ids de sus propios
// canales (vía botones con data-channel) y, opcionalmente, qué canales
// están habilitados en cada momento (isChannelEnabled) — ej. un canal solo
// para jugadores eliminados.
window.Platform = window.Platform || {};
window.Platform.chat = {
  init({
    socket,
    fabId,
    modalId,
    closeId,
    logId,
    formId,
    inputId,
    tabButtonsSelector,
    isChannelEnabled,
    defaultChannel = "general",
  }) {
    const modal = document.getElementById(modalId);
    const fab = document.getElementById(fabId);
    const log = document.getElementById(logId);
    const form = document.getElementById(formId);
    const input = document.getElementById(inputId);
    const tabButtons = document.querySelectorAll(tabButtonsSelector);

    let activeChannel = defaultChannel;
    let messages = [];

    function render() {
      log.innerHTML = messages.length
        ? messages
            .map((m) => `<li><span class="chat-icon">${m.senderIcon}</span><strong>${m.senderName}:</strong> ${m.text}</li>`)
            .join("")
        : `<li class="hint">Todavía no hay mensajes.</li>`;
      log.scrollTop = log.scrollHeight;
    }

    function load(channel) {
      activeChannel = channel;
      tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.channel === channel));
      socket.emit("chat:getHistory", { channel }, (res) => {
        messages = res.ok ? res.messages : [];
        render();
      });
    }

    fab.addEventListener("click", () => {
      tabButtons.forEach((btn) => {
        btn.disabled = isChannelEnabled ? !isChannelEnabled(btn.dataset.channel) : false;
      });
      const stillEnabled = isChannelEnabled ? isChannelEnabled(activeChannel) : true;
      modal.classList.remove("hidden");
      load(stillEnabled ? activeChannel : defaultChannel);
    });
    document.getElementById(closeId)?.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.add("hidden");
    });

    tabButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        load(btn.dataset.channel);
      });
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      socket.emit("chat:send", { channel: activeChannel, text }, (res) => {
        if (res.ok) input.value = "";
      });
    });

    socket.on("chat:message", ({ channel, ...msg }) => {
      if (channel !== activeChannel) return;
      messages = [...messages, msg];
      if (!modal.classList.contains("hidden")) render();
    });

    return {
      // Vuelve al canal por defecto — se usa cuando la partida se reinicia
      // en la misma sala y hay que olvidarse de en qué canal estaba parado.
      reset(channel = defaultChannel) {
        activeChannel = channel;
        messages = [];
      },
    };
  },
};
