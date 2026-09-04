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

// Cronómetro genérico (se usa para la cuenta de "cae la noche" y para el
// tiempo límite de las acciones nocturnas/diurnas). Solo corre un intervalo
// a la vez: cada llamada corta el anterior para no dejar timers colgados
// cuando cambia la pantalla.
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

// Todo reemplazo de la pantalla principal pasa por acá — así cualquier paso
// de narrativa que haya quedado pendiente de la fase anterior se corta
// antes de que la fase nueva se dibuje encima.
let narrativeTimer = null;
function renderScreen(html) {
  clearTimeout(narrativeTimer);
  document.querySelector(".lobby-screen").innerHTML = html;
}

// Reproduce una secuencia de "beats" narrativos, uno a la vez, con una
// pausa entre cada uno, y al final deja la pantalla de resultado fija.
// `onDone` avisa al servidor que ya se puede pasar a la próxima fase.
function playNarrative(steps, finalHtml, onDone) {
  clearTimeout(narrativeTimer);
  const container = document.querySelector(".lobby-screen");
  let i = 0;
  function step() {
    if (i >= steps.length) {
      container.innerHTML = finalHtml;
      onDone?.();
      return;
    }
    container.classList.remove("narrative-fade-in");
    container.innerHTML = steps[i].html;
    void container.offsetWidth; // reinicia la animación CSS
    container.classList.add("narrative-fade-in");
    narrativeTimer = setTimeout(step, steps[i].delayMs ?? 2200);
    i++;
  }
  step();
}

function narrativeBeat(icon, text) {
  return `
    <div class="narrative-beat">
      <span class="narrative-icon">${icon}</span>
      <p class="narrative-text">${text}</p>
    </div>
  `;
}

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

  renderScreen(`
    <h1>🎭 Roles repartidos</h1>
    <p class="subtitle">${playerCount} jugadores ya tienen su rol en el celular.</p>
    <p class="hint">Estos son los roles en juego esta partida (en secreto, cada quien sabe el suyo):</p>
    <div class="roles-catalog">${rolesHtml}</div>
    <p class="hint" id="revealCountdown"></p>
  `);

  if (revealMs) {
    startCountdown(document.getElementById("revealCountdown"), revealMs, (el, s) => {
      el.textContent = `🌙 La noche cae en ${s}s...`;
    });
  }
});

// Acomoda los avatares de los jugadores en ronda (de noche alrededor del
// fuego, de día alrededor de la aldea). Se reutiliza en Noche y Día.
function renderPlayerCircle(players, centerIcon) {
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
  return `<div class="night-circle-wrap"><div class="night-circle-center">${centerIcon}</div>${items}</div>`;
}

function renderVoteResults(results) {
  if (!results.length) return "";
  return `<ul class="death-list">${results
    .map((r) => `<li>${r.icon} <strong>${r.name}</strong> — ${r.votes} voto${r.votes === 1 ? "" : "s"}</li>`)
    .join("")}</ul>`;
}

// Pantalla de fin de partida: anuncia el bando ganador (o empate) y revela
// el rol de todos — a diferencia de una muerte puntual, el cierre del juego
// sí muestra quién era quién.
function gameOverBeat(winner) {
  if (winner === "mafia") {
    return narrativeBeat("🐺", "La Mafia ya controla el pueblo entero...");
  }
  if (winner === "ciudad") {
    return narrativeBeat("🏘️", "El último mafioso ha caído. La aldea respira tranquila...");
  }
  return narrativeBeat("🤝", "No queda nadie en pie para contarlo...");
}

function gameOverFinalHtml(winner, roster) {
  const title =
    winner === "mafia"
      ? "🐺 ¡Gana la Mafia!"
      : winner === "ciudad"
      ? "🏘️ ¡Gana la Ciudad!"
      : "🤝 Empate — nadie quedó en pie";
  const rosterHtml = (roster || [])
    .map(
      (p) => `
        <div class="role-chip team-${p.team}">
          <span class="role-chip-icon">${p.icon}</span>
          <span class="role-chip-name">${p.name} — ${p.narrativeName}${p.alive ? "" : " 💀"}</span>
        </div>
      `
    )
    .join("");
  return `
    <h1>${title}</h1>
    <p class="subtitle">La partida terminó. Estos eran los roles de todos:</p>
    <div class="roles-catalog">${rosterHtml}</div>
  `;
}

socket.on("night:begin", ({ number, players, timeoutMs }) => {
  renderScreen(`
    <h1>🌙 Cae la noche (#${number})</h1>
    <p class="subtitle">Los jugadores están decidiendo en su celular...</p>
    ${renderPlayerCircle(players, "🔥")}
    <ul class="night-progress">
      <li id="npMafia">🐺 La Mafia elige a su víctima…</li>
      <li id="npDetective">🔮 El Vidente investiga…</li>
      <li id="npMedico">💊 El Médico protege…</li>
    </ul>
    <p class="night-timer" id="nightTimer"></p>
  `);

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

socket.on("night:resolved", ({ number, deaths, saved, winner, roster }) => {
  const steps = [
    { html: narrativeBeat("🌫️", "La niebla se aferra al pueblo mientras la noche cae sobre todos...") },
    { html: narrativeBeat("🐺", "Entre las sombras, la Mafia acecha en silencio...") },
  ];

  if (deaths.length === 0) {
    steps.push({
      html: saved
        ? narrativeBeat("💊", "Algo — o alguien — los detiene justo a tiempo...")
        : narrativeBeat("🌙", "Pero esta noche, la Mafia no encuentra su oportunidad..."),
    });
  } else {
    const [victim, ...rest] = deaths;
    steps.push(
      {
        html: narrativeBeat("🩸", `Se abalanzan sobre <strong>${victim.icon} ${victim.name}</strong>...`),
        delayMs: 2600,
      },
      {
        html: narrativeBeat("💀", `...y el amanecer llega sin <strong>${victim.name}</strong>.`),
        delayMs: 2600,
      }
    );
    rest.forEach((extra) => {
      // No se nombra el rol acá — la venganza del Cazador ya se infiere
      // por eliminación, no hace falta subrayarlo.
      steps.push({
        html: narrativeBeat(
          "🏹",
          `Pero antes de caer, algo se despierta... y arrastra también a <strong>${extra.icon} ${extra.name}</strong>.`
        ),
        delayMs: 2600,
      });
    });
  }

  let finalHtml;
  if (deaths.length === 0) {
    finalHtml = `
      <h1>☀️ Amanece (noche #${number})</h1>
      <p class="hint">${
        saved
          ? "💊 El Médico llegó justo a tiempo. Nadie murió esta noche."
          : "La Mafia no atacó. Nadie murió esta noche."
      }</p>
    `;
  } else {
    finalHtml = `
      <h1>☀️ Amanece (noche #${number})</h1>
      <ul class="death-list">${deaths
        .map(
          (d) =>
            `<li>💀 <span class="death-icon">${d.icon}</span> <strong>${d.name}</strong> murió esta noche.</li>`
        )
        .join("")}</ul>
    `;
  }

  if (winner) {
    steps.push({ html: gameOverBeat(winner), delayMs: 2600 });
    finalHtml = gameOverFinalHtml(winner, roster);
    playNarrative(steps, finalHtml); // sin onDone: acá termina la partida
  } else {
    playNarrative(steps, finalHtml, () => socket.emit("day:advance"));
  }
});

// --- Ciclo Día ---

socket.on("day:discussion", ({ number, players, timeoutMs }) => {
  renderScreen(`
    <h1>💬 Discusión (Día #${number})</h1>
    <p class="subtitle">Discutan en persona quién puede ser sospechoso...</p>
    ${renderPlayerCircle(players, "🏘️")}
    <p class="night-timer" id="nightTimer"></p>
    <button id="advanceBtn" class="advance-btn">Pasar a la votación →</button>
  `);
  startCountdown(document.getElementById("nightTimer"), timeoutMs, (el, s) => {
    el.textContent = `⏳ ${s}s de discusión`;
  });
  document.getElementById("advanceBtn").addEventListener("click", () => {
    socket.emit("day:advance");
  });
});

socket.on("day:voting", ({ players, timeoutMs }) => {
  renderScreen(`
    <h1>🗳️ Votación</h1>
    <p class="subtitle">Cada uno vota en su celular a quién acusar (o se abstiene)...</p>
    ${renderPlayerCircle(players, "🗳️")}
    <p class="night-timer" id="nightTimer"></p>
  `);
  startCountdown(document.getElementById("nightTimer"), timeoutMs, (el, s) => {
    el.textContent = `⏳ ${s}s para votar`;
  });
});

socket.on("day:votingProgress", ({ votedIds }) => {
  document.querySelectorAll(".night-avatar").forEach((el) => el.classList.remove("done"));
  votedIds.forEach((id) => document.getElementById(`avatar-${id}`)?.classList.add("done"));
});

socket.on("day:noAccusation", ({ results }) => {
  const steps = [
    { html: narrativeBeat("🗳️", "Los votos quedan repartidos entre varios...") },
    { html: narrativeBeat("🤝", "Nadie logra ponerse de acuerdo. La aldea sigue igual.") },
  ];

  const finalHtml = `
    <h1>🤝 Nadie fue acusado</h1>
    ${renderVoteResults(results)}
  `;

  playNarrative(steps, finalHtml, () => socket.emit("day:advance"));
});

socket.on("day:defense", ({ accused, results, timeoutMs }) => {
  renderScreen(`
    <h1>⚖️ Defensa</h1>
    <p class="subtitle"><span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong> es el/la más acusado/a. Tiene la palabra...</p>
    ${renderVoteResults(results)}
    <p class="night-timer" id="nightTimer"></p>
    <button id="advanceBtn" class="advance-btn">Pasar al juicio →</button>
  `);
  startCountdown(document.getElementById("nightTimer"), timeoutMs, (el, s) => {
    el.textContent = `⏳ ${s}s para defenderse`;
  });
  document.getElementById("advanceBtn").addEventListener("click", () => {
    socket.emit("day:advance");
  });
});

socket.on("day:trial", ({ accused, timeoutMs }) => {
  renderScreen(`
    <h1>⚖️ Juicio</h1>
    <p class="subtitle"><span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong>: ¿culpable o inocente?</p>
    <p class="hint">El resto vota en su celular (${accused.name} no vota su propio juicio)...</p>
    <p class="hint" id="verdictProgress"></p>
    <p class="night-timer" id="nightTimer"></p>
  `);
  startCountdown(document.getElementById("nightTimer"), timeoutMs, (el, s) => {
    el.textContent = `⏳ ${s}s para el veredicto`;
  });
});

socket.on("day:verdictProgress", ({ votedIds }) => {
  const el = document.getElementById("verdictProgress");
  if (el) el.textContent = `Votaron ${votedIds.length}...`;
});

socket.on("day:resolved", ({ executed, guiltyCount, innocentCount, accused, deaths, winner, roster }) => {
  const steps = [
    { html: narrativeBeat("⚖️", "El pueblo se reúne bajo el sol para dictar sentencia...") },
    { html: narrativeBeat("🗣️", "Los votos se cuentan, uno por uno...") },
  ];

  const revenge = deaths.slice(1); // si el ejecutado era el Cazador, se lleva a alguien más

  if (executed) {
    steps.push({
      html: narrativeBeat(
        "💀",
        `<strong>${accused.icon} ${accused.name}</strong> es declarado/a culpable... y ejecutado/a ante la mirada de todos.`
      ),
      delayMs: 2600,
    });
    revenge.forEach((extra) => {
      steps.push({
        html: narrativeBeat(
          "🏹",
          `Pero antes de caer, algo se despierta... y arrastra también a <strong>${extra.icon} ${extra.name}</strong>.`
        ),
        delayMs: 2600,
      });
    });
  } else {
    steps.push({
      html: narrativeBeat(
        "🕊️",
        `La duda pesa más que la certeza... <strong>${accused.icon} ${accused.name}</strong> es absuelto/a.`
      ),
      delayMs: 2600,
    });
  }

  const extraDeathsHtml = revenge.length
    ? `<ul class="death-list">${revenge
        .map((d) => `<li>💀 <span class="death-icon">${d.icon}</span> <strong>${d.name}</strong> también murió.</li>`)
        .join("")}</ul>`
    : "";

  let finalHtml = `
    <h1>⚰️ Veredicto</h1>
    <p class="subtitle">
      ${
        executed
          ? `💀 <span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong> fue ejecutado/a.`
          : `✅ <span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong> fue absuelto/a. Sigue en el juego.`
      }
    </p>
    ${extraDeathsHtml}
    <p class="hint">Culpable: ${guiltyCount} · Inocente: ${innocentCount}</p>
  `;

  if (winner) {
    steps.push({ html: gameOverBeat(winner), delayMs: 2600 });
    finalHtml = gameOverFinalHtml(winner, roster);
    playNarrative(steps, finalHtml); // sin onDone: acá termina la partida
  } else {
    playNarrative(steps, finalHtml, () => socket.emit("day:advance"));
  }
});
