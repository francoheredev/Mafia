// games/blind-shot/logic.js
// Toda la lógica de juego pura de Blind Shot: spawn, el loop de ronda
// (movimiento a ciegas -> resolución de disparos -> achique de zona),
// condición de victoria, y los tres hooks del contrato de plugin
// (remapPlayerId, onReconnect, onKick). Nada acá sabe de Express ni de
// Socket.IO como transporte genérico, ni del registry — solo recibe
// `io`/`room`/`roomCode` ya resueltos (o, para el núcleo puro de
// resolución, ni siquiera eso) y hace lo que corresponda.
//
// room.gameState (ver plan):
//   {
//     zoneRadius: number,      // se achica ronda a ronda
//     roundNumber: number,
//     round: { number, deadline, timer } | null,  // solo con phase === "round-active"/"reveal"
//     players: { [playerId]: { x, y, aim, submission: null | { x, y, angle } } },
//   }
// Posición/ángulo/submission van acá (no en room.players[id]) — mismo
// criterio que Mafia (gameState.assignment, gameState.night):
// room.players[id] es identidad genérica de la plataforma
// (name/connected/alive/icon/token), gameState es simulación propia del
// juego. Esto además hace que remapPlayerId sea trivial.

const { pushHistory } = require("../../platform/core/rooms");
const { startTimer } = require("../../platform/core/timer");

// --- Constantes ---
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 16;

const ARENA_RADIUS = 1000;
const SPAWN_MARGIN = 0.9;
const ZONE_SHRINK_FACTOR = 0.85;
const ZONE_MIN_RADIUS = 120;

// Bajo NODE_ENV === "test" se acortan — a diferencia de Mafia (que puede
// resolver antes si todos ya actuaron), Blind Shot nunca resuelve antes de
// tiempo por diseño (ver resolveRound), así que un test end-to-end no tiene
// otra forma de no esperar el tiempo real completo.
const IS_TEST = process.env.NODE_ENV === "test";
const ROUND_MOVE_MS = IS_TEST ? 800 : 20000;
const REVEAL_MS = IS_TEST ? 300 : 8000;
const MOVE_EPSILON = 1;

const SHOT_MAX_RANGE = ARENA_RADIUS * 2.5;
const HIT_CORRIDOR_HALF_WIDTH = 40;

function getAliveIds(room) {
  return Object.keys(room.players).filter((id) => room.players[id].alive);
}

// Gana el último en pie; si una cadena de eliminaciones deja a 0, es empate
// (igual que checkWinner de Mafia — la partida tiene que terminar igual,
// pero sin ganador). null = seguir jugando.
function checkWinner(room) {
  const aliveIds = getAliveIds(room);
  if (aliveIds.length === 0) return "draw";
  if (aliveIds.length === 1) return aliveIds[0];
  return null;
}

// Empuja (x, y) hacia adentro del radio dado si quedó afuera — se usa tanto
// para el re-clampeo del servidor sobre lo que manda el celular (nunca
// confía en el clamp del cliente) como para "empujar" a los sobrevivientes
// hacia adentro cuando la zona se achica entre rondas.
function clampToRadius(x, y, radius) {
  const dist = Math.hypot(x, y);
  if (dist <= radius || dist === 0) return { x, y };
  const scale = radius / dist;
  return { x: x * scale, y: y * scale };
}

// Distribución uniforme en área (no amontonada en el centro): ángulo
// parejo + radio con sqrt(random). Pura — no toca ningún room, así que
// tests/blind-shot/test-start.js la prueba directo.
function spawnPositions(count) {
  const maxR = ARENA_RADIUS * SPAWN_MARGIN;
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * maxR;
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}

// Fisher–Yates con Math.random(), sin seed — mismo criterio que
// assignRoles de Mafia (test-roles.js asegura invariantes sobre el
// resultado real en vez de forzar el azar).
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function createGameState() {
  return {
    zoneRadius: ARENA_RADIUS,
    roundNumber: 0,
    round: null,
    players: {},
  };
}

// Arranca (o vuelve a arrancar, ronda tras ronda) la fase de movimiento a
// ciegas: incrementa roundNumber, limpia la submission de todos los vivos,
// avisa a toda la sala (sin posiciones — la pantalla solo dibuja el círculo
// de la zona) y a cada jugador vivo individualmente su propio punto de
// partida + deadline absoluto (no una duración: así un reconnect a mitad de
// ronda puede reusar el mismo deadline sin drift de reloj — ver
// blindShotOnReconnect). Arranca el timer de seguridad que resuelve la
// ronda si nadie manda round:submit a tiempo (el celular igual siempre
// dispara automáticamente cuando su propio reloj cruza el deadline).
function startMovementPhase(io, room, roomCode) {
  const gs = room.gameState;
  gs.roundNumber = (gs.roundNumber || 0) + 1;
  room.phase = "round-active";

  const aliveIds = getAliveIds(room);
  aliveIds.forEach((id) => {
    gs.players[id].submission = null;
  });

  io.to(roomCode).emit("round:begin", {
    number: gs.roundNumber,
    zoneRadius: gs.zoneRadius,
    arenaRadius: ARENA_RADIUS,
    aliveCount: aliveIds.length,
  });

  const deadline = Date.now() + ROUND_MOVE_MS;
  gs.round = { number: gs.roundNumber, deadline, timer: null };

  aliveIds.forEach((id) => {
    const p = gs.players[id];
    io.to(id).emit("round:yourTurn", {
      zoneRadius: gs.zoneRadius,
      startX: p.x,
      startY: p.y,
      deadline,
    });
  });

  clearTimeout(gs.round.timer);
  gs.round.timer = startTimer(io, roomCode, room, Math.max(deadline - Date.now(), 0), () =>
    resolveRound(io, room, roomCode)
  );
}

// Cadena de respaldo del ángulo de puntería (si el jugador nunca tocó con
// el segundo dedo esta ronda): 1) ángulo explícito si mandó uno; 2)
// dirección de movimiento si se movió más de MOVE_EPSILON; 3) mantiene el
// último ángulo conocido (0 en su primera ronda).
function resolveAim(startX, startY, finalX, finalY, submissionAngle, previousAim) {
  if (typeof submissionAngle === "number") return submissionAngle;
  const dx = finalX - startX;
  const dy = finalY - startY;
  if (Math.hypot(dx, dy) > MOVE_EPSILON) return Math.atan2(dy, dx);
  return typeof previousAim === "number" ? previousAim : 0;
}

// Corridor de disparo de ancho fijo (por qué no tolerancia angular: ver
// plan — una tolerancia angular fija se vuelve trivial a rango largo e
// imposible de cerca). Proyección `t` del objetivo sobre la dirección de
// puntería (descarta t<0 o t>SHOT_MAX_RANGE), distancia perpendicular
// `perp`; impacta si perp <= HIT_CORRIDOR_HALF_WIDTH. Entre varios
// candidatos, gana el de menor `t` (el más cercano en la línea de tiro).
function findHit(shooter, shooterId, aliveIdsAtStart, resolved, room, deadThisRound) {
  const dirX = Math.cos(shooter.angle);
  const dirY = Math.sin(shooter.angle);
  let best = null;

  aliveIdsAtStart.forEach((targetId) => {
    if (targetId === shooterId) return;
    if (!room.players[targetId]?.alive || deadThisRound.has(targetId)) return;
    const target = resolved[targetId];
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const t = dx * dirX + dy * dirY;
    if (t < 0 || t > SHOT_MAX_RANGE) return;
    const perpX = dx - dirX * t;
    const perpY = dy - dirY * t;
    const perp = Math.hypot(perpX, perpY);
    if (perp > HIT_CORRIDOR_HALF_WIDTH) return;
    if (!best || t < best.t) best = { targetId, t };
  });

  return best;
}

// Núcleo puro de la resolución de una ronda: recibe el `order` (aleatorio,
// ya sorteado por el caller) de los jugadores vivos al empezar la ronda y
// resuelve posiciones finales, ángulos (con la cadena de respaldo) y
// disparos en cadena (si a alguien lo matan antes de que le toque en este
// orden, su disparo no sale). Muta room.players[id].alive y
// room.gameState (posiciones/aim/zona) — pero no toca `io` ni sockets, así
// que se puede testear con fixtures armados a mano, sin pelear contra el
// azar de sockets (ver tests/blind-shot/test-round-resolve.js). El wrapper
// fino resolveRound(io, room, roomCode) de más abajo arma el shuffle real y
// hace los emits/pushHistory.
function resolveRoundWithOrder(room, order) {
  const gs = room.gameState;
  const zoneRadiusBefore = gs.zoneRadius;
  const aliveIdsAtStart = order;

  // Paso 1: posición/ángulo final de cada jugador vivo al empezar la ronda,
  // a partir de lo que mandó (o no) por round:submit.
  const resolved = {};
  aliveIdsAtStart.forEach((id) => {
    const p = gs.players[id];
    const sub = p.submission;
    const startX = p.x;
    const startY = p.y;
    const finalX = sub ? sub.x : startX;
    const finalY = sub ? sub.y : startY;
    const angle = resolveAim(startX, startY, finalX, finalY, sub ? sub.angle : null, p.aim);
    resolved[id] = { x: finalX, y: finalY, angle };
  });

  // Paso 2: recorre el orden sorteado resolviendo disparos en cadena.
  const events = [];
  const deadThisRound = new Set();
  order.forEach((shooterId) => {
    const at = { x: resolved[shooterId].x, y: resolved[shooterId].y };
    if (!room.players[shooterId]?.alive || deadThisRound.has(shooterId)) {
      // Ya lo mataron antes de que le tocara en este orden — su disparo no
      // sale. `at` igual queda (la pantalla puede mostrar el cuerpo en su
      // posición aunque no haya disparo que animar).
      events.push({ shooterId, fired: false, hitId: null, at });
      return;
    }
    const shooter = resolved[shooterId];
    const best = findHit(shooter, shooterId, aliveIdsAtStart, resolved, room, deadThisRound);

    if (best) {
      deadThisRound.add(best.targetId);
      room.players[best.targetId].alive = false;
    }
    events.push({
      shooterId,
      fired: true,
      hitId: best ? best.targetId : null,
      angle: shooter.angle,
      at,
      // Posición exacta del objetivo si pegó — así la pantalla puede
      // dibujar la línea del disparo hasta el punto justo del impacto en
      // vez de una distancia arbitraria (ver animación de revelación).
      to: best ? { x: resolved[best.targetId].x, y: resolved[best.targetId].y } : null,
    });
  });

  // Paso 3: la simulación (posición/ángulo) de todos los que estaban vivos
  // al empezar la ronda queda al día, ganen o pierdan — y la submission se
  // limpia para la próxima ronda.
  aliveIdsAtStart.forEach((id) => {
    gs.players[id].x = resolved[id].x;
    gs.players[id].y = resolved[id].y;
    gs.players[id].aim = resolved[id].angle;
    gs.players[id].submission = null;
  });

  const winner = checkWinner(room);

  // Paso 4/5: si no hay ganador, la zona se achica (con piso en
  // ZONE_MIN_RADIUS — al tocar el piso, la fórmula sola satura ahí, no
  // hace falta caso especial de "sudden death") y empuja hacia adentro a
  // cualquier sobreviviente que haya quedado afuera del nuevo radio.
  let zoneRadiusAfter = zoneRadiusBefore;
  if (!winner) {
    zoneRadiusAfter = Math.max(zoneRadiusBefore * ZONE_SHRINK_FACTOR, ZONE_MIN_RADIUS);
    getAliveIds(room).forEach((id) => {
      const p = gs.players[id];
      const clamped = clampToRadius(p.x, p.y, zoneRadiusAfter);
      p.x = clamped.x;
      p.y = clamped.y;
    });
    gs.zoneRadius = zoneRadiusAfter;
  }

  return { events, winner, zoneRadiusBefore, zoneRadiusAfter };
}

// Wrapper fino: arma el orden real (Fisher–Yates sobre los vivos al
// empezar la ronda), delega en el núcleo puro de arriba, y hace los
// side-effects de red (emit, pushHistory, programar la próxima fase).
function resolveRound(io, room, roomCode) {
  if (room.phase !== "round-active") return; // ya se resolvió (evita doble resolución con el timeout)
  clearTimeout(room.gameState.round?.timer);

  const aliveIdsAtStart = getAliveIds(room);
  const order = shuffle(aliveIdsAtStart);
  const { events, winner, zoneRadiusBefore, zoneRadiusAfter } = resolveRoundWithOrder(room, order);

  room.phase = winner ? "game-over" : "reveal";

  events.forEach((e) => {
    if (e.fired && e.hitId) {
      pushHistory(io, room, roomCode, "💥", `${room.players[e.hitId]?.name || "Alguien"} fue eliminado/a.`);
    }
  });
  if (winner === "draw") {
    pushHistory(io, room, roomCode, "🤝", "Nadie quedó en pie. Empate.");
  } else if (winner) {
    pushHistory(io, room, roomCode, "🏆", `${room.players[winner]?.name || "Alguien"} ganó la partida.`);
  }

  io.to(roomCode).emit("round:resolved", {
    number: room.gameState.roundNumber,
    order: events,
    zoneRadiusBefore,
    zoneRadiusAfter,
    winner,
  });

  if (winner) return;

  // Red de seguridad: si la pantalla no manda round:advance antes, se pasa
  // solo a la próxima ronda.
  clearTimeout(room.gameState.round.timer);
  room.gameState.round.timer = setTimeout(() => startMovementPhase(io, room, roomCode), REVEAL_MS);
}

// Mueve gameState.players[oldId] a [newId]. Nada más — no hay orden de
// liderazgo ni votos en curso que remapear (a diferencia de Mafia).
// Implementa el hook remapPlayerId(gameState, chat, oldId, newId) del
// contrato de plugin.
function blindShotRemapPlayerId(gameState, chat, oldId, newId) {
  if (gameState.players && gameState.players[oldId]) {
    gameState.players[newId] = gameState.players[oldId];
    delete gameState.players[oldId];
  }
}

// Le reenvía a un jugador recién reconectado lo que le corresponde ver
// ahora mismo. A diferencia de Mafia, acá no hay ningún rol que reenviar —
// solo el estado de la ronda en curso (o un genérico "mirá la pantalla" si
// no hay nada que hacer en este momento). Implementa el hook
// onReconnect({ io, room, roomCode, playerId }) del contrato de plugin;
// solo se invoca cuando room.started es true.
function blindShotOnReconnect({ io, room, roomCode, playerId }) {
  const player = room.players[playerId];
  if (!player) return;

  // A diferencia de Mafia, una pestaña nueva no tiene memoria local de
  // haber muerto — hace falta un marcador explícito.
  if (!player.alive) {
    io.to(playerId).emit("round:spectator", {});
    return;
  }

  if (room.phase === "round-active") {
    const gs = room.gameState;
    const p = gs.players[playerId];
    if (!p) return;
    io.to(playerId).emit("round:yourTurn", {
      zoneRadius: gs.zoneRadius,
      startX: p.x,
      startY: p.y,
      deadline: gs.round.deadline, // el deadline ORIGINAL, no uno nuevo — sin drift de reloj
      alreadySubmitted: Boolean(p.submission),
    });
    return;
  }

  // "reveal" / "game-over": Blind Shot nunca resuelve antes de tiempo, así
  // que no hay ninguna acción pendiente que reenviar acá — solo el
  // genérico de "mirá la pantalla".
  io.to(playerId).emit("round:waiting", { message: "Mirá la pantalla para ver qué está pasando..." });
}

// Expulsar a un jugador ya en partida (host): se lo trata como una
// eliminación silenciosa, sin narrativa — igual que cualquier otra baja de
// este juego. Implementa el hook onKick({ io, room, roomCode, targetId })
// del contrato de plugin; la plataforma ya se ocupó del caso "todavía en
// el lobby" antes de llegar acá. A diferencia de Mafia, no hace falta
// ningún re-chequeo de "¿ya actuaron todos?" — Blind Shot nunca resuelve
// antes de tiempo por diseño, así que la próxima resolveRound ya lee
// `alive` al vuelo sin que haga falta forzar nada acá; lo único que sí hay
// que resolver en el momento es si el kick deja un único (o ningún)
// jugador en pie, porque ahí la partida termina fuera del ciclo normal de
// rondas.
function blindShotOnKick({ io, room, roomCode, targetId }) {
  const targetSocket = io.sockets.sockets.get(targetId);
  if (room.players[targetId]) room.players[targetId].alive = false;

  if (targetSocket) {
    targetSocket.emit("player:kicked", { reason: "Fuiste expulsado por el anfitrión." });
    targetSocket.disconnect(true);
  }
  io.to(roomCode).emit("player:removed", { removedIds: [targetId] });

  const winner = checkWinner(room);
  if (winner) {
    clearTimeout(room.gameState.round?.timer);
    room.phase = "game-over";
    io.to(roomCode).emit("game:over", { winner });
  }

  return { ok: true };
}

module.exports = {
  MIN_PLAYERS,
  MAX_PLAYERS,
  ARENA_RADIUS,
  ZONE_MIN_RADIUS,
  ROUND_MOVE_MS,
  REVEAL_MS,
  getAliveIds,
  checkWinner,
  clampToRadius,
  spawnPositions,
  shuffle,
  createGameState,
  startMovementPhase,
  resolveRound,
  resolveRoundWithOrder,
  blindShotRemapPlayerId,
  blindShotOnReconnect,
  blindShotOnKick,
};
