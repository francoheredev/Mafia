// public/platform/connect.js
// Flujo de conexión genérico: del lado de la pantalla, crear la sala y
// armar la URL/QR para unirse; del lado del celular, el formulario de
// unirse y el intento automático de reconexión (con sessionStorage
// prefijado por juego) si el socket se reconecta. Ninguno de los dos sabe
// nada de reglas de ningún juego — solo credenciales de sala y sesión.
window.Platform = window.Platform || {};

window.Platform.screenConnect = {
  // onCreated(code) se llama cuando la sala ya existe en el servidor — el
  // juego arma su propia pantalla de lobby a partir de ahí (armar el QR
  // queda en buildJoinUrl, más abajo, porque necesita await).
  init({ socket, gameId, onCreated }) {
    socket.on("connect", () => socket.emit("screen:create", { gameId }));
    socket.on("screen:created", ({ code }) => onCreated?.(code));
  },

  // La pantalla se suele abrir como "localhost" en la PC, pero el QR lo
  // escanea un celular en la misma red — necesita la IP LAN de la PC, no
  // "localhost" (que en el celular apunta al propio celular).
  async buildJoinUrl(gameId, code) {
    const lanIp = await fetch("/lan-ip")
      .then((r) => r.json())
      .then((d) => d.lanIp)
      .catch(() => null);
    const port = window.location.port ? `:${window.location.port}` : "";
    const host = lanIp || window.location.hostname;
    return `${window.location.protocol}//${host}${port}/${gameId}/player?code=${code}`;
  },
};

window.Platform.playerConnect = {
  // Engancha el formulario de "unirse" y el intento automático de
  // player:rejoin cada vez que el socket (re)conecta, si hay una sesión
  // guardada para este juego. Devuelve un handle con markKicked/
  // clearSession para que el juego pueda cortar el auto-rejoin cuando lo
  // expulsan, y forgetSession cuando el jugador ya no debería reconectar
  // (ej. reinicio de partida que limpia todo).
  init({ socket, gameId, formId, codeInputId, nameInputId, errorId, waitingId, myNameId, onJoined, onRejoined, onRejoinFailed }) {
    const session = window.Platform.session;
    const form = document.getElementById(formId);
    const errorMsg = document.getElementById(errorId);
    const waitingRoom = document.getElementById(waitingId);

    const params = new URLSearchParams(window.location.search);
    const codeFromQr = params.get("code");
    if (codeFromQr) document.getElementById(codeInputId).value = codeFromQr.toUpperCase();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      errorMsg.textContent = "";

      const code = document.getElementById(codeInputId).value.trim().toUpperCase();
      const name = document.getElementById(nameInputId).value.trim();

      socket.emit("player:join", { code, name }, (res) => {
        if (!res.ok) {
          errorMsg.textContent = res.error;
          return;
        }
        form.classList.add("hidden");
        document.getElementById(myNameId).textContent = `${res.icon} ${res.name}`;
        waitingRoom.classList.remove("hidden");
        session.save(gameId, res);
        onJoined?.(res);
      });
    });

    let wasKicked = false;
    socket.on("connect", () => {
      if (wasKicked) return;
      const saved = session.load(gameId);
      if (!saved.code || !saved.token || !form.classList.contains("hidden")) return;

      socket.emit("player:rejoin", { code: saved.code, token: saved.token }, (res) => {
        if (!res.ok) {
          session.clear(gameId);
          form.classList.remove("hidden");
          waitingRoom.classList.add("hidden");
          errorMsg.textContent = res.error;
          onRejoinFailed?.(res);
          return;
        }
        form.classList.add("hidden");
        document.getElementById(myNameId).textContent = `${res.icon} ${res.name}`;
        waitingRoom.classList.remove("hidden");
        onRejoined?.(res);
      });
    });

    return {
      markKicked() {
        wasKicked = true;
        session.clear(gameId);
      },
    };
  },
};
