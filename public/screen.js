const socket = io();

socket.on("connect", () => {
  socket.emit("screen:create");
});

socket.on("screen:created", ({ code }) => {
  document.getElementById("roomCode").textContent = code;

  // El QR lleva directo a la página del celular con el código precargado
  const joinUrl = `${window.location.origin}/player.html?code=${code}`;
  new QRCode(document.getElementById("qrcode"), {
    text: joinUrl,
    width: 220,
    height: 220,
  });
});

socket.on("lobby:update", ({ players }) => {
  const list = document.getElementById("playerList");
  const count = document.getElementById("playerCount");

  list.innerHTML = "";
  const connectedPlayers = players.filter((p) => p.connected);
  count.textContent = connectedPlayers.length;

  players.forEach((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="player-icon">${p.icon || "❔"}</span> ${p.name}${
      p.connected ? "" : " (desconectado)"
    }`;
    li.className = p.connected ? "player online" : "player offline";
    list.appendChild(li);
  });

  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = connectedPlayers.length < 6 || connectedPlayers.length > 10;
});

document.getElementById("startBtn").addEventListener("click", () => {
  const startError = document.getElementById("startError");
  startError.textContent = "";
  socket.emit("game:start", null, (res) => {
    if (!res.ok) startError.textContent = res.error;
  });
});

socket.on("game:started", ({ playerCount, roles, revealMs }) => {
  const rolesHtml = roles
    .map(
      (r) => `
        <div class="role-chip team-${r.team}">
          <span class="role-chip-icon">${r.icon}</span>
          <span class="role-chip-name">${r.narrativeName}${r.count > 1 ? ` ×${r.count}` : ""}</span>
        </div>
      `
    )
    .join("");

  document.querySelector(".lobby-screen").innerHTML = `
    <h1>🎭 Roles repartidos</h1>
    <p class="subtitle">${playerCount} jugadores ya tienen su rol en el celular.</p>
    <p class="hint">Estos son los roles en juego esta partida (en secreto, cada quien sabe el suyo):</p>
    <div class="roles-catalog">${rolesHtml}</div>
    <p class="hint" id="revealCountdown"></p>
  `;

  if (revealMs) {
    startCountdown(document.getElementById("revealCountdown"), revealMs, (el, s) => {
      el.textContent = `🌙 La noche cae en ${s}s...`;
    });
  }
});

// Cronómetro genérico (se usa para la cuenta de "cae la noche" y para el
// tiempo límite de las acciones nocturnas). Solo corre un intervalo a la
// vez: cada llamada corta el anterior para no dejar timers colgados cuando
// cambia la pantalla.
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

// Acomoda los avatares de los jugadores en ronda, como una aldea reunida
// de noche alrededor del fuego.
function renderNightCircle(players) {
  const n = players.length;
  const radius = 120;
  const items = players
    .map((p, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      return `
        <div class="night-avatar" id="avatar-${p.id}" style="transform: translate(-50%, -50%) translate(${x}px, ${y}px)">
          <span class="night-avatar-icon">${p.icon}</span>
          <span class="night-avatar-name">${p.name}</span>
        </div>
      `;
    })
    .join("");
  return `<div class="night-circle-wrap"><div class="night-circle-center">🔥</div>${items}</div>`;
}

socket.on("night:begin", ({ number, players, timeoutMs }) => {
  document.querySelector(".lobby-screen").innerHTML = `
    <h1>🌙 Cae la noche (#${number})</h1>
    <p class="subtitle">Los jugadores están decidiendo en su celular...</p>
    ${renderNightCircle(players)}
    <ul class="night-progress">
      <li id="npMafia">🐺 La Mafia elige a su víctima…</li>
      <li id="npDetective">🔮 El Vidente investiga…</li>
      <li id="npMedico">💊 El Médico protege…</li>
    </ul>
    <p class="night-timer" id="nightTimer"></p>
  `;

  if (timeoutMs) {
    startCountdown(document.getElementById("nightTimer"), timeoutMs, (el, s) => {
      el.textContent = `⏳ ${s}s para que todos decidan`;
    });
  }
});

socket.on("night:progress", ({ mafiaDone, detectiveDone, medicoDone, actedIds }) => {
  const flags = { npMafia: mafiaDone, npDetective: detectiveDone, npMedico: medicoDone };
  Object.entries(flags).forEach(([id, done]) => {
    document.getElementById(id)?.classList.toggle("done", done);
  });

  document.querySelectorAll(".night-avatar").forEach((el) => el.classList.remove("done"));
  (actedIds || []).forEach((id) => {
    document.getElementById(`avatar-${id}`)?.classList.add("done");
  });
});

socket.on("night:resolved", ({ number, deaths, saved }) => {
  clearInterval(activeCountdownTimer);

  let body;
  if (deaths.length === 0) {
    body = saved
      ? `<p class="hint">💊 El Médico llegó justo a tiempo. Nadie murió esta noche.</p>`
      : `<p class="hint">La Mafia no atacó. Nadie murió esta noche.</p>`;
  } else {
    // No se revela el rol de quien murió — eso se descubre durante el Día.
    body = `<ul class="death-list">${deaths
      .map((d) => `<li>💀 <span class="death-icon">${d.icon}</span> <strong>${d.name}</strong> murió esta noche.</li>`)
      .join("")}</ul>`;
  }
  document.querySelector(".lobby-screen").innerHTML = `
    <h1>☀️ Amanece (noche #${number})</h1>
    ${body}
    <p class="hint">(Próximo paso a programar: ciclo Día — Fases 2-6 del GDD)</p>
  `;
});
