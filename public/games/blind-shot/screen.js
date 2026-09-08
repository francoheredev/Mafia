const GAME_ID = "blind-shot";
const socket = Platform.socket;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 16;

// Se guarda para poder reconstruir el lobby cuando se reinicia la partida
// en la misma sala, sin tener que crear una sala nueva.
let currentRoomCode = null;

Platform.screenConnect.init({
  socket,
  gameId: GAME_ID,
  onCreated: async (code) => {
    currentRoomCode = code;
    document.getElementById("roomCode").textContent = code;
    const joinUrl = await Platform.screenConnect.buildJoinUrl(GAME_ID, code);
    new QRCode(document.getElementById("qrcode"), { text: joinUrl, width: 220, height: 220 });
  },
});

socket.on("lobby:update", ({ players }) => {
  const list = document.getElementById("playerList");
  const startBtn = document.getElementById("startBtn");
  if (!list || !startBtn) return; // ya estamos en la pantalla de partida, no en el lobby
  Platform.roster.renderLobbyList(list, players, {
    onCount: (count) => {
      document.getElementById("playerCount").textContent = count;
      startBtn.disabled = count < MIN_PLAYERS || count > MAX_PLAYERS;
    },
  });
});

document.getElementById("startBtn").addEventListener("click", () => {
  const startError = document.getElementById("startError");
  startError.textContent = "";
  socket.emit("game:start", null, (res) => {
    if (!res.ok) startError.textContent = res.error;
  });
});

// --- Reglas (estáticas, ver player.js — mismo texto) ---
function buildRulesModalHtml() {
  return `
    <h2>📖 Cómo se juega</h2>
    <div class="rules-summary">
      <div class="rules-section">
        <h3>🕶️ A ciegas</h3>
        <p>Los jugadores nunca se ven entre sí. Cada ronda tienen un tiempo fijo para moverse y apuntar con su celular — recién al final se revela qué pasó.</p>
      </div>
      <div class="rules-section">
        <h3>🕹️ Movimiento y puntería</h3>
        <p>Un dedo mueve, el otro apunta (ángulo libre). Disparar es obligatorio todas las rondas.</p>
      </div>
      <div class="rules-section">
        <h3>🎲 Orden al azar</h3>
        <p>Cada ronda se sortea el orden en que se resuelven los disparos. Si te matan antes de que te toque, tu disparo no sale.</p>
      </div>
      <div class="rules-section">
        <h3>🏆 Ganar</h3>
        <p>La zona se achica entre rondas. Gana el último en pie.</p>
      </div>
    </div>
  `;
}
Platform.rules.init({
  fabId: "rulesFab",
  modalId: "rulesModal",
  closeId: "rulesModalClose",
  contentId: "rulesModalContent",
  buildHtml: buildRulesModalHtml,
});

// --- Historial público de la partida ---
Platform.history.init({ socket, fabId: "historyFab", modalId: "historyModal", closeId: "historyModalClose", listId: "historyList" });

// --- Panel del host: ver jugadores y expulsar (player:kick es genérico) ---
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

// Roster id -> {name, icon}, refrescado en cada arranque/ronda vía el
// mismo screen:getRoster genérico que usa el panel del host — round:begin
// no manda posiciones NI identidades (a propósito, es la "ceguera"), así
// que la pantalla necesita esta tabla aparte para poder dibujar nombres
// sobre la animación de revelación.
let rosterById = {};
function refreshRoster(onDone) {
  socket.emit("screen:getRoster", null, (res) => {
    if (res.ok) {
      rosterById = {};
      res.players.forEach((p) => {
        rosterById[p.id] = { name: p.name, icon: p.icon || "❔" };
      });
    }
    onDone?.();
  });
}

// Todo reemplazo de la pantalla principal pasa por acá.
let narrativeTimer = null;
function renderScreen(html) {
  clearTimeout(narrativeTimer);
  document.querySelector(".lobby-screen").innerHTML = html;
}

async function renderLobbyShell(code) {
  renderScreen(`
    <h1>🎯 Blind Shot</h1>
    <p class="subtitle">Escaneá el código con tu celular para unirte</p>
    <div class="code-panel">
      <div id="qrcode"></div>
      <div class="room-code" id="roomCode">${code}</div>
    </div>
    <section class="players-panel">
      <h2>Jugadores en la sala (<span id="playerCount">0</span>)</h2>
      <ul id="playerList" class="player-list"></ul>
      <p class="hint">Necesitás entre ${MIN_PLAYERS} y ${MAX_PLAYERS} jugadores conectados para arrancar.</p>
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
    const startError = document.getElementById("startError");
    startError.textContent = "";
    socket.emit("game:start", null, (res) => {
      if (!res.ok) startError.textContent = res.error;
    });
  });
}

function arenaShellHtml() {
  return `
    <div class="arena-wrap">
      <h1 id="arenaTitle">🎯 Blind Shot</h1>
      <p class="arena-stats" id="arenaStats"></p>
      <canvas id="arenaCanvas" width="450" height="800"></canvas>
    </div>
  `;
}

const ARENA_MARKER_PX = 40; // ícono del tirador en la animación de revelación
const ARENA_HIT_RING_PX = 26;

let arenaCanvas = null;
let arenaCtx = null;
let arenaWidth = 0;
let arenaHeight = 0;
let arenaScale = 0; // px por unidad de mundo, fijo (usa el arena completo, no la zona vigente)

function ensureArenaCanvas() {
  if (arenaCanvas && document.body.contains(arenaCanvas)) return;
  renderScreen(arenaShellHtml());
  arenaCanvas = document.getElementById("arenaCanvas");
  arenaCtx = arenaCanvas.getContext("2d");
  arenaWidth = arenaCanvas.width;
  arenaHeight = arenaCanvas.height;
}

function worldToArenaCanvas(wx, wy) {
  return {
    x: arenaWidth / 2 + wx * arenaScale,
    y: arenaHeight / 2 - wy * arenaScale,
  };
}

// Distancia (mundo) desde (x0,y0) hasta el borde del rectángulo dado,
// siguiendo `angle` — mismo método que distanceToZoneEdge en player.js
// (no hay forma de compartir esta función entre cliente y servidor/otra
// página sin bundler en este proyecto, así que se reimplementa acá).
function distanceToRectEdge(x0, y0, angle, halfWidth, halfHeight) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (halfWidth - x0) / dx);
  else if (dx < 0) t = Math.min(t, (-halfWidth - x0) / dx);
  if (dy > 0) t = Math.min(t, (halfHeight - y0) / dy);
  else if (dy < 0) t = Math.min(t, (-halfHeight - y0) / dy);
  return Number.isFinite(t) ? t : 0;
}

function drawArenaRect(halfWidth, halfHeight, strokeStyle, lineWidth) {
  const w = halfWidth * arenaScale * 2;
  const h = halfHeight * arenaScale * 2;
  arenaCtx.strokeStyle = strokeStyle;
  arenaCtx.lineWidth = lineWidth;
  arenaCtx.strokeRect(arenaWidth / 2 - w / 2, arenaHeight / 2 - h / 2, w, h);
}

function drawZoneOnly(zone, arena, aliveCount) {
  arenaCtx.clearRect(0, 0, arenaWidth, arenaHeight);

  // Referencia tenue del área total del arena (fija).
  drawArenaRect(arena.halfWidth, arena.halfHeight, "#1c2233", 2);
  // Zona vigente.
  drawArenaRect(zone.halfWidth, zone.halfHeight, "#e8c07d", 3);

  const stats = document.getElementById("arenaStats");
  if (stats) stats.textContent = `🕶️ Todos a ciegas... — ${aliveCount} en pie`;
}

socket.on("game:started", ({ playerCount }) => {
  renderScreen(`
    <h1>🎯 Blind Shot</h1>
    <p class="subtitle">${playerCount} jugadores están en la arena.</p>
    <p class="hint">Nunca se ven entre sí — cada ronda se mueven y apuntan a ciegas...</p>
  `);
});

let arenaCache = { halfWidth: 562.5, halfHeight: 1000 };
socket.on("round:begin", ({ number, zone, arena, aliveCount }) => {
  arenaCache = arena;
  ensureArenaCanvas();
  if (!arenaScale) arenaScale = arenaHeight / 2 / arena.halfHeight;
  refreshRoster(() => drawZoneOnly(zone, arena, aliveCount));
  const title = document.getElementById("arenaTitle");
  if (title) title.textContent = `🎯 Ronda ${number}`;
});

// --- Animación de revelación: recorre `order` con una cadena de
//     setTimeout (mismo patrón que playNarrative de Mafia, reimplementado
//     liviano acá porque es UI de pantalla, no lógica compartida). ---
const REVEAL_STEP_MS = 1400;

function drawRevealStep(zone, arena, event) {
  arenaCtx.clearRect(0, 0, arenaWidth, arenaHeight);

  drawArenaRect(arena.halfWidth, arena.halfHeight, "#1c2233", 2);
  drawArenaRect(zone.halfWidth, zone.halfHeight, "#e8c07d", 3);

  const shooterName = rosterById[event.shooterId]?.name || "?";
  const shooterIcon = rosterById[event.shooterId]?.icon || "❔";
  const pos = worldToArenaCanvas(event.at.x, event.at.y);

  if (event.fired && event.angle !== undefined) {
    const to = event.to ? worldToArenaCanvas(event.to.x, event.to.y) : null;
    let endX, endY;
    if (to) {
      endX = to.x;
      endY = to.y;
    } else {
      // Sin objetivo: el láser llega hasta el borde del arena completo
      // (no la zona vigente, más chica) — mismo criterio "largo" que el
      // láser del celular, pero referenciado al arena fijo, igual que
      // antes usaba `full` en vez de la zona.
      const len = distanceToRectEdge(event.at.x, event.at.y, event.angle, arena.halfWidth, arena.halfHeight);
      endX = pos.x + Math.cos(event.angle) * len * arenaScale;
      endY = pos.y - Math.sin(event.angle) * len * arenaScale;
    }
    arenaCtx.beginPath();
    arenaCtx.moveTo(pos.x, pos.y);
    arenaCtx.lineTo(endX, endY);
    arenaCtx.strokeStyle = event.hitId ? "#ff3b3b" : "rgba(232, 192, 125, 0.5)";
    arenaCtx.lineWidth = event.hitId ? 4 : 2;
    arenaCtx.stroke();

    if (event.hitId) {
      arenaCtx.beginPath();
      arenaCtx.arc(endX, endY, ARENA_HIT_RING_PX, 0, Math.PI * 2);
      arenaCtx.strokeStyle = "#ff3b3b";
      arenaCtx.lineWidth = 3;
      arenaCtx.stroke();
    }
  }

  // El tirador de este paso: su propio ícono, más grande que antes.
  arenaCtx.font = `${ARENA_MARKER_PX}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  arenaCtx.textAlign = "center";
  arenaCtx.textBaseline = "middle";
  arenaCtx.fillText(shooterIcon, pos.x, pos.y);

  const stats = document.getElementById("arenaStats");
  if (stats) {
    const line = !event.fired
      ? `${shooterIcon} ${shooterName} ya estaba eliminado/a — su disparo no salió.`
      : event.hitId
      ? `${shooterIcon} ${shooterName} le dio a ${rosterById[event.hitId]?.icon || "❔"} ${rosterById[event.hitId]?.name || "?"}.`
      : `${shooterIcon} ${shooterName} disparó... y erró.`;
    stats.textContent = line;
  }
}

function playReveal(zoneBefore, order, onDone) {
  let i = 0;
  function step() {
    if (i >= order.length) {
      onDone();
      return;
    }
    drawRevealStep(zoneBefore, arenaCache, order[i]);
    i++;
    narrativeTimer = setTimeout(step, REVEAL_STEP_MS);
  }
  step();
}

socket.on("round:resolved", ({ number, order, zoneBefore, zoneAfter, winner }) => {
  ensureArenaCanvas();
  refreshRoster(() => {
    playReveal(zoneBefore, order, () => {
      // Al final, redibuja la zona ya achicada.
      const aliveCount = Object.values(rosterById).length - order.filter((e) => e.hitId).length;
      drawZoneOnly(zoneAfter, arenaCache, Math.max(aliveCount, winner ? 1 : aliveCount));

      if (winner) {
        renderGameOver(winner);
        return;
      }
      const stats = document.getElementById("arenaStats");
      if (stats) stats.textContent += " — esperando la próxima ronda...";
      narrativeTimer = setTimeout(() => socket.emit("round:advance"), 1200);
    });
  });
});

function renderGameOver(winner) {
  socket.emit("screen:getRoster", null, (res) => {
    const roster = res.ok ? res.players : [];
    const isDraw = winner === "draw";
    const title = isDraw ? "🤝 Empate — nadie quedó en pie" : "🏆 ¡Tenemos ganador/a!";
    const winnerEntry = !isDraw ? roster.find((p) => p.id === winner) : null;
    const rosterHtml = roster
      .map((p) => {
        const alive = p.id === winner || p.alive !== false;
        return `
          <div class="role-chip ${alive ? "alive" : "dead"}">
            <span class="role-chip-icon">${p.icon || "❔"}</span>
            <span class="role-chip-name">${p.name}${alive ? "" : " 💀"}</span>
          </div>
        `;
      })
      .join("");
    renderScreen(`
      <h1>${title}</h1>
      ${winnerEntry ? `<p class="subtitle">${winnerEntry.icon} <strong>${winnerEntry.name}</strong> ganó la partida.</p>` : ""}
      <div class="final-roster">${rosterHtml}</div>
      <button id="restartBtn" class="advance-btn">🔁 Reiniciar partida (misma sala)</button>
      <p id="restartError" class="error"></p>
    `);
    document.getElementById("restartBtn").addEventListener("click", () => {
      socket.emit("game:restart", null, (res2) => {
        if (!res2.ok) {
          const el = document.getElementById("restartError");
          if (el) el.textContent = res2.error;
        }
      });
    });
  });
}

// Fin de partida disparado por un kick (no por una resolución de ronda en
// curso): no es un "momento" de la animación normal, va directo al
// resultado final.
socket.on("game:over", ({ winner }) => {
  renderGameOver(winner);
});

socket.on("game:restarted", () => {
  arenaCanvas = null;
  arenaCtx = null;
  arenaScale = 0;
  renderLobbyShell(currentRoomCode);
});

// No hace falta un handler propio de player:removed acá — el roster
// visual (rosterById) se refresca solo en el próximo
// round:begin/round:resolved/game:over vía refreshRoster(), y el panel
// del host (openHostModal) ya pide su propia foto actualizada cada vez
// que se abre.
