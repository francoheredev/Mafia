const GAME_ID = "mafia";
const socket = Platform.socket;

// Se guarda para poder reconstruir el lobby (QR incluido) cuando se reinicia
// la partida en la misma sala, sin tener que crear una sala nueva.
let currentRoomCode = null;

Platform.screenConnect.init({
  socket,
  gameId: GAME_ID,
  onCreated: async (code) => {
    currentRoomCode = code;
    document.getElementById("roomCode").textContent = code;

    const joinUrl = await Platform.screenConnect.buildJoinUrl(GAME_ID, code);
    new QRCode(document.getElementById("qrcode"), {
      text: joinUrl,
      width: 220,
      height: 220,
    });
  },
});

// --- Narrador (voz sintética) + efectos de sonido (Web Audio) ---
// Vive solo acá, en la pantalla compartida: es la "TV" de la mesa, así que
// es el único dispositivo que tiene sentido que narre y suene — los
// celulares no deberían sumar su propio audio por separado.
let soundEnabled = true;
let audioCtx = null;

// La voz del narrador (Web Speech API) quedó apagada a pedido del usuario —
// no le convenció cómo sonaba — hasta que se retome y se ajuste. El resto
// del audio (música ambiente + stingers) sigue activo. Para reactivarla
// alcanza con volver esto a `true`.
const NARRATOR_ENABLED = false;

function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

// Extrae el texto plano de un narrativeBeat (o cualquier HTML) para narrarlo
// con el mismo contenido que ya se muestra en pantalla, sin duplicarlo.
function stripToSpeech(html) {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function speak(text) {
  if (!NARRATOR_ENABLED || !soundEnabled || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const esVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith("es"));
  if (esVoice) utter.voice = esVoice;
  utter.lang = esVoice?.lang || "es-ES";
  utter.rate = 0.95;
  window.speechSynthesis.speak(utter);
}

// Sting corto (3 notas) para un momento puntual — no es un loop.
function playStinger(kind) {
  if (!soundEnabled) return;
  const ctx = ensureAudioCtx();
  const notes = {
    death: [220, 196, 174.6],
    victory: [392, 523.25, 659.25],
    ominous: [174.6, 155.6, 130.8],
    neutral: [261.6, 246.9, 220],
  }[kind];
  if (!notes) return;

  let t = ctx.currentTime;
  notes.forEach((freq) => {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    g.gain.value = 0;
    osc.connect(g).connect(ctx.destination);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.05);
    g.gain.linearRampToValueAtTime(0, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.45);
    t += 0.35;
  });
}

// Desbloquea audio/voz ante el primer gesto del usuario (los navegadores no
// dejan sonar nada antes de eso) — se llama en cada click de "Empezar
// partida", que siempre ocurre antes de la primera noche.
function unlockSound() {
  ensureAudioCtx();
  if (window.speechSynthesis) {
    const warmup = new SpeechSynthesisUtterance(" ");
    warmup.volume = 0;
    window.speechSynthesis.speak(warmup);
  }
}

const soundFab = document.getElementById("soundFab");
soundFab.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundFab.textContent = soundEnabled ? "🔊" : "🔇";
  if (!soundEnabled) {
    window.speechSynthesis?.cancel();
  }
});

socket.on("lobby:update", ({ players }) => {
  const list = document.getElementById("playerList");
  const startBtn = document.getElementById("startBtn");
  Platform.roster.renderLobbyList(list, players, {
    onCount: (count) => {
      document.getElementById("playerCount").textContent = count;
      startBtn.disabled = count < 6 || count > 10;
    },
  });
});

document.getElementById("startBtn").addEventListener("click", () => {
  unlockSound();
  const startError = document.getElementById("startError");
  startError.textContent = "";
  socket.emit("game:start", null, (res) => {
    if (!res.ok) startError.textContent = res.error;
  });
});

// Cronómetro: el servidor es la autoridad y manda un tick por segundo con el
// tiempo restante de la fase actual. Cada fase con cuenta regresiva visible
// setea `timerFormat` con el texto que le corresponde antes de que lleguen
// los ticks; el resto del tiempo (fases sin cronómetro, narrativa) el
// `#timerDisplay` no existe y el handler no hace nada.
let timerFormat = null;
socket.on("timer:tick", ({ secondsLeft }) => {
  const el = document.getElementById("timerDisplay");
  if (el && timerFormat) el.textContent = timerFormat(secondsLeft);
});

// --- Tutorial de reglas y roles, disponible en cualquier momento (la
//     muestra automática al arrancar vive dentro de game:started, más
//     abajo — este botón es solo para reabrirlo después). ---
function buildRulesModalHtml() {
  const data = window.GAME_RULES || { allRoles: [], generalRules: [] };
  const rolesHtml = data.allRoles
    .map(
      (r) => `
        <div class="role-chip team-${r.team}">
          <span class="role-chip-icon">${r.icon}</span>
          <span class="role-chip-name">${r.name}</span>
          <p class="role-chip-tip">${r.tip}</p>
        </div>
      `
    )
    .join("");
  const rulesHtml_ = data.generalRules
    .map((s) => `<div class="rules-section"><h3>${s.icon} ${s.title}</h3><p>${s.text}</p></div>`)
    .join("");
  return `
    <h2>📖 Cómo se juega</h2>
    <div class="rules-summary">${rulesHtml_}</div>
    <h2>🎭 Catálogo de roles</h2>
    <div class="roles-catalog">${rolesHtml}</div>
  `;
}
Platform.rules.init({
  fabId: "rulesFab",
  modalId: "rulesModal",
  closeId: "rulesModalClose",
  contentId: "rulesModalContent",
  buildHtml: buildRulesModalHtml,
});

// --- Panel del host: ver jugadores y expulsar (player:kick es un evento
//     genérico de la plataforma; el render de este panel puntual es propio
//     de Mafia por el detalle de "alive" que muestra). ---
const hostModalContent = document.getElementById("hostModalContent");

function renderHostRoster(players) {
  hostModalContent.innerHTML = players
    .map((p) => {
      const dead = p.alive === false;
      const status = dead ? " 💀" : p.connected ? "" : " (desconectado)";
      return `
        <li>
          <span>${p.icon || "❔"} ${p.name}${status}</span>
          <button class="kick-btn" data-id="${p.id}" ${dead ? "disabled" : ""}>✕ Expulsar</button>
        </li>
      `;
    })
    .join("");
  hostModalContent.querySelectorAll(".kick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      socket.emit("player:kick", { targetId: btn.dataset.id }, (res) => {
        if (res.ok) openHostModal();
      });
    });
  });
}
function openHostModal() {
  socket.emit("screen:getRoster", null, (res) => {
    if (res.ok) renderHostRoster(res.players);
  });
}
Platform.wireModal({ fabId: "hostFab", modalId: "hostModal", closeId: "hostModalClose", onOpen: openHostModal });

socket.on("player:removed", ({ removedIds }) => {
  removedIds.forEach((id) => document.getElementById(`avatar-${id}`)?.remove());
});

// --- Historial público de la partida ---
Platform.history.init({ socket, fabId: "historyFab", modalId: "historyModal", closeId: "historyModalClose", listId: "historyList" });

// Todo reemplazo de la pantalla principal pasa por acá — así cualquier paso
// de narrativa que haya quedado pendiente de la fase anterior se corta
// antes de que la fase nueva se dibuje encima.
let narrativeTimer = null;
function renderScreen(html) {
  clearTimeout(narrativeTimer);
  document.querySelector(".lobby-screen").innerHTML = html;
}

// Reconstruye la pantalla de lobby (mismo markup que trae screen.html al
// cargar) — hace falta después de un game:restart, porque para ese momento
// renderScreen ya reemplazó ese contenido varias veces con las pantallas de
// noche/día/fin de partida.
async function renderLobbyShell(code) {
  renderScreen(`
    <h1>🐺 La Mafia</h1>
    <p class="subtitle">Escaneá el código con tu celular para unirte</p>
    <div class="code-panel">
      <div id="qrcode"></div>
      <div class="room-code" id="roomCode">${code}</div>
    </div>
    <section class="players-panel">
      <h2>Jugadores en la sala (<span id="playerCount">0</span>)</h2>
      <ul id="playerList" class="player-list"></ul>
      <p class="hint">Necesitás mínimo 6 jugadores para arrancar (ver GDD).</p>
      <button id="startBtn" disabled>Empezar partida</button>
      <p id="startError" class="error"></p>
    </section>
  `);
  new QRCode(document.getElementById("qrcode"), {
    text: await Platform.screenConnect.buildJoinUrl(GAME_ID, code),
    width: 220,
    height: 220,
  });
  document.getElementById("startBtn").addEventListener("click", () => {
    unlockSound();
    const startError = document.getElementById("startError");
    startError.textContent = "";
    socket.emit("game:start", null, (res) => {
      if (!res.ok) startError.textContent = res.error;
    });
  });
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
    speak(stripToSpeech(steps[i].html));
    if (steps[i].sfx) playStinger(steps[i].sfx);
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

// Como playNarrative, pero cada paso espera un clic del anfitrión en vez de
// avanzar solo por tiempo — para secuencias que el anfitrión quiere leer (o
// leer en voz alta) a su propio ritmo, como la intro de reglas + roles.
// `steps`: [{ html, nextLabel? }]. El botón del último paso llama a
// `onComplete` en vez de pasar al siguiente.
function playNarrativeManual(steps, onComplete) {
  clearTimeout(narrativeTimer);
  const container = document.querySelector(".lobby-screen");
  let i = 0;
  function render() {
    const isLast = i === steps.length - 1;
    const label = steps[i].nextLabel || (isLast ? "Continuar →" : "Siguiente →");
    container.classList.remove("narrative-fade-in");
    container.innerHTML = `${steps[i].html}<button id="narrativeAdvanceBtn" class="advance-btn">${label}</button>`;
    void container.offsetWidth; // reinicia la animación CSS
    container.classList.add("narrative-fade-in");
    speak(stripToSpeech(steps[i].html));
    document.getElementById("narrativeAdvanceBtn").addEventListener("click", () => {
      if (isLast) {
        onComplete?.();
      } else {
        i++;
        render();
      }
    });
  }
  render();
}

function roleIntroBeat(r) {
  return `
    <div class="narrative-beat">
      <div class="role-chip team-${r.team}">
        <span class="role-chip-icon">${r.icon}</span>
        <span class="role-chip-name">${r.narrativeName}${r.count > 1 ? ` ×${r.count}` : ""}</span>
        <p class="role-chip-tip">${r.tip}</p>
      </div>
    </div>
  `;
}

socket.on("game:started", ({ playerCount, roles }) => {
  const ruleSteps = (window.GAME_RULES?.generalRules || []).map((s) => ({
    html: narrativeBeat(s.icon, `<strong>${s.title}</strong><br>${s.text}`),
  }));
  const roleSteps = roles.map((r) => ({ html: roleIntroBeat(r) }));

  const steps = [
    {
      html: `
        <h1>🎭 Roles repartidos</h1>
        <p class="subtitle">${playerCount} jugadores ya tienen su rol en el celular.</p>
        <p class="hint">Antes de que caiga la noche, repasemos cómo se juega...</p>
      `,
      nextLabel: "Empezar →",
    },
    ...ruleSteps,
    { html: `<p class="hint">Estos son los roles en juego esta partida (en secreto, cada quien sabe el suyo):</p>`, nextLabel: "Ver roles →" },
    ...roleSteps,
  ];
  steps[steps.length - 1].nextLabel = "🌙 Que caiga la noche";

  playNarrativeManual(steps, () => socket.emit("day:advance"));
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
  if (winner === "bufon") {
    return narrativeBeat("🃏", "El pueblo cae en la trampa: ¡acaban de expulsar al Bufón!");
  }
  return narrativeBeat("🤝", "No queda nadie en pie para contarlo...");
}

// Sting al llegar al resultado final de la partida.
function playGameOverSting(winner) {
  if (winner === "mafia") playStinger("ominous");
  else if (winner === "ciudad" || winner === "bufon") playStinger("victory");
  else playStinger("neutral");
}

function gameOverFinalHtml(winner, roster) {
  const title =
    winner === "mafia"
      ? "🐺 ¡Gana la Mafia!"
      : winner === "ciudad"
      ? "🏘️ ¡Gana la Ciudad!"
      : winner === "bufon"
      ? "🃏 ¡Gana el Bufón!"
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
    <button id="restartBtn" class="advance-btn">🔁 Reiniciar partida (misma sala)</button>
    <p id="restartError" class="error"></p>
  `;
}

// Engancha el botón de reinicio de gameOverFinalHtml — se llama después de
// cada lugar donde esa pantalla queda pintada en el DOM (playNarrative la
// reemplaza por innerHTML, así que el listener anterior no sobrevive).
function attachRestartHandler() {
  document.getElementById("restartBtn")?.addEventListener("click", () => {
    socket.emit("game:restart", null, (res) => {
      if (!res.ok) {
        const el = document.getElementById("restartError");
        if (el) el.textContent = res.error;
      }
    });
  });
}

// Fin de partida disparado por un kick (no por una resolución de noche/día):
// no es un "momento" de la ficción del juego, así que va directo al
// resultado final sin la secuencia narrativa.
socket.on("game:over", ({ winner, roster }) => {
  playGameOverSting(winner);
  renderScreen(gameOverFinalHtml(winner, roster));
  attachRestartHandler();
});

// La pantalla vuelve al lobby de la misma sala después de un reinicio.
socket.on("game:restarted", () => {
  window.speechSynthesis?.cancel();
  renderLobbyShell(currentRoomCode);
});

socket.on("night:begin", ({ number, players }) => {
  renderScreen(`
    <h1>🌙 Cae la noche (#${number})</h1>
    <p class="subtitle">Los jugadores están decidiendo en su celular...</p>
    ${renderPlayerCircle(players, "🔥")}
    <ul class="night-progress">
      <li id="npMafia">🐺 La Mafia elige a su víctima…</li>
      <li id="npDetective">🔮 El Vidente investiga…</li>
      <li id="npMedico">💊 El Médico protege…</li>
    </ul>
    <p class="night-timer" id="timerDisplay"></p>
  `);

  timerFormat = (s) => `⏳ ${s}s para que todos decidan`;
  speak(`Cae la noche número ${number}. Todos deciden en su celular.`);
});

socket.on("night:resolved", ({ number, deaths, transformations, saved, winner, roster }) => {
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
        sfx: "death",
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
        sfx: "death",
      });
    });
  }

  // Alguien sobrevivió a un ataque que debería haberlo matado — evento
  // observable en la ficción (a diferencia de reveals/silencios, que son
  // secretos y nunca llegan a la pantalla compartida).
  (transformations || []).forEach((t) => {
    steps.push({
      html: narrativeBeat(
        "🐺",
        `¡<strong>${t.icon} ${t.name}</strong> no pudo ser abatido/a! Algo despierta en su interior... y ahora corre con la Mafia.`
      ),
      delayMs: 2600,
      sfx: "ominous",
    });
  });

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
    playNarrative(steps, finalHtml, () => {
      playGameOverSting(winner);
      attachRestartHandler();
    });
  } else {
    playNarrative(steps, finalHtml, () => socket.emit("day:advance"));
  }
});

// --- Ciclo Día ---

socket.on("day:discussion", ({ number, players }) => {
  renderScreen(`
    <h1>💬 Discusión (Día #${number})</h1>
    <p class="subtitle">Discutan en persona quién puede ser sospechoso...</p>
    ${renderPlayerCircle(players, "🏘️")}
    <p class="night-timer" id="timerDisplay"></p>
    <button id="advanceBtn" class="advance-btn">Pasar a la votación →</button>
  `);
  timerFormat = (s) => `⏳ ${s}s de discusión`;
  document.getElementById("advanceBtn").addEventListener("click", () => {
    socket.emit("day:advance");
  });
  speak("Comienza la discusión del día.");
});

socket.on("day:voting", ({ players }) => {
  renderScreen(`
    <h1>🗳️ Votación</h1>
    <p class="subtitle">Cada uno vota en su celular a quién acusar (o se abstiene)...</p>
    ${renderPlayerCircle(players, "🗳️")}
    <p class="night-timer" id="timerDisplay"></p>
  `);
  timerFormat = (s) => `⏳ ${s}s para votar`;
  speak("Es hora de votar.");
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

socket.on("day:defense", ({ accused, results }) => {
  renderScreen(`
    <h1>⚖️ Defensa</h1>
    <p class="subtitle"><span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong> es el/la más acusado/a. Tiene la palabra...</p>
    ${renderVoteResults(results)}
    <p class="night-timer" id="timerDisplay"></p>
    <button id="advanceBtn" class="advance-btn">Pasar al juicio →</button>
  `);
  timerFormat = (s) => `⏳ ${s}s para defenderse`;
  document.getElementById("advanceBtn").addEventListener("click", () => {
    socket.emit("day:advance");
  });
  speak(`${accused.name} tiene la palabra para defenderse.`);
});

socket.on("day:trial", ({ accused }) => {
  renderScreen(`
    <h1>⚖️ Juicio</h1>
    <p class="subtitle"><span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong>: ¿culpable o inocente?</p>
    <p class="hint">El resto vota en su celular (${accused.name} no vota su propio juicio)...</p>
    <p class="hint" id="verdictProgress"></p>
    <p class="night-timer" id="timerDisplay"></p>
  `);
  timerFormat = (s) => `⏳ ${s}s para el veredicto`;
  speak(`¿Es ${accused.name} culpable o inocente?`);
});

socket.on("day:verdictProgress", ({ votedIds }) => {
  const el = document.getElementById("verdictProgress");
  if (el) el.textContent = `Votaron ${votedIds.length}...`;
});

socket.on("day:resolved", ({ executed, guiltyCount, innocentCount, accused, deaths, transformations, winner, roster }) => {
  const steps = [
    { html: narrativeBeat("⚖️", "El pueblo se reúne bajo el sol para dictar sentencia...") },
    { html: narrativeBeat("🗣️", "Los votos se cuentan, uno por uno...") },
  ];

  const revenge = deaths.slice(1); // si el ejecutado era el Cazador, se lleva a alguien más
  // El Lycan sobrevive a su propia ejecución (ver killPlayer en logic.js) —
  // si es el caso, "executed" sigue en true pero nadie murió realmente.
  const accusedTransformed = (transformations || []).some((t) => t.id === accused.id);

  if (executed) {
    steps.push({
      html: narrativeBeat(
        "💀",
        `<strong>${accused.icon} ${accused.name}</strong> es declarado/a culpable... y ejecutado/a ante la mirada de todos.`
      ),
      delayMs: 2600,
      sfx: "death",
    });
    revenge.forEach((extra) => {
      steps.push({
        html: narrativeBeat(
          "🏹",
          `Pero antes de caer, algo se despierta... y arrastra también a <strong>${extra.icon} ${extra.name}</strong>.`
        ),
        delayMs: 2600,
        sfx: "death",
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

  (transformations || []).forEach((t) => {
    steps.push({
      html: narrativeBeat(
        "🐺",
        `¡<strong>${t.icon} ${t.name}</strong> no pudo ser abatido/a! Algo despierta en su interior... y ahora corre con la Mafia.`
      ),
      delayMs: 2600,
      sfx: "ominous",
    });
  });

  const extraDeathsHtml = revenge.length
    ? `<ul class="death-list">${revenge
        .map((d) => `<li>💀 <span class="death-icon">${d.icon}</span> <strong>${d.name}</strong> también murió.</li>`)
        .join("")}</ul>`
    : "";

  let finalHtml = `
    <h1>⚰️ Veredicto</h1>
    <p class="subtitle">
      ${
        executed && accusedTransformed
          ? `🐺 <span class="accused-icon">${accused.icon}</span> <strong>${accused.name}</strong> sobrevivió a la ejecución... y ahora es parte de la Mafia.`
          : executed
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
    playNarrative(steps, finalHtml, () => {
      playGameOverSting(winner);
      attachRestartHandler();
    });
  } else {
    playNarrative(steps, finalHtml, () => socket.emit("day:advance"));
  }
});
