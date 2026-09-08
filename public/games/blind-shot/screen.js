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
  unlockSound();
  const startError = document.getElementById("startError");
  startError.textContent = "";
  socket.emit("game:start", null, (res) => {
    if (!res.ok) startError.textContent = res.error;
  });
});

// --- Sonido de disparo (Web Audio, sintetizado — mismo criterio que los
//     "stingers" de Mafia: sin archivos de audio). Vive solo acá, en la
//     pantalla compartida, igual que en Mafia. No hay narrador ni música
//     en Blind Shot, así que no hace falta un botón de mute — si más
//     adelante se agrega más audio, ese es el momento de sumarlo. ---
let audioCtx = null;
function ensureAudioCtx() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
// Los navegadores no dejan sonar nada antes del primer gesto del usuario —
// se llama en cada click de "Empezar partida", que siempre ocurre antes
// del primer disparo.
function unlockSound() {
  ensureAudioCtx();
}

// Web Audio no tiene un generador de ruido nativo: se arma un buffer de
// samples aleatorios una sola vez (dura 0.3s, se reutiliza en cada
// disparo) para el "crack" del balazo.
let noiseBuffer = null;
function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(ctx.sampleRate * 0.3);
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

// Disparo sintetizado: ráfaga de ruido filtrada en banda (el "crack") +
// un golpe grave corto que cae de frecuencia rápido (el "cuerpo" del
// disparo) — mismo tipo de síntesis con osciladores que playStinger en
// Mafia, solo que acá se suma una fuente de ruido para el componente
// percusivo/agudo que un balazo necesita y que un oscilador solo no da.
function playGunshot() {
  const ctx = ensureAudioCtx();
  const t = ctx.currentTime;

  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 1800;
  noiseFilter.Q.value = 0.7;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.5, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 0.16);

  const thump = ctx.createOscillator();
  thump.type = "sine";
  thump.frequency.setValueAtTime(140, t);
  thump.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.6, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  thump.connect(thumpGain).connect(ctx.destination);
  thump.start(t);
  thump.stop(t + 0.15);
}

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
    unlockSound();
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

// --- Animación de revelación: a pedido del usuario tras probarlo, TODAS
//     las posiciones se muestran de una — ya no se revela un tirador por
//     paso. Lo que sigue avanzando en secuencia (misma cadencia que antes,
//     vía setTimeout) es el ORDEN de los disparos: en cada paso, el ícono
//     de quien tira en ese momento hace un destello (pulso de opacidad) y
//     se dibuja su láser; si pega, el objetivo pasa a semi-transparente
//     desde ese momento (queda "marcado" como eliminado en el tablero).
//     El dibujo en sí corre en un loop de requestAnimationFrame continuo
//     (no un draw por paso) para que el destello se vea animado y no como
//     un cambio brusco de opacidad. ---
const REVEAL_STEP_MS = 1100; // cadencia entre disparo y disparo
const FLASH_MS = 500; // duración del destello de cada disparo
const ELIMINATED_ALPHA = 0.3;

let revealZone = null;
let revealArena = null;
let revealPlayers = {}; // id -> { x, y, icon, name, eliminated }
let activeShot = null; // { shooterId, fired, angle, hitId, at, to, startTs } | null
let revealRafHandle = null;
let revealLastTs = null; // para el dt de las partículas (rAF no lo da solo)

function stopRevealAnimation() {
  if (revealRafHandle) cancelAnimationFrame(revealRafHandle);
  revealRafHandle = null;
  revealLastTs = null;
}

// --- Partículas de disparo: dos ráfagas por tiro, un "fogonazo" en la
//     posición del tirador (cono angosto alrededor de su ángulo de
//     puntería) y, si pega, un "impacto" en el punto del objetivo (esparcido
//     en todas direcciones). Sistema simple, sin librería: un array plano
//     de partículas, integradas a mano cuadro a cuadro. ---
let particles = [];

function spawnMuzzleParticles(x, y, angle) {
  const origin = worldToArenaCanvas(x, y);
  for (let i = 0; i < 10; i++) {
    const spread = (Math.random() - 0.5) * 0.9; // cono angosto alrededor de la puntería
    const a = angle - spread;
    const speed = 120 + Math.random() * 160;
    particles.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(a) * speed,
      vy: -Math.sin(a) * speed, // flip: mismo criterio que el resto del canvas
      life: 0.3 + Math.random() * 0.15,
      maxLife: 0.45,
      size: 2 + Math.random() * 3,
      color: Math.random() < 0.5 ? "#ffd27a" : "#ff8a3d",
    });
  }
}

function spawnImpactParticles(x, y) {
  const origin = worldToArenaCanvas(x, y);
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 80 + Math.random() * 200;
    particles.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: 0.4 + Math.random() * 0.2,
      maxLife: 0.6,
      size: 2 + Math.random() * 3,
      color: "#ff3b3b",
    });
  }
}

function updateAndDrawParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.94; // fricción — se van frenando, no vuelan en línea recta para siempre
    p.vy *= 0.94;
    p.life -= dt;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    arenaCtx.globalAlpha = Math.max(p.life / p.maxLife, 0);
    arenaCtx.fillStyle = p.color;
    arenaCtx.beginPath();
    arenaCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    arenaCtx.fill();
  }
  arenaCtx.globalAlpha = 1;
}

// order trae un evento por cada jugador que seguía vivo al EMPEZAR la
// ronda, con su posición final (`at`) — hayan llegado a disparar o no
// (ver resolveRoundWithOrder en games/blind-shot/logic.js) — así que
// alcanza para reconstruir el tablero completo de una sola vez.
function buildRevealPlayers(order) {
  const players = {};
  order.forEach((e) => {
    players[e.shooterId] = {
      x: e.at.x,
      y: e.at.y,
      icon: rosterById[e.shooterId]?.icon || "❔",
      name: rosterById[e.shooterId]?.name || "?",
      eliminated: false,
    };
  });
  return players;
}

function drawShotLine(shot) {
  const from = worldToArenaCanvas(shot.at.x, shot.at.y);
  let to;
  if (shot.to) {
    to = worldToArenaCanvas(shot.to.x, shot.to.y);
  } else {
    // Sin objetivo: el láser llega hasta el borde del arena completo (no
    // la zona vigente, más chica) — mismo criterio "largo" que el láser
    // del celular, pero referenciado al arena fijo.
    const len = distanceToRectEdge(shot.at.x, shot.at.y, shot.angle, revealArena.halfWidth, revealArena.halfHeight);
    to = {
      x: from.x + Math.cos(shot.angle) * len * arenaScale,
      y: from.y - Math.sin(shot.angle) * len * arenaScale,
    };
  }
  arenaCtx.beginPath();
  arenaCtx.moveTo(from.x, from.y);
  arenaCtx.lineTo(to.x, to.y);
  arenaCtx.strokeStyle = shot.hitId ? "#ff3b3b" : "rgba(232, 192, 125, 0.5)";
  arenaCtx.lineWidth = shot.hitId ? 4 : 2;
  arenaCtx.stroke();

  if (shot.hitId) {
    arenaCtx.beginPath();
    arenaCtx.arc(to.x, to.y, ARENA_HIT_RING_PX, 0, Math.PI * 2);
    arenaCtx.strokeStyle = "#ff3b3b";
    arenaCtx.lineWidth = 3;
    arenaCtx.stroke();
  }
}

function drawRevealFrame(now) {
  const dt = revealLastTs ? Math.min((now - revealLastTs) / 1000, 0.1) : 0;
  revealLastTs = now;

  arenaCtx.clearRect(0, 0, arenaWidth, arenaHeight);
  drawArenaRect(revealArena.halfWidth, revealArena.halfHeight, "#1c2233", 2);
  drawArenaRect(revealZone.halfWidth, revealZone.halfHeight, "#e8c07d", 3);

  // Destello del disparo activo: dos pulsos rápidos de opacidad que
  // convergen a opaco al final — más "flash de cámara" que un simple
  // fade. Se dibuja antes de los íconos para que el láser quede detrás.
  let flashAlpha = 1;
  if (activeShot) {
    const t = Math.min((now - activeShot.startTs) / FLASH_MS, 1);
    flashAlpha = 0.3 + 0.7 * (0.5 - 0.5 * Math.cos(t * Math.PI * 4));
    if (activeShot.fired) drawShotLine(activeShot);
  }

  updateAndDrawParticles(dt);

  arenaCtx.font = `${ARENA_MARKER_PX}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  arenaCtx.textAlign = "center";
  arenaCtx.textBaseline = "middle";
  Object.entries(revealPlayers).forEach(([id, p]) => {
    const pos = worldToArenaCanvas(p.x, p.y);
    let alpha = p.eliminated ? ELIMINATED_ALPHA : 1;
    if (activeShot && activeShot.shooterId === id && !p.eliminated) alpha = flashAlpha;
    arenaCtx.globalAlpha = alpha;
    arenaCtx.fillText(p.icon, pos.x, pos.y);
  });
  arenaCtx.globalAlpha = 1;

  revealRafHandle = requestAnimationFrame(drawRevealFrame);
}

function playReveal(zoneBefore, order, onDone) {
  revealZone = zoneBefore;
  revealArena = arenaCache;
  revealPlayers = buildRevealPlayers(order);
  activeShot = null;
  particles = [];
  stopRevealAnimation();
  revealRafHandle = requestAnimationFrame(drawRevealFrame);

  let i = 0;
  function step() {
    if (i >= order.length) {
      stopRevealAnimation();
      onDone();
      return;
    }
    const event = order[i];
    activeShot = {
      shooterId: event.shooterId,
      fired: event.fired,
      angle: event.angle,
      hitId: event.hitId,
      at: event.at,
      to: event.to,
      startTs: performance.now(),
    };
    if (event.fired) {
      playGunshot();
      spawnMuzzleParticles(event.at.x, event.at.y, event.angle);
      if (event.hitId && event.to) spawnImpactParticles(event.to.x, event.to.y);
    }
    if (event.hitId && revealPlayers[event.hitId]) revealPlayers[event.hitId].eliminated = true;

    const shooterName = rosterById[event.shooterId]?.name || "?";
    const shooterIcon = rosterById[event.shooterId]?.icon || "❔";
    const stats = document.getElementById("arenaStats");
    if (stats) {
      const line = !event.fired
        ? `${shooterIcon} ${shooterName} ya estaba eliminado/a — su disparo no salió.`
        : event.hitId
        ? `${shooterIcon} ${shooterName} le dio a ${rosterById[event.hitId]?.icon || "❔"} ${rosterById[event.hitId]?.name || "?"}.`
        : `${shooterIcon} ${shooterName} disparó... y erró.`;
      stats.textContent = line;
    }

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
  stopRevealAnimation();
  renderGameOver(winner);
});

socket.on("game:restarted", () => {
  stopRevealAnimation();
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
