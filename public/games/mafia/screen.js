const GAME_ID = "mafia";
const socket = Platform.socket;
const { t, tError, role } = Platform.i18n;

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
  const voice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith(Platform.i18n.lang));
  if (voice) utter.voice = voice;
  utter.lang = voice?.lang || Platform.i18n.lang;
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
    if (!res.ok) startError.textContent = tError(res);
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
          <span class="role-chip-name">${role(r.roleId, "name")}</span>
          <p class="role-chip-tip">${role(r.roleId, "tip")}</p>
        </div>
      `
    )
    .join("");
  const rulesHtml_ = data.generalRules
    .map((s) => `<div class="rules-section"><h3>${s.icon} ${t(s.titleKey)}</h3><p>${t(s.textKey)}</p></div>`)
    .join("");
  return `
    <h2>${t("mafia.rulesModal.howToPlay")}</h2>
    <div class="rules-summary">${rulesHtml_}</div>
    <h2>${t("mafia.rulesModal.catalog")}</h2>
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
      const status = dead ? " 💀" : p.connected ? "" : t("platform.disconnected");
      return `
        <li>
          <span>${p.icon || "❔"} ${p.name}${status}</span>
          <button class="kick-btn" data-id="${p.id}" ${dead ? "disabled" : ""}>${t("mafia.screen.kick")}</button>
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
    <h1>${t("mafia.title")}</h1>
    <p class="subtitle">${t("mafia.screen.scanToJoin")}</p>
    <div class="code-panel">
      <div id="qrcode"></div>
      <div class="room-code" id="roomCode">${code}</div>
    </div>
    <section class="players-panel">
      <h2>${t("mafia.screen.playersInRoom")} (<span id="playerCount">0</span>)</h2>
      <ul id="playerList" class="player-list"></ul>
      <p class="hint">${t("mafia.screen.minPlayers")}</p>
      <button id="startBtn" disabled>${t("mafia.screen.start")}</button>
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
      if (!res.ok) startError.textContent = tError(res);
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
    const label = steps[i].nextLabel || t(isLast ? "mafia.screen.continue" : "mafia.screen.next");
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
        <span class="role-chip-name">${role(r.roleId, "narrativeName")}${r.count > 1 ? ` ×${r.count}` : ""}</span>
        <p class="role-chip-tip">${role(r.roleId, "tip")}</p>
      </div>
    </div>
  `;
}

socket.on("game:started", ({ playerCount, roles }) => {
  const ruleSteps = (window.GAME_RULES?.generalRules || []).map((s) => ({
    html: narrativeBeat(s.icon, `<strong>${t(s.titleKey)}</strong><br>${t(s.textKey)}`),
  }));
  const roleSteps = roles.map((r) => ({ html: roleIntroBeat(r) }));

  const steps = [
    {
      html: `
        <h1>${t("mafia.screen.rolesDealt")}</h1>
        <p class="subtitle">${t("mafia.screen.rolesDealtSubtitle", { count: playerCount })}</p>
        <p class="hint">${t("mafia.screen.rulesIntro")}</p>
      `,
      nextLabel: t("mafia.screen.begin"),
    },
    ...ruleSteps,
    { html: `<p class="hint">${t("mafia.screen.rolesInPlay")}</p>`, nextLabel: t("mafia.screen.seeRoles") },
    ...roleSteps,
  ];
  steps[steps.length - 1].nextLabel = t("mafia.screen.letNightFall");

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
    .map((r) => `<li>${r.icon} <strong>${r.name}</strong> — ${t(r.votes === 1 ? "mafia.screen.votes.one" : "mafia.screen.votes.other", { count: r.votes })}</li>`)
    .join("")}</ul>`;
}

// Pantalla de fin de partida: anuncia el bando ganador (o empate) y revela
// el rol de todos — a diferencia de una muerte puntual, el cierre del juego
// sí muestra quién era quién.
function gameOverBeat(winner) {
  if (winner === "mafia") {
    return narrativeBeat("🐺", t("mafia.screen.beat.mafiaWins"));
  }
  if (winner === "ciudad") {
    return narrativeBeat("🏘️", t("mafia.screen.beat.ciudadWins"));
  }
  if (winner === "bufon") {
    return narrativeBeat("🃏", t("mafia.screen.beat.bufonWins"));
  }
  return narrativeBeat("🤝", t("mafia.screen.beat.draw"));
}

// Sting al llegar al resultado final de la partida.
function playGameOverSting(winner) {
  if (winner === "mafia") playStinger("ominous");
  else if (winner === "ciudad" || winner === "bufon") playStinger("victory");
  else playStinger("neutral");
}

function gameOverFinalHtml(winner, roster) {
  const title = t(
    winner === "mafia"
      ? "mafia.screen.title.mafiaWins"
      : winner === "ciudad"
      ? "mafia.screen.title.ciudadWins"
      : winner === "bufon"
      ? "mafia.screen.title.bufonWins"
      : "mafia.screen.title.draw"
  );
  const rosterHtml = (roster || [])
    .map(
      (p) => `
        <div class="role-chip team-${p.team}">
          <span class="role-chip-icon">${p.icon}</span>
          <span class="role-chip-name">${p.name} — ${role(p.roleId, "narrativeName")}${p.alive ? "" : " 💀"}</span>
        </div>
      `
    )
    .join("");
  return `
    <h1>${title}</h1>
    <p class="subtitle">${t("mafia.screen.gameOverSubtitle")}</p>
    <div class="roles-catalog">${rosterHtml}</div>
    <button id="restartBtn" class="advance-btn">${t("mafia.screen.restart")}</button>
    <p id="restartError" class="error"></p>
    <a href="/" class="advance-btn back-to-menu">${t("mafia.screen.backToMenu")}</a>
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
        if (el) el.textContent = tError(res);
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
    <h1>${t("mafia.screen.nightTitle", { number })}</h1>
    <p class="subtitle">${t("mafia.screen.nightSubtitle")}</p>
    ${renderPlayerCircle(players, "🔥")}
    <ul class="night-progress">
      <li id="npMafia">${t("mafia.screen.npMafia")}</li>
      <li id="npDetective">${t("mafia.screen.npDetective")}</li>
      <li id="npMedico">${t("mafia.screen.npMedico")}</li>
    </ul>
    <p class="night-timer" id="timerDisplay"></p>
  `);

  timerFormat = (s) => t("mafia.screen.timer.night", { seconds: s });
  speak(t("mafia.screen.speak.night", { number }));
});

socket.on("night:resolved", ({ number, deaths, transformations, saved, winner, roster }) => {
  const steps = [
    { html: narrativeBeat("🌫️", t("mafia.screen.beat.fog")) },
    { html: narrativeBeat("🐺", t("mafia.screen.beat.mafiaLurks")) },
  ];

  if (deaths.length === 0) {
    steps.push({
      html: saved
        ? narrativeBeat("💊", t("mafia.screen.beat.saved"))
        : narrativeBeat("🌙", t("mafia.screen.beat.noChance")),
    });
  } else {
    const [victim, ...rest] = deaths;
    steps.push(
      {
        html: narrativeBeat("🩸", t("mafia.screen.beat.pounce", { icon: victim.icon, name: victim.name })),
        delayMs: 2600,
      },
      {
        html: narrativeBeat("💀", t("mafia.screen.beat.dawnWithout", { name: victim.name })),
        delayMs: 2600,
        sfx: "death",
      }
    );
    rest.forEach((extra) => {
      // No se nombra el rol acá — la venganza del Cazador ya se infiere
      // por eliminación, no hace falta subrayarlo.
      steps.push({
        html: narrativeBeat("🏹", t("mafia.screen.beat.hunterRevenge", { icon: extra.icon, name: extra.name })),
        delayMs: 2600,
        sfx: "death",
      });
    });
  }

  // Alguien sobrevivió a un ataque que debería haberlo matado — evento
  // observable en la ficción (a diferencia de reveals/silencios, que son
  // secretos y nunca llegan a la pantalla compartida).
  (transformations || []).forEach((tr) => {
    steps.push({
      html: narrativeBeat("🐺", t("mafia.screen.beat.lycanTurns", { icon: tr.icon, name: tr.name })),
      delayMs: 2600,
      sfx: "ominous",
    });
  });

  let finalHtml;
  if (deaths.length === 0) {
    finalHtml = `
      <h1>${t("mafia.screen.dawnTitle", { number })}</h1>
      <p class="hint">${t(saved ? "mafia.screen.dawnSaved" : "mafia.screen.dawnNoAttack")}</p>
    `;
  } else {
    finalHtml = `
      <h1>${t("mafia.screen.dawnTitle", { number })}</h1>
      <ul class="death-list">${deaths
        .map(
          (d) =>
            `<li>💀 <span class="death-icon">${d.icon}</span> ${t("mafia.screen.diedTonight", { name: d.name })}</li>`
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
    <h1>${t("mafia.screen.discussionTitle", { number })}</h1>
    <p class="subtitle">${t("mafia.screen.discussionSubtitle")}</p>
    ${renderPlayerCircle(players, "🏘️")}
    <p class="night-timer" id="timerDisplay"></p>
    <button id="advanceBtn" class="advance-btn">${t("mafia.screen.toVoting")}</button>
  `);
  timerFormat = (s) => t("mafia.screen.timer.discussion", { seconds: s });
  document.getElementById("advanceBtn").addEventListener("click", () => {
    socket.emit("day:advance");
  });
  speak(t("mafia.screen.speak.discussion"));
});

socket.on("day:voting", ({ players }) => {
  renderScreen(`
    <h1>${t("mafia.screen.votingTitle")}</h1>
    <p class="subtitle">${t("mafia.screen.votingSubtitle")}</p>
    ${renderPlayerCircle(players, "🗳️")}
    <p class="night-timer" id="timerDisplay"></p>
  `);
  timerFormat = (s) => t("mafia.screen.timer.voting", { seconds: s });
  speak(t("mafia.screen.speak.voting"));
});

socket.on("day:votingProgress", ({ votedIds }) => {
  document.querySelectorAll(".night-avatar").forEach((el) => el.classList.remove("done"));
  votedIds.forEach((id) => document.getElementById(`avatar-${id}`)?.classList.add("done"));
});

socket.on("day:noAccusation", ({ results }) => {
  const steps = [
    { html: narrativeBeat("🗳️", t("mafia.screen.beat.votesSplit")) },
    { html: narrativeBeat("🤝", t("mafia.screen.beat.noAgreement")) },
  ];

  const finalHtml = `
    <h1>${t("mafia.screen.noAccusationTitle")}</h1>
    ${renderVoteResults(results)}
  `;

  playNarrative(steps, finalHtml, () => socket.emit("day:advance"));
});

socket.on("day:defense", ({ accused, results }) => {
  renderScreen(`
    <h1>${t("mafia.screen.defenseTitle")}</h1>
    <p class="subtitle"><span class="accused-icon">${accused.icon}</span> ${t("mafia.screen.defenseSubtitle", { name: accused.name })}</p>
    ${renderVoteResults(results)}
    <p class="night-timer" id="timerDisplay"></p>
    <button id="advanceBtn" class="advance-btn">${t("mafia.screen.toTrial")}</button>
  `);
  timerFormat = (s) => t("mafia.screen.timer.defense", { seconds: s });
  document.getElementById("advanceBtn").addEventListener("click", () => {
    socket.emit("day:advance");
  });
  speak(t("mafia.screen.speak.defense", { name: accused.name }));
});

socket.on("day:trial", ({ accused }) => {
  renderScreen(`
    <h1>${t("mafia.screen.trialTitle")}</h1>
    <p class="subtitle"><span class="accused-icon">${accused.icon}</span> ${t("mafia.screen.trialSubtitle", { name: accused.name })}</p>
    <p class="hint">${t("mafia.screen.trialHint", { name: accused.name })}</p>
    <p class="hint" id="verdictProgress"></p>
    <p class="night-timer" id="timerDisplay"></p>
  `);
  timerFormat = (s) => t("mafia.screen.timer.trial", { seconds: s });
  speak(t("mafia.screen.speak.trial", { name: accused.name }));
});

socket.on("day:verdictProgress", ({ votedIds }) => {
  const el = document.getElementById("verdictProgress");
  if (el) el.textContent = t("mafia.screen.verdictProgress", { count: votedIds.length });
});

socket.on("day:resolved", ({ executed, guiltyCount, innocentCount, accused, deaths, transformations, winner, roster }) => {
  const steps = [
    { html: narrativeBeat("⚖️", t("mafia.screen.beat.sentence")) },
    { html: narrativeBeat("🗣️", t("mafia.screen.beat.counting")) },
  ];

  const revenge = deaths.slice(1); // si el ejecutado era el Cazador, se lleva a alguien más
  // El Lycan sobrevive a su propia ejecución (ver killPlayer en logic.js) —
  // si es el caso, "executed" sigue en true pero nadie murió realmente.
  const accusedTransformed = (transformations || []).some((t) => t.id === accused.id);

  if (executed) {
    steps.push({
      html: narrativeBeat("💀", t("mafia.screen.beat.executed", { icon: accused.icon, name: accused.name })),
      delayMs: 2600,
      sfx: "death",
    });
    revenge.forEach((extra) => {
      steps.push({
        html: narrativeBeat("🏹", t("mafia.screen.beat.hunterRevenge", { icon: extra.icon, name: extra.name })),
        delayMs: 2600,
        sfx: "death",
      });
    });
  } else {
    steps.push({
      html: narrativeBeat("🕊️", t("mafia.screen.beat.acquitted", { icon: accused.icon, name: accused.name })),
      delayMs: 2600,
    });
  }

  (transformations || []).forEach((tr) => {
    steps.push({
      html: narrativeBeat("🐺", t("mafia.screen.beat.lycanTurns", { icon: tr.icon, name: tr.name })),
      delayMs: 2600,
      sfx: "ominous",
    });
  });

  const extraDeathsHtml = revenge.length
    ? `<ul class="death-list">${revenge
        .map((d) => `<li>💀 <span class="death-icon">${d.icon}</span> ${t("mafia.screen.alsoDied", { name: d.name })}</li>`)
        .join("")}</ul>`
    : "";

  let finalHtml = `
    <h1>${t("mafia.screen.verdictTitle")}</h1>
    <p class="subtitle">
      ${
        executed && accusedTransformed
          ? `🐺 <span class="accused-icon">${accused.icon}</span> ${t("mafia.screen.verdict.survived", { name: accused.name })}`
          : executed
          ? `💀 <span class="accused-icon">${accused.icon}</span> ${t("mafia.screen.verdict.executed", { name: accused.name })}`
          : `✅ <span class="accused-icon">${accused.icon}</span> ${t("mafia.screen.verdict.acquitted", { name: accused.name })}`
      }
    </p>
    ${extraDeathsHtml}
    <p class="hint">${t("mafia.screen.verdictCount", { guilty: guiltyCount, innocent: innocentCount })}</p>
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
