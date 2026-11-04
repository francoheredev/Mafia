const GAME_ID = "mafia";
const socket = Platform.socket;
const { t, tError, tMessage, role: roleText } = Platform.i18n;

// Selector de idioma en la pantalla de unirse (se oculta al entrar a la
// sala, ver i18n.js), y el "Estás adentro" con el hueco #myName que
// completa connect.js al unirse.
const langSelector = document.getElementById("langSelector");
Platform.i18n.renderSelector(langSelector);
const hideLangSelector = () => langSelector.classList.add("hidden");
Platform.i18n.ready.then(() => {
  document.getElementById("youAreIn").innerHTML = t("mafia.player.youAreIn", { name: '<strong id="myName"></strong>' });
});

// Feedback táctil en los momentos de tensión del juego. navigator.vibrate
// solo existe en Android/Chrome — en iPhone (Safari) el `if` de acá adentro
// hace que simplemente no vibre, sin romper nada.
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
const VIBRATE = {
  night: [80, 40, 80, 40, 160],
  death: [200, 100, 200, 100, 400],
  accused: [120, 60, 120],
  transform: [100, 50, 100, 50, 100, 50, 300],
};

// Se prende cuando el jugador muere/es ejecutado, para habilitar la pestaña
// de chat de "fantasmas" — se resetea al reiniciar la partida.
let amIDead = false;

let wasKicked = false;
const connectHandle = Platform.playerConnect.init({
  socket,
  gameId: GAME_ID,
  formId: "joinForm",
  codeInputId: "codeInput",
  nameInputId: "nameInput",
  errorId: "errorMsg",
  waitingId: "waitingRoom",
  myNameId: "myName",
  onJoined: hideLangSelector,
  onRejoined: hideLangSelector,
});

function teamLabel(team) {
  return t(`mafia.player.team.${team === "mafia" || team === "ciudad" ? team : "independiente"}`);
}

function buildRoleCardHtml(role) {
  const accomplicesHtml =
    role.accomplices && role.accomplices.length
      ? `<p class="accomplices">${t("mafia.player.accomplices", { names: role.accomplices.join(", ") })}</p>`
      : "";
  const loverHtml = myLoverInfo
    ? `<p class="lover-info">${t("mafia.player.lover", { icon: myLoverInfo.icon, name: myLoverInfo.name, role: roleText(myLoverInfo.roleId, "name") })}</p>`
    : "";
  return `
    <div class="role-card team-${role.team}">
      <p class="role-team">${teamLabel(role.team)}</p>
      <div class="role-icon">${role.icon}</div>
      <h2>${roleText(role.roleId, "narrativeName")}</h2>
      <p class="role-desc">${roleText(role.roleId, "description")}</p>
      ${accomplicesHtml}
      ${loverHtml}
    </div>
  `;
}

// Se guardan en memoria para que el botón "ver mi rol" pueda mostrarlo de
// nuevo en cualquier momento, aunque la pantalla de #waitingRoom ya haya
// cambiado varias veces.
let myRole = null;
let myLoverInfo = null; // { id, name, icon, roleId, roleName, narrativeName, team }

const roleFab = document.getElementById("roleFab");
const rulesFab = document.getElementById("rulesFab");
const roleModalContent = document.getElementById("roleModalContent");

Platform.wireModal({
  fabId: "roleFab",
  modalId: "roleModal",
  closeId: "roleModalClose",
  onOpen: () => {
    if (myRole) roleModalContent.innerHTML = buildRoleCardHtml(myRole);
  },
});

// --- Tutorial de reglas y roles: disponible desde el lobby (no es secreto,
//     a diferencia del rol propio), y se abre solo una vez automáticamente
//     al arrancar la partida. ---
function buildRulesModalHtml() {
  const data = window.GAME_RULES || { allRoles: [], generalRules: [] };
  const rolesHtml = data.allRoles
    .map(
      (r) => `
        <div class="role-chip team-${r.team}">
          <span class="role-chip-icon">${r.icon}</span>
          <span class="role-chip-name">${roleText(r.roleId, "name")}</span>
          <p class="role-chip-tip">${roleText(r.roleId, "tip")}</p>
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

socket.on("role:assigned", (role) => {
  myRole = role;
  roleFab.classList.remove("hidden");

  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.classList.remove("hidden");
  waitingRoom.innerHTML = `
    ${buildRoleCardHtml(role)}
    <p class="hint">${t("mafia.player.memorize")}</p>
  `;
});

// Amantes: se ven mutuamente (identidad + rol completo), sin compartir
// destino — cada uno sigue jugando para su propio equipo.
socket.on("role:loverInfo", ({ partner }) => {
  myLoverInfo = partner;
});

// La Mafia ganó un aliado nuevo (un Lycan que se transformó) — refresca la
// lista de cómplices en memoria y, si el modal de rol está abierto, también
// en pantalla.
socket.on("mafia:teamUpdate", ({ accomplices }) => {
  if (!myRole) return;
  myRole = { ...myRole, accomplices };
  const roleModal = document.getElementById("roleModal");
  if (!roleModal.classList.contains("hidden")) {
    roleModalContent.innerHTML = buildRoleCardHtml(myRole);
  }
});

// Sobreviviste a un intento de asesinato (Lycan) y pasás a jugar para la
// Mafia desde ahora — distinto de una muerte: no hay panel de "eliminado".
socket.on("role:transformed", (role) => {
  myRole = role;
  vibrate(VIBRATE.transform);
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.survivedTitle")}</h2>
      <p class="hint">${t("mafia.player.survivedText")}</p>
    </div>
  `;
});

socket.on("player:rejoinWaiting", ({ message }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.oneMoment")}</h2>
      <p class="hint">${tMessage(message)}</p>
    </div>
  `;
});

socket.on("player:kicked", ({ reason }) => {
  vibrate(VIBRATE.death);
  wasKicked = true;
  connectHandle.markKicked();
  roleFab.classList.add("hidden");
  rulesFab.classList.add("hidden");
  document.querySelector("main.join-screen").innerHTML = `
    <h1>${t("mafia.player.kickedTitle")}</h1>
    <p class="hint">${tMessage(reason)}</p>
  `;
});

socket.on("player:removed", ({ removedIds, transformations }) => {
  // Un Lycan transformado por una venganza en cadena tras un kick no murió
  // — su panel ya lo maneja el evento role:transformed, aparte.
  if (transformations?.some((t) => t.id === socket.id)) return;
  if (!removedIds.includes(socket.id) || wasKicked) return;
  vibrate(VIBRATE.death);
  amIDead = true;
  // Víctima de la venganza del Cazador tras el kick de otro jugador — no es
  // el propio expulsado (ese caso ya lo maneja player:kicked).
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.eliminatedTitle")}</h2>
      <p class="hint">${t("mafia.player.eliminatedText")}</p>
    </div>
  `;
});

socket.on("game:over", ({ winner }) => {
  document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
});

// La pantalla reinició la partida en la misma sala: volvemos a la vista de
// "ya estoy adentro, esperando" sin necesidad de reconectar ni re-unirse.
socket.on("game:restarted", () => {
  myRole = null;
  myLoverInfo = null;
  amIDead = false;
  chatHandle.reset("general");
  roleFab.classList.add("hidden");
  const saved = Platform.session.load(GAME_ID);
  const name = saved.name || "";
  const icon = saved.icon || "";
  document.getElementById("waitingRoom").innerHTML = `
    <p>${t("mafia.player.youAreIn", { name: `<strong id="myName">${icon} ${name}</strong>` })}</p>
    <p class="hint">${t("mafia.player.waitingNext")}</p>
  `;
});

function renderTargetButtons(container, targets, onPick, selectedId = null) {
  container.innerHTML = targets
    .map(
      (t) =>
        `<button class="target-btn${t.id === selectedId ? " selected" : ""}" data-id="${t.id}"><span class="target-icon">${t.icon}</span>${t.name}</button>`
    )
    .join("");
  container.querySelectorAll(".target-btn").forEach((btn) => {
    btn.addEventListener("click", () => onPick(btn.dataset.id));
  });
}

// Panel de "quién sugiere qué" dentro de la reunión de la Mafia. Se guarda
// la última lista conocida (no solo el DOM) para que sobreviva a un
// re-render del panel combinado (ver renderMafiaNightPanel) sin quedar
// vacía hasta la próxima sugerencia.
let lastMafiaSuggestions = [];
function suggestionsListItemsHtml(suggestions) {
  return suggestions.length
    ? suggestions
        .map(
          (s) =>
            `<li><span class="death-icon">${s.voterIcon}</span>${s.voterName} → ${
              s.targetId
                ? `<span class="death-icon">${s.targetIcon}</span>${s.targetName}`
                : `<em>${t("mafia.player.undecided")}</em>`
            }</li>`
        )
        .join("")
    : `<li class="hint">${t("mafia.player.noSuggestions")}</li>`;
}
function mafiaSuggestionsPanelHtml() {
  return `<ul id="mafiaSuggestionsList" class="death-list suggestions-list">${suggestionsListItemsHtml(lastMafiaSuggestions)}</ul>`;
}
socket.on("night:mafiaSuggestions", ({ suggestions }) => {
  lastMafiaSuggestions = suggestions;
  const list = document.getElementById("mafiaSuggestionsList");
  if (!list) return; // ya no está en pantalla (ej. el líder ya confirmó)
  list.innerHTML = suggestionsListItemsHtml(suggestions);
});

// Reveals de la Bruja: visibles para TODA la Mafia (no solo ella), en un
// panel propio que también sobrevive a los re-renders del panel combinado.
let brujaReveals = [];
function brujaRevealPanelHtml() {
  const items = brujaReveals.length
    ? brujaReveals
        .map(
          (r) =>
            `<li><span class="death-icon">${r.targetIcon}</span>${t("mafia.player.brujaRevealItem", { name: r.targetName, role: roleText(r.roleId, "name") })}</li>`
        )
        .join("")
    : `<li class="hint">${t("mafia.player.noBrujaReveal")}</li>`;
  return `<ul id="brujaRevealPanel" class="death-list suggestions-list">${items}</ul>`;
}
socket.on("night:brujaReveal", (reveal) => {
  brujaReveals.push(reveal);
  if (mafiaTurnState) renderMafiaNightPanel();
});

function gameOverPanelHtml(winner) {
  const title = t(`mafia.player.over.${["mafia", "ciudad", "bufon"].includes(winner) ? winner : "draw"}`);
  return `
    <div class="night-panel">
      <h2>${title}</h2>
      <p class="hint">${t("mafia.player.overText")}</p>
    </div>
  `;
}

// La noche empieza "limpia" para el estado combinado de la Mafia — se
// reconstruye desde cero con los eventos que lleguen después.
let mafiaTurnState = null; // { isLeader, leaderName, targets, done }
let mafiaPowerState = null; // { role, targets, done, alreadySubmitted }
let mySuggestedId = null;
socket.on("night:begin", () => {
  mafiaTurnState = null;
  mafiaPowerState = null;
  brujaReveals = [];
  lastMafiaSuggestions = [];
  mySuggestedId = null;
});

socket.on("night:waiting", () => {
  vibrate(VIBRATE.night);
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.nightTitle")}</h2>
      <p class="hint">${t("mafia.player.nothingTonight")}</p>
    </div>
  `;
});

// La Mafia (incluida la Bruja/Carnicero, que además tienen su propio poder
// personal — ver night:mafiaPower) recibe este evento con el voto colectivo
// de a quién matar. Como algunos roles reciben AMBOS eventos la misma
// noche, todo pasa por renderMafiaNightPanel() en vez de pisar el innerHTML
// directamente, para que un panel no le gane al otro.
const MAFIA_POWER_CONFIG = {
  bruja: { icon: "🧙", titleKey: "mafia.player.power.bruja" },
  carnicero: { icon: "🔪", titleKey: "mafia.player.power.carnicero" },
};

function renderMafiaNightPanel() {
  let html = "";
  if (mafiaTurnState) html += buildMafiaTurnSectionHtml(mafiaTurnState);
  if (mafiaPowerState) html += buildMafiaPowerSectionHtml(mafiaPowerState);
  document.getElementById("waitingRoom").innerHTML = `<div class="night-panel">${html}</div>`;

  if (mafiaTurnState && !mafiaTurnState.done) attachMafiaTurnHandlers(mafiaTurnState);
  if (mafiaPowerState && !mafiaPowerState.done) attachMafiaPowerHandlers(mafiaPowerState);
}

function buildMafiaTurnSectionHtml(state) {
  if (state.done) {
    return `
      <div class="night-panel-section">
        <h2>🐺 ${t("mafia.player.done")}</h2>
        <p class="hint">${t("mafia.player.victimChosen")}</p>
      </div>
    `;
  }
  if (!state.isLeader) {
    return `
      <div class="night-panel-section">
        <h2>${t("mafia.player.mafiaMeeting")}</h2>
        <p class="hint">${t("mafia.player.leaderDecides", { name: state.leaderName })}</p>
        <div id="targetButtons" class="target-list"></div>
        ${mafiaSuggestionsPanelHtml()}
        ${brujaRevealPanelHtml()}
      </div>
    `;
  }
  return `
    <div class="night-panel-section">
      <h2>${t("mafia.player.pickVictim")}</h2>
      <p class="hint">${t("mafia.player.youDecide")}</p>
      ${mafiaSuggestionsPanelHtml()}
      ${brujaRevealPanelHtml()}
      <div id="targetButtons" class="target-list"></div>
      <p id="nightError" class="error"></p>
    </div>
  `;
}

function attachMafiaTurnHandlers(state) {
  const container = document.getElementById("targetButtons");
  if (!state.isLeader) {
    const pick = (targetId) => {
      mySuggestedId = mySuggestedId === targetId ? null : targetId;
      socket.emit("night:mafiaSuggest", { targetId: mySuggestedId });
      renderTargetButtons(container, state.targets, pick, mySuggestedId);
    };
    renderTargetButtons(container, state.targets, pick, mySuggestedId);
    return;
  }
  renderTargetButtons(container, state.targets, (targetId) => {
    socket.emit("night:action", { role: "mafia", targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = tError(res);
        return;
      }
      mafiaTurnState = { ...mafiaTurnState, done: true };
      renderMafiaNightPanel();
    });
  });
}

function buildMafiaPowerSectionHtml(state) {
  const config = MAFIA_POWER_CONFIG[state.role];
  if (state.done) {
    return `
      <div class="night-panel-section">
        <h2>${config.icon} ${t("mafia.player.done")}</h2>
        <p class="hint">${t("mafia.player.powerUsed")}</p>
      </div>
    `;
  }
  return `
    <div class="night-panel-section">
      <h2>${config.icon} ${t(config.titleKey)}</h2>
      <div id="mafiaPowerButtons" class="target-list"></div>
      <p id="mafiaPowerError" class="error"></p>
    </div>
  `;
}

function attachMafiaPowerHandlers(state) {
  const container = document.getElementById("mafiaPowerButtons");
  renderTargetButtons(container, state.targets, (targetId) => {
    socket.emit("night:action", { role: state.role, targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("mafiaPowerError").textContent = tError(res);
        return;
      }
      mafiaPowerState = { ...mafiaPowerState, done: true };
      renderMafiaNightPanel();
    });
  });
}

socket.on("night:mafiaTurn", ({ isLeader, leaderName, targets }) => {
  vibrate(VIBRATE.night);
  mafiaTurnState = { isLeader, leaderName, targets, done: false };
  renderMafiaNightPanel();
});

// Poder personal de la Bruja/Carnicero — se manda ADEMÁS de night:mafiaTurn.
socket.on("night:mafiaPower", ({ role, targets, alreadySubmitted }) => {
  mafiaPowerState = { role, targets, done: Boolean(alreadySubmitted), alreadySubmitted: Boolean(alreadySubmitted) };
  renderMafiaNightPanel();
});

// El Carnicero te silenció anoche: no podés votar en la acusación de hoy.
socket.on("day:silenced", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.silencedTitle")}</h2>
      <p class="hint">${t("mafia.player.silencedText")}</p>
    </div>
  `;
});

socket.on("night:yourTurn", ({ role, targets }) => {
  vibrate(VIBRATE.night);
  const waitingRoom = document.getElementById("waitingRoom");
  const config = {
    detective: { icon: "🔮", titleKey: "mafia.player.investigate" },
    medico: { icon: "💊", titleKey: "mafia.player.protect" },
  }[role];

  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>${config.icon} ${t(config.titleKey)}</h2>
      <div id="targetButtons" class="target-list"></div>
      <p id="nightError" class="error"></p>
    </div>
  `;
  renderTargetButtons(document.getElementById("targetButtons"), targets, (targetId) => {
    socket.emit("night:action", { role, targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = tError(res);
        return;
      }
      if (role === "medico") {
        waitingRoom.innerHTML = `
          <div class="night-panel">
            <h2>💊 ${t("mafia.player.done")}</h2>
            <p class="hint">${t("mafia.player.protectedDone")}</p>
          </div>
        `;
      }
      // El Vidente espera el evento night:investigateResult para ver el resultado.
    });
  });
});

socket.on("night:investigateResult", ({ targetName, isMafia }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.resultTitle")}</h2>
      <p class="hint">${t(isMafia ? "mafia.player.isMafia" : "mafia.player.notMafia", { name: targetName })}</p>
      <p class="hint">${t("mafia.player.waitingRest")}</p>
    </div>
  `;
});

socket.on("night:resolved", ({ deaths, transformations, winner }) => {
  // Un Lycan transformado no murió — su panel ya lo maneja role:transformed,
  // que llega antes que este evento; no lo pisamos con el mensaje genérico.
  if (transformations?.some((t) => t.id === socket.id)) return;
  if (winner) {
    document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
    return;
  }
  const iDied = deaths.some((d) => d.id === socket.id);
  if (iDied) {
    vibrate(VIBRATE.death);
    amIDead = true;
  }
  document.getElementById("waitingRoom").innerHTML = iDied
    ? `
      <div class="night-panel">
        <h2>${t("mafia.player.killedTitle")}</h2>
        <p class="hint">${t("mafia.player.killedText")}</p>
      </div>
    `
    : `
      <div class="night-panel">
        <h2>${t("mafia.player.dawnTitle")}</h2>
        <p class="hint">${t("mafia.player.dawnText")}</p>
      </div>
    `;
});

// --- Ciclo Día ---

socket.on("day:discussionPhone", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.dayTitle")}</h2>
      <p class="hint">${t("mafia.player.dayText")}</p>
    </div>
  `;
});

socket.on("day:yourVote", ({ targets }) => {
  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.whoAccuse")}</h2>
      <div id="targetButtons" class="target-list"></div>
      <button id="abstainBtn" class="abstain-btn">${t("mafia.player.abstain")}</button>
      <p id="nightError" class="error"></p>
    </div>
  `;

  const submitVote = (targetId) => {
    socket.emit("day:vote", { targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = tError(res);
        return;
      }
      waitingRoom.innerHTML = `
        <div class="night-panel">
          <h2>🗳️ ${t("mafia.player.done")}</h2>
          <p class="hint">${t("mafia.player.votedDone")}</p>
        </div>
      `;
    });
  };

  renderTargetButtons(document.getElementById("targetButtons"), targets, submitVote);
  document.getElementById("abstainBtn").addEventListener("click", () => submitVote(null));
});

socket.on("day:yourDefense", () => {
  vibrate(VIBRATE.accused);
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.accusedTitle")}</h2>
      <p class="hint">${t("mafia.player.accusedText")}</p>
    </div>
  `;
});

socket.on("day:watchDefense", ({ accusedName }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.defenseTitle")}</h2>
      <p class="hint">${t("mafia.player.listenDefense", { name: accusedName })}</p>
    </div>
  `;
});

socket.on("day:yourVerdict", () => {
  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.yourVerdict")}</h2>
      <div class="verdict-buttons">
        <button id="guiltyBtn" class="verdict-btn guilty-btn">${t("mafia.player.guilty")}</button>
        <button id="innocentBtn" class="verdict-btn innocent-btn">${t("mafia.player.innocent")}</button>
      </div>
      <p id="nightError" class="error"></p>
    </div>
  `;

  const submitVerdict = (verdict) => {
    socket.emit("day:verdict", { verdict }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = tError(res);
        return;
      }
      waitingRoom.innerHTML = `
        <div class="night-panel">
          <h2>⚖️ ${t("mafia.player.done")}</h2>
          <p class="hint">${t("mafia.player.votedDone")}</p>
        </div>
      `;
    });
  };

  document.getElementById("guiltyBtn").addEventListener("click", () => submitVerdict("guilty"));
  document.getElementById("innocentBtn").addEventListener("click", () => submitVerdict("innocent"));
});

socket.on("day:waitVerdict", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.decidingTitle")}</h2>
      <p class="hint">${t("mafia.player.decidingText")}</p>
    </div>
  `;
});

socket.on("day:noAccusation", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>${t("mafia.player.noAccusationTitle")}</h2>
      <p class="hint">${t("mafia.player.noAccusationText")}</p>
    </div>
  `;
});

socket.on("day:resolved", ({ executed, deaths, transformations, winner }) => {
  // Un Lycan transformado no murió — su panel ya lo maneja role:transformed,
  // que llega antes que este evento; no lo pisamos con el mensaje genérico.
  if (transformations?.some((t) => t.id === socket.id)) return;
  if (winner) {
    document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
    return;
  }
  const iWasExecuted = executed && deaths.some((d) => d.id === socket.id);
  if (iWasExecuted) {
    vibrate(VIBRATE.death);
    amIDead = true;
  }
  document.getElementById("waitingRoom").innerHTML = iWasExecuted
    ? `
      <div class="night-panel">
        <h2>${t("mafia.player.executedTitle")}</h2>
        <p class="hint">${t("mafia.player.executedText")}</p>
      </div>
    `
    : `
      <div class="night-panel">
        <h2>${t("mafia.player.verdictTitle")}</h2>
        <p class="hint">${t("mafia.player.verdictText")}</p>
      </div>
    `;
});

// --- Chat: "general" (todos, en cualquier momento) y "fantasmas" (solo
//     jugadores ya eliminados, entre ellos) — la pestaña de fantasmas se
//     habilita/deshabilita según si el jugador ya murió (amIDead). ---
const chatHandle = Platform.chat.init({
  socket,
  fabId: "chatFab",
  modalId: "chatModal",
  closeId: "chatModalClose",
  logId: "chatLog",
  formId: "chatForm",
  inputId: "chatInput",
  tabButtonsSelector: ".chat-tab",
  isChannelEnabled: (channel) => (channel === "fantasmas" ? amIDead : true),
  defaultChannel: "general",
});

// --- Historial público de la partida ---
Platform.history.init({ socket, fabId: "historyFab", modalId: "historyModal", closeId: "historyModalClose", listId: "historyList" });
