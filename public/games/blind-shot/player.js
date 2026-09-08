const GAME_ID = "blind-shot";
const socket = Platform.socket;

// Feedback táctil en los momentos clave — mismo criterio que Mafia
// (navigator.vibrate solo existe en Android/Chrome; en iPhone el `if` de
// acá adentro hace que simplemente no vibre, sin romper nada).
function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}
const VIBRATE = {
  roundStart: [60, 30, 60],
  hit: [200, 100, 200, 100, 400],
  submitted: [40],
};

let wasKicked = false;
let amIDead = false;
const connectHandle = Platform.playerConnect.init({
  socket,
  gameId: GAME_ID,
  formId: "joinForm",
  codeInputId: "codeInput",
  nameInputId: "nameInput",
  errorId: "errorMsg",
  waitingId: "waitingRoom",
  myNameId: "myName",
});

// --- Reglas (estáticas — a diferencia de Mafia, Blind Shot no tiene un
//     catálogo de roles que servir por separado, así que el contenido se
//     arma acá mismo en vez de pedir un staticRoute dedicado). ---
function buildRulesModalHtml() {
  return `
    <h2>📖 Cómo se juega</h2>
    <div class="rules-summary">
      <div class="rules-section">
        <h3>🕶️ A ciegas</h3>
        <p>Nunca ves a los demás jugadores. Cada ronda tenés un tiempo fijo para moverte y apuntar — recién al final se revela qué pasó.</p>
      </div>
      <div class="rules-section">
        <h3>🕹️ Moverte</h3>
        <p>Tocá y arrastrá con un dedo para mover el joystick flotante. Te movés dentro del círculo — si la zona se achica y quedás afuera, te empujan hacia adentro.</p>
      </div>
      <div class="rules-section">
        <h3>🎯 Apuntar</h3>
        <p>Mientras mantenés el joystick, tocá con OTRO dedo en cualquier punto para apuntar hacia ahí. Podés soltar ese segundo dedo — tu puntería queda guardada hasta que termine la ronda.</p>
      </div>
      <div class="rules-section">
        <h3>🔫 Disparar es obligatorio</h3>
        <p>Todas las rondas disparás. Si nunca apuntaste con el segundo dedo, se usa la dirección hacia la que te moviste (o tu última puntería conocida).</p>
      </div>
      <div class="rules-section">
        <h3>🏆 Ganar</h3>
        <p>La zona se achica entre rondas. Gana quien quede en pie al final.</p>
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

// --- Chat: un solo canal general (ver plugin.js) ---
Platform.chat.init({
  socket,
  fabId: "chatFab",
  modalId: "chatModal",
  closeId: "chatModalClose",
  logId: "chatLog",
  formId: "chatForm",
  inputId: "chatInput",
  tabButtonsSelector: ".chat-tab",
  defaultChannel: "general",
});

// --- Historial público de la partida ---
Platform.history.init({ socket, fabId: "historyFab", modalId: "historyModal", closeId: "historyModalClose", listId: "historyList" });

socket.on("player:kicked", ({ reason }) => {
  vibrate(VIBRATE.hit);
  wasKicked = true;
  connectHandle.markKicked();
  document.getElementById("rulesFab")?.classList.add("hidden");
  document.querySelector("main.join-screen").innerHTML = `
    <h1>🚫 Fuera de la partida</h1>
    <p class="hint">${reason}</p>
  `;
  stopControlLoop();
});

// La pantalla reinició la partida en la misma sala: volvemos a la vista de
// "ya estoy adentro, esperando" sin necesidad de reconectar.
socket.on("game:restarted", () => {
  amIDead = false;
  stopControlLoop();
  const saved = Platform.session.load(GAME_ID);
  const name = saved.name || "";
  const icon = saved.icon || "";
  document.getElementById("waitingRoom").innerHTML = `
    <p>✅ Estás adentro, <strong id="myName">${icon} ${name}</strong>.</p>
    <p class="hint">Esperando a que arranque la próxima partida...</p>
  `;
});

function gameOverPanelHtml(winner) {
  const isDraw = winner === "draw";
  const title = isDraw ? "🤝 Empate" : "🏆 Partida terminada";
  const hint = isDraw
    ? "Nadie quedó en pie."
    : winner === socket.id
    ? "¡Ganaste!"
    : "Mirá la pantalla para ver quién ganó.";
  return `
    <div class="round-panel">
      <h2>${title}</h2>
      <p class="hint">${hint}</p>
    </div>
  `;
}

socket.on("game:over", ({ winner }) => {
  stopControlLoop();
  document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
});

// --- El marcador explícito de "estás eliminado" — a diferencia de Mafia,
//     una pestaña nueva no tiene memoria local de haber muerto, así que
//     hace falta que el servidor lo diga en cada reconnect (ver
//     blindShotOnReconnect en games/blind-shot/logic.js). ---
socket.on("round:spectator", () => {
  amIDead = true;
  stopControlLoop();
  document.getElementById("waitingRoom").innerHTML = `
    <div class="round-panel">
      <h2>💀 Estás eliminado</h2>
      <p class="hint">Mirá la pantalla — seguís de espectador el resto de la partida.</p>
    </div>
  `;
});

// Genérico de "no hay nada que hacer ahora mismo, mirá la pantalla" —
// reconexión durante "reveal"/"game-over".
socket.on("round:waiting", ({ message }) => {
  document.getElementById("waitingRoom").innerHTML = `
    <div class="round-panel">
      <h2>⏳ Un momento</h2>
      <p class="hint">${message}</p>
    </div>
  `;
});

socket.on("round:resolved", ({ order, winner }) => {
  stopControlLoop();
  if (winner) {
    document.getElementById("waitingRoom").innerHTML = gameOverPanelHtml(winner);
    return;
  }
  const iDied = order.some((e) => e.hitId === socket.id);
  if (iDied) {
    vibrate(VIBRATE.hit);
    amIDead = true;
    document.getElementById("waitingRoom").innerHTML = `
      <div class="round-panel">
        <h2>💀 Te eliminaron</h2>
        <p class="hint">Mirá la pantalla para el resumen de la ronda.</p>
      </div>
    `;
  } else {
    document.getElementById("waitingRoom").innerHTML = `
      <div class="round-panel">
        <h2>👀 Ronda resuelta</h2>
        <p class="hint">Seguís en pie. Mirá la pantalla para el resumen...</p>
      </div>
    `;
  }
});

// ============================================================================
// Control de movimiento + puntería (joystick flotante con un dedo, ángulo
// libre con otro — ver plan "Cliente: joystick + puntería"). Pointer Events
// (no Touch Events crudos) para tener un pointerId estable por dedo y
// unificar mouse (se puede probar desde escritorio). El <canvas> tiene
// touch-action:none (ver blind-shot.css) para que el navegador no
// interprete los toques como scroll/zoom.
// ============================================================================

const JOYSTICK_MAX_PX = 60; // tope de desplazamiento visual del joystick
const MOVE_SPEED = 220; // unidades de mundo por segundo, a fondo de joystick
const PLAYER_MARKER_PX = 34; // tamaño de fuente del ícono propio en el mini-mapa
const LASER_COLOR = "#ff3b3b"; // rojo puro, a pedido — antes era un coral #e07a5f

// La zona es un rectángulo (proporción de pantalla de celular en vertical,
// igual que ZONE_ASPECT en games/blind-shot/logic.js — no hay forma de
// compartir el módulo del server con el cliente en este proyecto sin
// bundler, así que se re-declara acá el mismo valor).
const CANVAS_ASPECT = 9 / 16;

let canvas = null;
let ctx = null;
let canvasWidth = 0;
let canvasHeight = 0;

// Estado de la ronda en curso — la zona ahora es un rectángulo
// (halfWidth/halfHeight), no un radio.
let zoneHalfWidth = 1000 * CANVAS_ASPECT;
let zoneHalfHeight = 1000;
let simX = 0;
let simY = 0;
let deadline = 0;
let submitted = false;
let roundActive = false;

// Ícono propio (el mismo emoji que se asignó al entrar a la sala) — se
// dibuja en el mini-mapa en vez de un punto liso. Ver Platform.session en
// public/platform/platform.js: ya se usa para el texto del lobby, acá se
// reutiliza para canvas.
const myIcon = Platform.session.load(GAME_ID).icon || "🙂";

// Estado de los dos dedos. El primero en tocar (mientras siga activo)
// controla el joystick; el siguiente pointerId distinto controla la
// puntería. Soltar el dedo de puntería NO borra aimAngle — se mantiene
// "vivo" hasta que termine la ronda (alimenta la cadena de respaldo del
// servidor si nunca se vuelve a tocar). aimAngle arranca en 0 (no null) y
// NUNCA se resetea entre rondas — así el láser de puntería ya se ve desde
// el arranque de cada ronda, apuntando a la última dirección conocida (o
// "a la derecha" en la primerísima ronda de la partida), en vez de
// aparecer recién cuando se toca con el segundo dedo.
let joystickPointerId = null;
let joystickOrigin = null; // {x,y} en px de canvas — base FLOTANTE, no fija
let joystickVec = { x: 0, y: 0 }; // normalizado, -1..1
let aimPointerId = null;
let aimAngle = 0;

let rafHandle = null;
let lastFrameTs = null;

function worldToCanvas(wx, wy) {
  const scale = canvasHeight / (2 * zoneHalfHeight);
  return {
    x: canvasWidth / 2 + wx * scale,
    y: canvasHeight / 2 - wy * scale, // mini-mapa espejado: +y de mundo sube en pantalla
  };
}

// Distancia (en unidades de mundo) desde (x0,y0) hasta el borde del
// rectángulo de la zona vigente, siguiendo la dirección `angle` — método
// del "slab" reducido a un punto que ya está adentro del rectángulo:
// mínimo t positivo que hace tocar cualquiera de los 4 bordes.
function distanceToZoneEdge(x0, y0, angle, halfWidth, halfHeight) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (halfWidth - x0) / dx);
  else if (dx < 0) t = Math.min(t, (-halfWidth - x0) / dx);
  if (dy > 0) t = Math.min(t, (halfHeight - y0) / dy);
  else if (dy < 0) t = Math.min(t, (-halfHeight - y0) / dy);
  return Number.isFinite(t) ? t : 0;
}

function setupCanvasOnce() {
  if (canvas) return;
  const waitingRoom = document.getElementById("waitingRoom");
  waitingRoom.innerHTML = `
    <div class="control-wrap">
      <canvas id="controlCanvas" width="450" height="800"></canvas>
      <p class="control-hint" id="controlHint">Un dedo: moverte · Segundo dedo: apuntar</p>
    </div>
  `;
  canvas = document.getElementById("controlCanvas");
  ctx = canvas.getContext("2d");
  canvasWidth = canvas.width;
  canvasHeight = canvas.height;
  wireCanvasPointerEvents();
}

function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function updateJoystickVector(px, py) {
  const dx = px - joystickOrigin.x;
  const dy = py - joystickOrigin.y;
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, JOYSTICK_MAX_PX);
  const nx = dist > 0 ? dx / dist : 0;
  const ny = dist > 0 ? dy / dist : 0;
  joystickVec = {
    x: (nx * clamped) / JOYSTICK_MAX_PX,
    y: -((ny * clamped) / JOYSTICK_MAX_PX), // flip: arriba en pantalla = +y de mundo
  };
}

function updateAim(px, py) {
  // Ángulo relativo a la posición propia YA PROYECTADA en el mini-mapa
  // (no el toque crudo de pantalla) — "apunto hacia donde toco relativo a
  // mí" (ver plan).
  const selfCanvas = worldToCanvas(simX, simY);
  const dx = px - selfCanvas.x;
  const dy = -(py - selfCanvas.y); // vuelve a mundo (flip)
  aimAngle = Math.atan2(dy, dx);
}

function wireCanvasPointerEvents() {
  canvas.addEventListener("pointerdown", (e) => {
    if (!roundActive || submitted) return;
    canvas.setPointerCapture(e.pointerId);
    const p = canvasPointFromEvent(e);
    if (joystickPointerId === null) {
      joystickPointerId = e.pointerId;
      joystickOrigin = p;
      joystickVec = { x: 0, y: 0 };
    } else if (aimPointerId === null && e.pointerId !== joystickPointerId) {
      aimPointerId = e.pointerId;
      updateAim(p.x, p.y);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerId === joystickPointerId) {
      const p = canvasPointFromEvent(e);
      updateJoystickVector(p.x, p.y);
    } else if (e.pointerId === aimPointerId) {
      const p = canvasPointFromEvent(e);
      updateAim(p.x, p.y);
    }
  });

  function release(e) {
    if (e.pointerId === joystickPointerId) {
      joystickPointerId = null;
      joystickOrigin = null;
      joystickVec = { x: 0, y: 0 };
    } else if (e.pointerId === aimPointerId) {
      aimPointerId = null; // aimAngle NO se borra — sigue "vivo"
    }
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
}

function drawFrame() {
  if (!ctx) return;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Zona vigente: ahora un rectángulo (toda la pantalla del celular, no un
  // círculo) — el clamp del movimiento coincide exactamente con este borde.
  ctx.strokeStyle = "#333c52";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, canvasWidth - 3, canvasHeight - 3);

  const self = worldToCanvas(simX, simY);

  // Láser de puntería: siempre visible (aimAngle ya no es null nunca, ver
  // declaración arriba), rojo, largo — llega hasta el borde de la zona
  // vigente en la dirección apuntada (no un largo fijo arbitrario).
  const edgeDist = distanceToZoneEdge(simX, simY, aimAngle, zoneHalfWidth, zoneHalfHeight);
  const scale = canvasHeight / (2 * zoneHalfHeight);
  const tx = self.x + Math.cos(aimAngle) * edgeDist * scale;
  const ty = self.y - Math.sin(aimAngle) * edgeDist * scale; // flip
  ctx.beginPath();
  ctx.moveTo(self.x, self.y);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = LASER_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Jugador: el emoji que se le asignó al entrar, no un punto liso.
  ctx.font = `${PLAYER_MARKER_PX}px 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(myIcon, self.x, self.y);

  // Joystick flotante (solo mientras el dedo está activo).
  if (joystickOrigin) {
    ctx.beginPath();
    ctx.arc(joystickOrigin.x, joystickOrigin.y, JOYSTICK_MAX_PX, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(241, 237, 228, 0.25)";
    ctx.lineWidth = 2;
    ctx.stroke();

    const knobX = joystickOrigin.x + joystickVec.x * JOYSTICK_MAX_PX;
    const knobY = joystickOrigin.y - joystickVec.y * JOYSTICK_MAX_PX;
    ctx.beginPath();
    ctx.arc(knobX, knobY, 18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(241, 237, 228, 0.5)";
    ctx.fill();
  }
}

function controlLoop(ts) {
  if (!lastFrameTs) lastFrameTs = ts;
  const dt = Math.min((ts - lastFrameTs) / 1000, 0.1); // tope de dt por si la pestaña estuvo en 2do plano
  lastFrameTs = ts;

  if (roundActive && !submitted) {
    if (joystickPointerId !== null) {
      simX += joystickVec.x * MOVE_SPEED * dt;
      simY += joystickVec.y * MOVE_SPEED * dt;
      // Clamp por eje (rectángulo) — más simple que el círculo de antes.
      simX = Math.max(-zoneHalfWidth, Math.min(zoneHalfWidth, simX));
      simY = Math.max(-zoneHalfHeight, Math.min(zoneHalfHeight, simY));
    }

    // Chequea el deadline cuadro a cuadro (nunca hay tick del servidor al
    // celular, a propósito) — si la pestaña estuvo en 2do plano, el primer
    // frame al volver ya nota que pasó el deadline y manda el último
    // estado conocido.
    if (Date.now() >= deadline) {
      submitJourney();
    }
  }

  drawFrame();
  rafHandle = requestAnimationFrame(controlLoop);
}

function submitJourney() {
  if (submitted) return;
  submitted = true;
  vibrate(VIBRATE.submitted);
  socket.emit("round:submit", { x: simX, y: simY, angle: aimAngle }, (res) => {
    if (!res.ok) console.error("round:submit falló:", res.error);
  });
  const hint = document.getElementById("controlHint");
  if (hint) hint.textContent = "Jugada enviada — esperando al resto...";
}

function stopControlLoop() {
  roundActive = false;
  if (rafHandle) cancelAnimationFrame(rafHandle);
  rafHandle = null;
  lastFrameTs = null;
  canvas = null;
  ctx = null;
  joystickPointerId = null;
  joystickOrigin = null;
  aimPointerId = null;
}

// --- round:yourTurn: arranca (o reanuda, si es un reconnect) el control
//     de esta ronda. alreadySubmitted (solo presente en un reenvío por
//     reconnect) deja al jugador en modo "esperando" sin poder volver a
//     mandar. ---
socket.on("round:yourTurn", ({ zone, startX, startY, deadline: dl, alreadySubmitted }) => {
  if (amIDead) return;
  vibrate(VIBRATE.roundStart);

  zoneHalfWidth = zone.halfWidth;
  zoneHalfHeight = zone.halfHeight;
  simX = startX;
  simY = startY;
  deadline = dl;
  // aimAngle NO se reinicia acá a propósito: se mantiene entre rondas (el
  // láser ya arranca visible apuntando a la última dirección conocida, o a
  // su valor por defecto 0 en la primerísima ronda — ver declaración).
  submitted = Boolean(alreadySubmitted);

  setupCanvasOnce();
  roundActive = true;

  if (submitted) {
    const hint = document.getElementById("controlHint");
    if (hint) hint.textContent = "Ya mandaste tu jugada — esperando al resto...";
  }

  if (!rafHandle) {
    lastFrameTs = null;
    rafHandle = requestAnimationFrame(controlLoop);
  }
});
