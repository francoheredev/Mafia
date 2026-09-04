const socket = io();

const params = new URLSearchParams(window.location.search);
const codeFromQr = params.get("code");
if (codeFromQr) {
  document.getElementById("codeInput").value = codeFromQr.toUpperCase();
}

const form = document.getElementById("joinForm");
const errorMsg = document.getElementById("errorMsg");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const code = document.getElementById("codeInput").value.trim().toUpperCase();
  const name = document.getElementById("nameInput").value.trim();

  socket.emit("player:join", { code, name }, (res) => {
    if (!res.ok) {
      errorMsg.textContent = res.error;
      return;
    }
    form.classList.add("hidden");
    document.getElementById("myName").textContent = `${res.icon} ${res.name}`;
    document.getElementById("waitingRoom").classList.remove("hidden");

    // Guardamos la sesión para el futuro "rejoin" si se corta la conexión
    sessionStorage.setItem("lamafia:code", res.code);
    sessionStorage.setItem("lamafia:name", res.name);
    sessionStorage.setItem("lamafia:icon", res.icon);
  });
});

// Si el navegador reconecta el socket (ej. wifi que titiló), intenta
// reincorporarse a la misma sala en vez de arrancar de cero.
socket.on("connect", () => {
  const savedCode = sessionStorage.getItem("lamafia:code");
  const savedName = sessionStorage.getItem("lamafia:name");
  if (savedCode && savedName && form.classList.contains("hidden")) {
    socket.emit("player:rejoin", { code: savedCode, name: savedName });
  }
});

function teamLabel(team) {
  if (team === "mafia") return "🐺 Los Lobos";
  if (team === "ciudad") return "🏘️ La Aldea";
  return "🎭 Errante";
}

// Cronómetro genérico (cuenta para leer el rol, y tiempo límite de las
// acciones nocturnas). Solo corre un intervalo a la vez: cada llamada corta
// el anterior para no dejar timers colgados al cambiar de pantalla.
let activeCountdownTimer = null;
function startCountdown(el, ms, render) {
  clearInterval(activeCountdownTimer);
  if (!el || !ms) return;
  let secondsLeft = Math.ceil(ms / 1000);
  const tick = () => {
    render(el, Math.max(secondsLeft, 0));
    secondsLeft--;
    if (secondsLeft < 0) clearInterval(activeCountdownTimer);
  };
  tick();
  activeCountdownTimer = setInterval(tick, 1000);
}

socket.on("role:assigned", (role) => {
  const waitingRoom = document.getElementById("waitingRoom");
  const accomplicesHtml =
    role.accomplices && role.accomplices.length
      ? `<p class="accomplices">Tus cómplices: <strong>${role.accomplices.join(", ")}</strong></p>`
      : "";

  waitingRoom.classList.remove("hidden");
  waitingRoom.innerHTML = `
    <div class="role-card team-${role.team}">
      <p class="role-team">${teamLabel(role.team)}</p>
      <div class="role-icon">${role.icon}</div>
      <h2>${role.narrativeName}</h2>
      <p class="role-desc">${role.description}</p>
      ${accomplicesHtml}
    </div>
    <p class="hint" id="revealCountdown">Memorizá tu rol antes de que caiga la noche...</p>
  `;

  startCountdown(document.getElementById("revealCountdown"), role.revealMs, (el, s) => {
    el.textContent = `Memorizá tu rol... la noche cae en ${s}s`;
  });
});

function renderTargetButtons(container, targets, onPick) {
  container.innerHTML = targets
    .map(
      (t) =>
        `<button class="target-btn" data-id="${t.id}"><span class="target-icon">${t.icon}</span>${t.name}</button>`
    )
    .join("");
  container.querySelectorAll(".target-btn").forEach((btn) => {
    btn.addEventListener("click", () => onPick(btn.dataset.id));
  });
}

function renderTimerHtml(timeoutMs) {
  return timeoutMs ? `<p class="hint" id="nightTimer"></p>` : "";
}
function startNightTimer(timeoutMs) {
  startCountdown(document.getElementById("nightTimer"), timeoutMs, (el, s) => {
    el.textContent = `⏳ ${s}s`;
  });
}

socket.on("night:waiting", ({ timeoutMs }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>🌙 Cae la noche</h2>
      <p class="hint">No tenés nada para hacer esta noche. Esperá tranquilo/a...</p>
      ${renderTimerHtml(timeoutMs)}
    </div>
  `;
  startNightTimer(timeoutMs);
});

socket.on("night:mafiaTurn", ({ isLeader, leaderName, targets, timeoutMs }) => {
  const waitingRoom = document.getElementById("waitingRoom");

  if (!isLeader) {
    waitingRoom.innerHTML = `
      <div class="night-panel">
        <h2>🐺 Reunión de la Mafia</h2>
        <p class="hint">Esta noche decide <strong>${leaderName}</strong>. Esperá su elección...</p>
        ${renderTimerHtml(timeoutMs)}
      </div>
    `;
    startNightTimer(timeoutMs);
    return;
  }

  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>🐺 Elegí a la víctima</h2>
      <p class="hint">Esta noche sos vos quien decide.</p>
      <div id="targetButtons" class="target-list"></div>
      <p id="nightError" class="error"></p>
      ${renderTimerHtml(timeoutMs)}
    </div>
  `;
  startNightTimer(timeoutMs);
  renderTargetButtons(document.getElementById("targetButtons"), targets, (targetId) => {
    socket.emit("night:action", { role: "mafia", targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = res.error;
        return;
      }
      clearInterval(activeCountdownTimer);
      waitingRoom.innerHTML = `
        <div class="night-panel">
          <h2>🐺 Listo</h2>
          <p class="hint">Elegiste a tu víctima. Esperando al resto...</p>
        </div>
      `;
    });
  });
});

socket.on("night:yourTurn", ({ role, targets, timeoutMs }) => {
  const waitingRoom = document.getElementById("waitingRoom");
  const config = {
    detective: { icon: "🔮", title: "Investigá a alguien" },
    medico: { icon: "💊", title: "Protegé a alguien" },
  }[role];

  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>${config.icon} ${config.title}</h2>
      <div id="targetButtons" class="target-list"></div>
      <p id="nightError" class="error"></p>
      ${renderTimerHtml(timeoutMs)}
    </div>
  `;
  startNightTimer(timeoutMs);
  renderTargetButtons(document.getElementById("targetButtons"), targets, (targetId) => {
    socket.emit("night:action", { role, targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = res.error;
        return;
      }
      if (role === "medico") {
        clearInterval(activeCountdownTimer);
        waitingRoom.innerHTML = `
          <div class="night-panel">
            <h2>💊 Listo</h2>
            <p class="hint">Ya elegiste a quién proteger. Esperando al resto...</p>
          </div>
        `;
      }
      // El Vidente espera el evento night:investigateResult para ver el resultado.
    });
  });
});

socket.on("night:investigateResult", ({ targetName, isMafia }) => {
  clearInterval(activeCountdownTimer);
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>🔮 Resultado</h2>
      <p class="hint"><strong>${targetName}</strong> ${
    isMafia ? "ES de la Mafia 🐺" : "NO es de la Mafia ✅"
  }</p>
      <p class="hint">Esperando al resto...</p>
    </div>
  `;
});

socket.on("night:resolved", ({ deaths }) => {
  clearInterval(activeCountdownTimer);
  const iDied = deaths.some((d) => d.id === socket.id);
  document.getElementById("waitingRoom").innerHTML = iDied
    ? `
      <div class="night-panel">
        <h2>💀 Te eliminaron</h2>
        <p class="hint">Mirá la pantalla para el resumen de la noche.</p>
      </div>
    `
    : `
      <div class="night-panel">
        <h2>☀️ Amanece</h2>
        <p class="hint">Mirá la pantalla para ver qué pasó esta noche.</p>
      </div>
    `;
});
