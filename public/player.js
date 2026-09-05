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

    // Guardamos la sesión para el futuro "rejoin" si se corta la conexión.
    // El token es lo que nos identifica de verdad (los nombres pueden
    // repetirse) — nunca se manda por su cuenta, solo para reconectar.
    sessionStorage.setItem("lamafia:code", res.code);
    sessionStorage.setItem("lamafia:name", res.name);
    sessionStorage.setItem("lamafia:icon", res.icon);
    sessionStorage.setItem("lamafia:token", res.token);
  });
});

function clearSession() {
  ["code", "name", "icon", "token"].forEach((k) => sessionStorage.removeItem(`lamafia:${k}`));
}

// Si el navegador reconecta el socket (ej. wifi que titiló), intenta
// reincorporarse a la misma sala en vez de arrancar de cero. Se corta si ya
// nos expulsaron (wasKicked) para no reintentar entrar solos.
let wasKicked = false;
socket.on("connect", () => {
  if (wasKicked) return;
  const savedCode = sessionStorage.getItem("lamafia:code");
  const savedToken = sessionStorage.getItem("lamafia:token");
  if (!savedCode || !savedToken || !form.classList.contains("hidden")) return;

  socket.emit("player:rejoin", { code: savedCode, token: savedToken }, (res) => {
    if (!res.ok) {
      clearSession();
      form.classList.remove("hidden");
      document.getElementById("waitingRoom").classList.add("hidden");
      errorMsg.textContent = res.error;
      return;
    }
    form.classList.add("hidden");
    document.getElementById("myName").textContent = `${res.icon} ${res.name}`;
    document.getElementById("waitingRoom").classList.remove("hidden");
  });
});

function teamLabel(team) {
  if (team === "mafia") return "🐺 Los Lobos";
  if (team === "ciudad") return "🏘️ La Aldea";
  return "🎭 Errante";
}

function buildRoleCardHtml(role) {
  const accomplicesHtml =
    role.accomplices && role.accomplices.length
      ? `<p class="accomplices">Tus cómplices: <strong>${role.accomplices.join(", ")}</strong></p>`
      : "";
  return `
    <div class="role-card team-${role.team}">
      <p class="role-team">${teamLabel(role.team)}</p>
      <div class="role-icon">${role.icon}</div>
      <h2>${role.narrativeName}</h2>
      <p class="role-desc">${role.description}</p>
      ${accomplicesHtml}
    </div>
  `;
}

// Se guarda en memoria para que el botón "ver mi rol" pueda mostrarlo de
// nuevo en cualquier momento, aunque la pantalla de #waitingRoom ya haya
// cambiado varias veces.
let myRole = null;

const roleFab = document.getElementById("roleFab");
const roleModal = document.getElementById("roleModal");
const roleModalContent = document.getElementById("roleModalContent");

roleFab.addEventListener("click", () => {
  if (!myRole) return;
  roleModalContent.innerHTML = buildRoleCardHtml(myRole);
  roleModal.classList.remove("hidden");
});
document.getElementById("roleModalClose").addEventListener("click", () => {
  roleModal.classList.add("hidden");
});
roleModal.addEventListener("click", (e) => {
  if (e.target === roleModal) roleModal.classList.add("hidden");
});

// --- Tutorial de reglas y roles: disponible desde el lobby (no es secreto,
//     a diferencia del rol propio), y se abre solo una vez automáticamente
//     al arrancar la partida. ---
const rulesFab = document.getElementById("rulesFab");
const rulesModal = document.getElementById("rulesModal");
const rulesModalContent = document.getElementById("rulesModalContent");

function buildRulesModalHtml() {
  const data = window.LAMAFIA_RULES || { allRoles: [], generalRules: [] };
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
function openRulesModal() {
  rulesModalContent.innerHTML = buildRulesModalHtml();
  rulesModal.classList.remove("hidden");
}
rulesFab.addEventListener("click", openRulesModal);
document.getElementById("rulesModalClose").addEventListener("click", () => {
  rulesModal.classList.add("hidden");
});
rulesModal.addEventListener("click", (e) => {
  if (e.target === rulesModal) rulesModal.classList.add("hidden");
});

let autoRulesTimer = null;
socket.on("role:assigned", (role) => {
  myRole = role;
  roleFab.classList.remove("hidden");

  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.classList.remove("hidden");
  waitingRoom.innerHTML = `
    ${buildRoleCardHtml(role)}
    <p class="hint">Memorizá tu rol antes de que caiga la noche...</p>
  `;

  // Deja ver la tarjeta de rol primero; el tutorial se abre encima poco
  // después, así no compite con esa lectura.
  clearTimeout(autoRulesTimer);
  autoRulesTimer = setTimeout(openRulesModal, 1200);
});

socket.on("player:rejoinWaiting", ({ message }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>⏳ Un momento</h2>
      <p class="hint">${message}</p>
    </div>
  `;
});

socket.on("player:kicked", ({ reason }) => {
  wasKicked = true;
  clearSession();
  roleFab.classList.add("hidden");
  rulesFab.classList.add("hidden");
  document.querySelector("main.join-screen").innerHTML = `
    <h1>🚫 Fuera de la partida</h1>
    <p class="hint">${reason}</p>
  `;
});

socket.on("player:removed", ({ removedIds }) => {
  if (!removedIds.includes(socket.id) || wasKicked) return;
  // Víctima de la venganza del Cazador tras el kick de otro jugador — no es
  // el propio expulsado (ese caso ya lo maneja player:kicked).
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>💀 Fuiste eliminado</h2>
      <p class="hint">Mirá la pantalla para ver qué pasó.</p>
    </div>
  `;
});

socket.on("game:over", ({ winner }) => {
  document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
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

// Panel de "quién sugiere qué" dentro de la reunión de la Mafia — vive en
// su propio contenedor fijo (#mafiaSuggestionsList) para no tener que
// redibujar toda la pantalla (y de paso el cronómetro) cada vez que llega
// una sugerencia nueva.
function mafiaSuggestionsPanelHtml() {
  return `<ul id="mafiaSuggestionsList" class="death-list suggestions-list"></ul>`;
}
socket.on("night:mafiaSuggestions", ({ suggestions }) => {
  const list = document.getElementById("mafiaSuggestionsList");
  if (!list) return; // ya no está en pantalla (ej. el líder ya confirmó)
  list.innerHTML = suggestions.length
    ? suggestions
        .map(
          (s) =>
            `<li><span class="death-icon">${s.voterIcon}</span>${s.voterName} → ${
              s.targetId
                ? `<span class="death-icon">${s.targetIcon}</span>${s.targetName}`
                : "<em>sin decidir</em>"
            }</li>`
        )
        .join("")
    : `<li class="hint">Nadie sugirió un objetivo todavía.</li>`;
});

function gameOverPanelHtml(winner) {
  const title =
    winner === "mafia"
      ? "🐺 Gana la Mafia"
      : winner === "ciudad"
      ? "🏘️ Gana la Ciudad"
      : "🤝 Empate";
  return `
    <div class="night-panel">
      <h2>${title}</h2>
      <p class="hint">🎉 Partida terminada — mirá la pantalla para ver los roles de todos.</p>
    </div>
  `;
}

socket.on("night:waiting", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>🌙 Cae la noche</h2>
      <p class="hint">No tenés nada para hacer esta noche. Esperá tranquilo/a...</p>
    </div>
  `;
});

socket.on("night:mafiaTurn", ({ isLeader, leaderName, targets }) => {
  const waitingRoom = document.getElementById("waitingRoom");

  if (!isLeader) {
    waitingRoom.innerHTML = `
      <div class="night-panel">
        <h2>🐺 Reunión de la Mafia</h2>
        <p class="hint">Esta noche decide <strong>${leaderName}</strong>. Marcá a quién matarías vos — el resto de la Mafia lo ve, pero no es definitivo.</p>
        <div id="targetButtons" class="target-list"></div>
        ${mafiaSuggestionsPanelHtml()}
      </div>
    `;

    const container = document.getElementById("targetButtons");
    let mySuggestedId = null;
    const pick = (targetId) => {
      mySuggestedId = mySuggestedId === targetId ? null : targetId;
      socket.emit("night:mafiaSuggest", { targetId: mySuggestedId });
      renderTargetButtons(container, targets, pick, mySuggestedId);
    };
    renderTargetButtons(container, targets, pick, mySuggestedId);
    return;
  }

  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>🐺 Elegí a la víctima</h2>
      <p class="hint">Esta noche sos vos quien decide.</p>
      ${mafiaSuggestionsPanelHtml()}
      <div id="targetButtons" class="target-list"></div>
      <p id="nightError" class="error"></p>
    </div>
  `;
  renderTargetButtons(document.getElementById("targetButtons"), targets, (targetId) => {
    socket.emit("night:action", { role: "mafia", targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = res.error;
        return;
      }
      waitingRoom.innerHTML = `
        <div class="night-panel">
          <h2>🐺 Listo</h2>
          <p class="hint">Elegiste a tu víctima. Esperando al resto...</p>
        </div>
      `;
    });
  });
});

socket.on("night:yourTurn", ({ role, targets }) => {
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
    </div>
  `;
  renderTargetButtons(document.getElementById("targetButtons"), targets, (targetId) => {
    socket.emit("night:action", { role, targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = res.error;
        return;
      }
      if (role === "medico") {
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

socket.on("night:resolved", ({ deaths, winner }) => {
  if (winner) {
    document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
    return;
  }
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

// --- Ciclo Día ---

socket.on("day:discussionPhone", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>💬 Es de día</h2>
      <p class="hint">Discutan en persona quién puede ser sospechoso. Mirá la pantalla.</p>
    </div>
  `;
});

socket.on("day:yourVote", ({ targets }) => {
  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>🗳️ ¿A quién acusás?</h2>
      <div id="targetButtons" class="target-list"></div>
      <button id="abstainBtn" class="abstain-btn">Abstenerme</button>
      <p id="nightError" class="error"></p>
    </div>
  `;

  const submitVote = (targetId) => {
    socket.emit("day:vote", { targetId }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = res.error;
        return;
      }
      waitingRoom.innerHTML = `
        <div class="night-panel">
          <h2>🗳️ Listo</h2>
          <p class="hint">Ya votaste. Esperando al resto...</p>
        </div>
      `;
    });
  };

  renderTargetButtons(document.getElementById("targetButtons"), targets, submitVote);
  document.getElementById("abstainBtn").addEventListener("click", () => submitVote(null));
});

socket.on("day:yourDefense", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>⚖️ ¡Te acusaron!</h2>
      <p class="hint">Es tu turno de defenderte en voz alta.</p>
    </div>
  `;
});

socket.on("day:watchDefense", ({ accusedName }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>⚖️ Defensa</h2>
      <p class="hint">Escuchá la defensa de <strong>${accusedName}</strong>.</p>
    </div>
  `;
});

socket.on("day:yourVerdict", () => {
  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.innerHTML = `
    <div class="night-panel">
      <h2>⚖️ Tu veredicto</h2>
      <div class="verdict-buttons">
        <button id="guiltyBtn" class="verdict-btn guilty-btn">Culpable</button>
        <button id="innocentBtn" class="verdict-btn innocent-btn">Inocente</button>
      </div>
      <p id="nightError" class="error"></p>
    </div>
  `;

  const submitVerdict = (verdict) => {
    socket.emit("day:verdict", { verdict }, (res) => {
      if (!res.ok) {
        document.getElementById("nightError").textContent = res.error;
        return;
      }
      waitingRoom.innerHTML = `
        <div class="night-panel">
          <h2>⚖️ Listo</h2>
          <p class="hint">Ya votaste. Esperando al resto...</p>
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
      <h2>⚖️ Están decidiendo</h2>
      <p class="hint">El resto está votando tu veredicto...</p>
    </div>
  `;
});

socket.on("day:noAccusation", () => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="night-panel">
      <h2>🤝 Nadie fue acusado</h2>
      <p class="hint">Mirá la pantalla. Cae la próxima noche...</p>
    </div>
  `;
});

socket.on("day:resolved", ({ executed, deaths, winner }) => {
  if (winner) {
    document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
    return;
  }
  const iWasExecuted = executed && deaths.some((d) => d.id === socket.id);
  document.getElementById("waitingRoom").innerHTML = iWasExecuted
    ? `
      <div class="night-panel">
        <h2>💀 Te ejecutaron</h2>
        <p class="hint">Mirá la pantalla para el resumen del juicio.</p>
      </div>
    `
    : `
      <div class="night-panel">
        <h2>⚰️ Veredicto</h2>
        <p class="hint">Mirá la pantalla para el resultado del juicio.</p>
      </div>
    `;
});
