// server.js
// "La Mafia": la pantalla compartida crea una sala, los celulares se unen
// escaneando un código, y todo se sincroniza por WebSockets (Socket.IO)
// contra este servidor autoritativo — roles, ciclo Noche y ciclo Día
// incluidos (ver GDD sección 6). Falta la condición de victoria: por ahora
// el ciclo Noche/Día se repite sin chequear si ya ganó algún bando.

const express = require("express");
const http = require("http");
const os = require("os");
const { randomUUID } = require("crypto");
const { Server } = require("socket.io");
const { assignRoles, getMafiaAccomplices, getRolesInPlay, ROLE_INFO } = require("./roles");
const { GENERAL_RULES } = require("./rules");
const { rooms, pushHistory, generateRoomCode, publicPlayerList } = require("./platform/core/rooms");
const { registerGame, getGame } = require("./platform/core/registry");
const { attachPluginEvents, attachConnectionHandlers } = require("./platform/core/connection");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// La pantalla abre esta página como "localhost", pero el QR tiene que
// apuntar a una IP a la que los celulares (en la misma red Wi-Fi) puedan
// llegar. Se busca la primera IP LAN no interna de la máquina para armarlo.
app.get("/lan-ip", (req, res) => {
  const interfaces = os.networkInterfaces();
  let lanIp = null;
  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        lanIp = iface.address;
        break;
      }
    }
    if (lanIp) break;
  }
  res.json({ lanIp });
});

// Catálogo completo de roles (no solo los de esta partida) + reglas
// generales, servido como JS estático para que tanto el celular como la
// pantalla lo tengan disponible desde que cargan la página, sin necesidad
// de un evento de socket dedicado ni de duplicar estos datos en el cliente.
app.get("/rules-data.js", (req, res) => {
  res.type("application/javascript").send(
    `window.LAMAFIA_RULES = ${JSON.stringify({
      allRoles: Object.entries(ROLE_INFO).map(([roleId, r]) => ({ roleId, ...r })),
      generalRules: GENERAL_RULES,
    })};`
  );
});

// Tope máximo de la noche si a alguien se le hace larga la decisión.
const NIGHT_TIMEOUT_MS = 60000;

// Una vez que ya actuaron todos los que tenían algo para hacer esta noche
// (Mafia + Detective + Médico, según quién siga vivo), no hace falta seguir
// esperando el resto del NIGHT_TIMEOUT_MS completo — pero tampoco se corta
// en el acto, porque el Vidente necesita un margen real para leer el
// resultado de su investigación (night:investigateResult) antes de que la
// pantalla pase al amanecer.
const NIGHT_EARLY_RESOLVE_MS = 7000;

// Ciclo Día (Fases 2-6 del GDD): amanecer -> discusión -> votación ->
// defensa -> juicio -> vuelve a caer la noche.
// NIGHT_RESULT_MS/DAY_RESULT_MS son una red de seguridad, no el mecanismo
// principal: la pantalla avisa con "day:advance" apenas termina de mostrar
// su narrativa (ver abajo), y ahí se avanza de fase al instante. Estos
// timers solo entran a tallar si por algún motivo la pantalla no avisa.
const NIGHT_RESULT_MS = 15000;
const DISCUSSION_MS = 60000; // tiempo por defecto para discutir (la pantalla puede cortarlo antes)
const VOTING_MS = 30000; // votación de a quién acusar
const DEFENSE_MS = 30000; // tiempo por defecto para que el acusado se defienda (cortable)
const TRIAL_MS = 30000; // veredicto culpable/inocente
const DAY_RESULT_MS = 15000;

// Cada jugador recibe uno de estos como avatar al unirse (ambientación de
// aldea de fantasía — ver GDD sección 3.1). Se intenta no repetir dentro
// de una misma sala mientras haya opciones disponibles.
const PLAYER_ICONS = [
  "🦊", "🐻", "🦉", "🦌", "🦔", "🐿️", "🦇", "🐗", "🦅", "🐢",
  "🦆", "🐸", "🦋", "🐝", "🦎", "🐍", "🦂", "🐌", "🦡", "🐇",
  "🦃", "🦩", "🦚", "🦜", "🐦", "🦢", "🐴", "🐐", "🐑", "🐖",
];
function pickIcon(room) {
  const used = new Set(Object.values(room.players).map((p) => p.icon));
  const available = PLAYER_ICONS.filter((i) => !used.has(i));
  const pool = available.length > 0 ? available : PLAYER_ICONS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function getAliveIds(room) {
  return Object.keys(room.players).filter((id) => room.players[id].alive);
}

// A diferencia de getAliveIds, además exige estar conectado — se usa
// puntualmente para no bloquear el avance de una fase esperando a alguien
// que se desconectó (ver maybeResolveVoting/maybeResolveTrial). El resto
// del juego (listas de objetivos, condición de victoria, rotación de líder,
// venganza del Cazador) debe seguir usando getAliveIds sin filtrar por
// conexión, para que alguien que reconecta a tiempo pueda seguir jugando.
function getActiveIds(room) {
  return Object.keys(room.players).filter((id) => room.players[id].alive && room.players[id].connected);
}

function playerBrief(room, id) {
  return { id, name: room.players[id].name, icon: room.players[id].icon };
}

function aliveTargets(room, excludeIds = []) {
  return getAliveIds(room)
    .filter((id) => !excludeIds.includes(id))
    .map((id) => playerBrief(room, id));
}

// La Mafia rota quién de ellos decide la víctima cada noche.
function pickLeader(room) {
  const order = (room.gameState.mafiaOrder || []).filter((id) => room.players[id]?.alive);
  if (order.length === 0) return null;
  const idx = (room.gameState.night.number - 1) % order.length;
  return order[idx];
}

// Sugerencias no vinculantes de la Mafia (herramienta para ponerse de
// acuerdo antes de que el líder confirme la elección real). Solo se
// mandan entre mafiosos vivos y conectados — un jugador desconectado
// queda "congelado" (connected:false) pero sigue alive:true, así que hay
// que chequear ambos acá para no filtrar a alguien que ya se fue.
function broadcastMafiaSuggestions(io, room) {
  const suggestions = Object.entries(room.gameState.night.mafiaSuggestions)
    .filter(([voterId, targetId]) => {
      const voter = room.players[voterId];
      if (!voter?.alive || !voter?.connected) return false;
      if (targetId === null) return true;
      return Boolean(room.players[targetId]?.alive);
    })
    .map(([voterId, targetId]) => ({
      voterId,
      voterName: room.players[voterId].name,
      voterIcon: room.players[voterId].icon,
      targetId,
      targetName: targetId ? room.players[targetId].name : null,
      targetIcon: targetId ? room.players[targetId].icon : null,
    }));

  Object.keys(room.gameState.assignment)
    .filter(
      (id) =>
        room.gameState.assignment[id]?.team === "mafia" && room.players[id]?.alive && room.players[id]?.connected
    )
    .forEach((id) => io.to(id).emit("night:mafiaSuggestions", { suggestions }));
}

// Reemplaza a un setTimeout simple en las fases que la pantalla muestra con
// cuenta regresiva: además de disparar `onExpire` en el mismo momento que
// un setTimeout de `durationMs` habría disparado, manda un tick por segundo
// con el tiempo restante — solo a la pantalla, que es la única que lo
// muestra (el celular nunca tiene cronómetro, a propósito). Devuelve un
// handle de setInterval que se guarda y cancela exactamente igual que los
// setTimeout de siempre (room.gameState.night.timer / room.gameState.day.timer — en Node,
// clearTimeout funciona igual sobre un handle de setInterval).
function startTimer(io, roomCode, room, durationMs, onExpire) {
  const deadline = Date.now() + durationMs;
  const tick = () => {
    const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    io.to(room.screenSocketId).emit("timer:tick", { secondsLeft });
    if (secondsLeft <= 0) {
      clearInterval(handle);
      onExpire();
    }
  };
  const handle = setInterval(tick, 1000);
  tick(); // primer tick inmediato, no esperar 1s a que aparezca el número
  return handle;
}

function startNight(io, room, roomCode) {
  const number = (room.gameState.night?.number || 0) + 1;
  room.phase = "night";
  room.gameState.night = {
    number,
    leaderId: null,
    mafiaTargetId: null,
    mafiaSubmitted: false,
    mafiaSuggestions: {},
    detectiveTargetId: null,
    detectiveSubmitted: false,
    medicoTargetId: null,
    medicoSubmitted: false,
    brujaTargetId: null,
    brujaSubmitted: false,
    carniceroTargetId: null,
    carniceroSubmitted: false,
    earlyResolveScheduled: false,
  };
  room.gameState.night.leaderId = pickLeader(room);

  const aliveIds = getAliveIds(room);
  const targets = aliveTargets(room);

  io.to(roomCode).emit("night:begin", { number, players: targets });
  pushHistory(io, room, roomCode, "🌙", `Cae la noche #${number}.`);

  aliveIds.forEach((id) => {
    const r = room.gameState.assignment[id];
    if (!r) return;

    if (r.team === "mafia") {
      const isLeader = id === room.gameState.night.leaderId;
      io.to(id).emit("night:mafiaTurn", {
        isLeader,
        leaderName: room.players[room.gameState.night.leaderId]?.name,
        targets: targets.filter((t) => room.gameState.assignment[t.id]?.team !== "mafia"),
      });
      // Bruja/Carnicero tienen, además del voto colectivo de arriba, un
      // poder nocturno propio — se manda como un evento aparte (no
      // "night:yourTurn", que significa "esta es tu única acción de la
      // noche") para que el celular pueda mostrar ambos paneles a la vez.
      if (r.mafiaPower) {
        io.to(id).emit("night:mafiaPower", { role: r.roleId, targets });
      }
    } else if (r.hasNightAction) {
      // Hoy son Detective (Vidente) o Médico — ver ROLE_INFO en roles.js.
      const roleTargets = r.roleId === "detective" ? aliveTargets(room, [id]) : targets;
      io.to(id).emit("night:yourTurn", { role: r.roleId, targets: roleTargets });
    } else {
      io.to(id).emit("night:waiting", {});
    }
  });

  room.gameState.night.deadline = Date.now() + NIGHT_TIMEOUT_MS;
  clearTimeout(room.gameState.night.timer);
  room.gameState.night.timer = startTimer(io, roomCode, room, NIGHT_TIMEOUT_MS, () =>
    resolveNight(io, room, roomCode)
  );
}

// ¿Ya actuaron todos los que tenían algo para hacer esta noche? Solo exige
// una acción por rol que efectivamente siga vivo — si el Detective o el
// Médico ya murieron, no hace falta esperarlos.
function allNightActionsSubmitted(room) {
  const aliveIds = getAliveIds(room);
  const hasDetective = aliveIds.some((id) => room.gameState.assignment[id]?.roleId === "detective");
  const hasMedico = aliveIds.some((id) => room.gameState.assignment[id]?.roleId === "medico");
  const hasBruja = aliveIds.some((id) => room.gameState.assignment[id]?.roleId === "bruja");
  const hasCarnicero = aliveIds.some((id) => room.gameState.assignment[id]?.roleId === "carnicero");

  if (room.gameState.night.leaderId && !room.gameState.night.mafiaSubmitted) return false;
  if (hasDetective && !room.gameState.night.detectiveSubmitted) return false;
  if (hasMedico && !room.gameState.night.medicoSubmitted) return false;
  if (hasBruja && !room.gameState.night.brujaSubmitted) return false;
  if (hasCarnicero && !room.gameState.night.carniceroSubmitted) return false;
  return true;
}

// Una vez que no queda nadie por actuar, corta la espera restante del
// NIGHT_TIMEOUT_MS y deja solo un margen corto (NIGHT_EARLY_RESOLVE_MS) para
// que el Vidente alcance a leer su resultado antes de pasar al amanecer.
function maybeShortenNight(io, room, roomCode) {
  if (room.gameState.night.earlyResolveScheduled) return;
  if (!allNightActionsSubmitted(room)) return;
  room.gameState.night.earlyResolveScheduled = true;

  const remaining = Math.max(room.gameState.night.deadline - Date.now(), 0);
  const delay = Math.min(NIGHT_EARLY_RESOLVE_MS, remaining);

  clearTimeout(room.gameState.night.timer);
  room.gameState.night.timer = startTimer(io, roomCode, room, delay, () => resolveNight(io, room, roomCode));
}

// Si matan al Cazador, dispara al azar contra otro jugador vivo (GDD: habilidad al morir).
// El Lycan es un caso especial: la PRIMERA vez que alguien intenta matarlo,
// sobrevive y pasa a jugar para la Mafia en vez de morir (ver plan de roles
// nuevos) — `transformations` junta esos casos por separado de `deaths` para
// que el resto del código (narrativa, roster final) no los trate como una
// muerte más. `options.bypassLycan` lo usa kickPlayer: una expulsión del
// host es una acción fuera de la ficción del juego y nunca debería
// transformar a nadie (pero si esa expulsión dispara la venganza del
// Cazador, esa muerte en cadena sí puede transformar a un Lycan).
function killPlayer(room, id, deaths, transformations, options = {}) {
  if (!room.players[id]?.alive) return;
  const role = room.gameState.assignment[id];

  if (role?.roleId === "lycan" && role.team !== "mafia" && !options.bypassLycan) {
    role.team = "mafia";
    room.gameState.mafiaOrder = room.gameState.mafiaOrder || [];
    if (!room.gameState.mafiaOrder.includes(id)) room.gameState.mafiaOrder.push(id);
    transformations.push(id);
    return;
  }

  room.players[id].alive = false;
  deaths.push(id);

  if (role?.roleId === "cazador") {
    const aliveOthers = Object.keys(room.players).filter(
      (pid) => pid !== id && room.players[pid].alive
    );
    if (aliveOthers.length > 0) {
      const revengeId = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      killPlayer(room, revengeId, deaths, transformations);
    }
  }
}

// Efectos secundarios de una transformación de Lycan: el resto de la Mafia
// gana un aliado nuevo (hay que refrescarles la lista de cómplices) y el
// propio jugador necesita enterarse de que ahora juega para otro equipo.
function applyLycanTransformSideEffects(io, room, id) {
  const playerNames = {};
  Object.keys(room.gameState.assignment).forEach((pid) => {
    playerNames[pid] = room.players[pid]?.name;
  });

  Object.keys(room.gameState.assignment)
    .filter((pid) => room.gameState.assignment[pid]?.team === "mafia" && room.players[pid]?.alive)
    .forEach((pid) => {
      io.to(pid).emit("mafia:teamUpdate", {
        accomplices: getMafiaAccomplices(room.gameState.assignment, pid, playerNames),
      });
    });

  const r = room.gameState.assignment[id];
  io.to(id).emit("role:transformed", {
    roleId: r.roleId,
    name: r.name,
    narrativeName: r.narrativeName,
    team: r.team,
    description: r.description,
    icon: r.icon,
    accomplices: getMafiaAccomplices(room.gameState.assignment, id, playerNames),
  });
}

// Condición de victoria (binario Mafia/Ciudad — el objetivo propio de cada
// Independiente, como el Bufón, queda para más adelante). Gana la Ciudad si
// ya no queda mafia; gana la Mafia si supera estrictamente en número al
// resto (los Independientes cuentan como "buenos" para este chequeo). Si
// ambos bandos quedan en cero a la vez (venganza en cadena del Cazador), es
// un empate: la partida igual tiene que terminar, pero sin bando ganador.
// null = seguir jugando.
function checkWinner(room) {
  const aliveIds = getAliveIds(room);
  const mafiaCount = aliveIds.filter((id) => room.gameState.assignment[id]?.team === "mafia").length;
  const goodCount = aliveIds.length - mafiaCount;

  if (mafiaCount === 0 && goodCount === 0) return "draw";
  if (mafiaCount === 0) return "ciudad";
  if (mafiaCount > goodCount) return "mafia";
  return null;
}

// Revela el rol de todos (vivos y muertos) para la pantalla de fin de
// partida — a diferencia de una muerte puntual, el cierre del juego sí
// muestra quién era quién.
function buildFinalRoster(room) {
  return Object.keys(room.gameState.assignment).map((id) => ({
    id,
    name: room.players[id]?.name,
    icon: room.players[id]?.icon,
    alive: Boolean(room.players[id]?.alive),
    narrativeName: room.gameState.assignment[id].narrativeName,
    team: room.gameState.assignment[id].team,
  }));
}

function resolveNight(io, room, roomCode) {
  if (room.phase !== "night") return; // ya se resolvió (evita doble resolución con el timeout)
  clearTimeout(room.gameState.night.timer);
  room.phase = "dawn";

  const victimId = room.gameState.night.mafiaTargetId;
  const saved = Boolean(victimId && victimId === room.gameState.night.medicoTargetId);

  const deaths = [];
  const transformations = [];
  if (victimId && !saved) killPlayer(room, victimId, deaths, transformations);
  transformations.forEach((id) => applyLycanTransformSideEffects(io, room, id));

  const winner = checkWinner(room);

  io.to(roomCode).emit("night:resolved", {
    number: room.gameState.night.number,
    saved,
    // No se revela el rol de quien murió — solo que murió (ver GDD: eso
    // se discute/descubre durante el Día, no lo anuncia el sistema).
    deaths: deaths.map((id) => ({
      id,
      name: room.players[id].name,
      icon: room.players[id].icon,
    })),
    transformations: transformations.map((id) => ({
      id,
      name: room.players[id].name,
      icon: room.players[id].icon,
    })),
    winner,
    roster: winner ? buildFinalRoster(room) : undefined,
  });

  if (deaths.length === 0 && transformations.length === 0) {
    pushHistory(io, room, roomCode, saved ? "💊" : "🌙", saved ? "El Médico llegó justo a tiempo. Nadie murió esta noche." : "La Mafia no atacó. Nadie murió esta noche.");
  } else {
    deaths.forEach((id) => pushHistory(io, room, roomCode, "💀", `${room.players[id].name} murió esta noche.`));
    if (transformations.length > 0) {
      pushHistory(io, room, roomCode, "❓", "Algo protegió a alguien de la Mafia esta noche... y sigue con vida.");
    }
  }
  if (winner) pushHistory(io, room, roomCode, "🏆", `Ganó: ${winner}.`);

  if (winner) {
    room.phase = "game-over";
    return;
  }

  clearTimeout(room.gameState.night.timer);
  room.gameState.night.timer = setTimeout(() => startDiscussion(io, room, roomCode), NIGHT_RESULT_MS);
}

// --- Ciclo Día ---

function startDiscussion(io, room, roomCode) {
  const number = (room.gameState.day?.number || 0) + 1;
  // El silencio del Carnicero se calcula ANTES de pisar room.gameState.night (todavía
  // es la de la noche que recién terminó) y dura un solo Día: se recalcula
  // de cero cada vez que se llama a esta función.
  const silencedId =
    room.gameState.night?.carniceroTargetId && room.players[room.gameState.night.carniceroTargetId]?.alive
      ? room.gameState.night.carniceroTargetId
      : null;
  room.phase = "day-discussion";
  room.gameState.day = { number, timer: null, nominations: {}, accusedId: null, verdicts: {}, silencedId };

  const aliveIds = getAliveIds(room);
  const players = aliveTargets(room);

  io.to(roomCode).emit("day:discussion", { number, players });
  aliveIds.forEach((id) => io.to(id).emit("day:discussionPhone", {}));
  pushHistory(io, room, roomCode, "💬", `Comienza la discusión del Día #${number}.`);

  clearTimeout(room.gameState.day.timer);
  room.gameState.day.timer = startTimer(io, roomCode, room, DISCUSSION_MS, () =>
    startVoting(io, room, roomCode)
  );
}

function startVoting(io, room, roomCode) {
  if (room.phase !== "day-discussion") return; // ya se avanzó (botón + timeout a la vez)
  clearTimeout(room.gameState.day.timer);
  room.phase = "day-voting";
  room.gameState.day.nominations = {};

  const aliveIds = getAliveIds(room);
  const targets = aliveTargets(room);
  const { silencedId } = room.gameState.day;

  io.to(roomCode).emit("day:voting", { players: targets });
  aliveIds.forEach((id) => {
    if (id === silencedId) {
      // Silenciado por el Carnicero anoche: no puede votar hoy — se le
      // registra la abstención de una para no trabar el conteo de
      // "¿ya votaron todos?" (ver maybeResolveVoting).
      room.gameState.day.nominations[id] = null;
      io.to(id).emit("day:silenced", {});
    } else {
      io.to(id).emit("day:yourVote", { targets: targets.filter((t) => t.id !== id) });
    }
  });

  clearTimeout(room.gameState.day.timer);
  room.gameState.day.timer = startTimer(io, roomCode, room, VOTING_MS, () =>
    resolveVoting(io, room, roomCode)
  );
}

function broadcastVotingProgress(io, room, roomCode) {
  io.to(roomCode).emit("day:votingProgress", { votedIds: Object.keys(room.gameState.day.nominations) });
}

function maybeResolveVoting(io, room, roomCode) {
  const activeCount = getActiveIds(room).length;
  if (Object.keys(room.gameState.day.nominations).length >= activeCount) resolveVoting(io, room, roomCode);
}

// El Intendente vale doble en cualquier conteo de votos (acusación y
// juicio) — su peso se lee en vivo de room.gameState.assignment, no hay que guardarlo
// aparte por voto.
function voteWeight(room, voterId) {
  return room.gameState.assignment[voterId]?.voteWeight || 1;
}

function tallyVotes(room, votesObj) {
  const tally = {};
  Object.entries(votesObj).forEach(([voterId, targetId]) => {
    if (!targetId) return; // abstención
    tally[targetId] = (tally[targetId] || 0) + voteWeight(room, voterId);
  });
  return tally;
}

function resolveVoting(io, room, roomCode) {
  if (room.phase !== "day-voting") return;
  clearTimeout(room.gameState.day.timer);

  const tally = tallyVotes(room, room.gameState.day.nominations);
  const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
  const top = entries[0];

  const results = entries.map(([id, votes]) => ({
    id,
    name: room.players[id].name,
    icon: room.players[id].icon,
    votes,
  }));

  if (!top) {
    room.phase = "day-resolved";
    io.to(roomCode).emit("day:noAccusation", { results });
    pushHistory(io, room, roomCode, "🤝", "Nadie fue acusado hoy.");
    clearTimeout(room.gameState.day.timer);
    room.gameState.day.timer = setTimeout(() => startNight(io, room, roomCode), DAY_RESULT_MS);
    return;
  }

  // Empate entre los más votados (puede ser un triple empate o más): en vez
  // de dejar sin acusado el día, se sortea entre los empatados — y quien
  // salga sigue el mismo camino que cualquier acusado (defensa + juicio), no
  // una eliminación directa.
  const tiedIds = entries.filter(([, votes]) => votes === top[1]).map(([id]) => id);
  if (tiedIds.length > 1) {
    const drawnId = tiedIds[Math.floor(Math.random() * tiedIds.length)];
    room.gameState.day.accusedId = drawnId;
    pushHistory(io, room, roomCode, "🎲", `Hubo un empate en la votación — el azar señaló a ${room.players[drawnId].name}.`);
    startDefense(io, room, roomCode, results);
    return;
  }

  room.gameState.day.accusedId = top[0];
  startDefense(io, room, roomCode, results);
}

function startDefense(io, room, roomCode, votingResults) {
  room.phase = "day-defense";
  const accusedId = room.gameState.day.accusedId;

  io.to(roomCode).emit("day:defense", {
    accused: {
      id: accusedId,
      name: room.players[accusedId].name,
      icon: room.players[accusedId].icon,
    },
    results: votingResults,
  });

  io.to(accusedId).emit("day:yourDefense", {});
  getAliveIds(room)
    .filter((id) => id !== accusedId)
    .forEach((id) =>
      io.to(id).emit("day:watchDefense", { accusedName: room.players[accusedId].name })
    );
  pushHistory(io, room, roomCode, "⚖️", `${room.players[accusedId].name} fue acusado/a y va a juicio.`);

  clearTimeout(room.gameState.day.timer);
  room.gameState.day.timer = startTimer(io, roomCode, room, DEFENSE_MS, () =>
    startTrial(io, room, roomCode)
  );
}

function startTrial(io, room, roomCode) {
  if (room.phase !== "day-defense") return; // ya se avanzó (botón + timeout a la vez)
  clearTimeout(room.gameState.day.timer);
  room.phase = "day-trial";
  room.gameState.day.verdicts = {};

  const accusedId = room.gameState.day.accusedId;
  const voterIds = getAliveIds(room).filter((id) => id !== accusedId);

  io.to(roomCode).emit("day:trial", {
    accused: {
      id: accusedId,
      name: room.players[accusedId].name,
      icon: room.players[accusedId].icon,
    },
  });
  voterIds.forEach((id) => io.to(id).emit("day:yourVerdict", {}));
  io.to(accusedId).emit("day:waitVerdict", {});

  clearTimeout(room.gameState.day.timer);
  room.gameState.day.timer = startTimer(io, roomCode, room, TRIAL_MS, () =>
    resolveTrial(io, room, roomCode)
  );
}

function maybeResolveTrial(io, room, roomCode) {
  const activeVoterCount = getActiveIds(room).filter((id) => id !== room.gameState.day.accusedId).length;
  if (Object.keys(room.gameState.day.verdicts).length >= activeVoterCount) resolveTrial(io, room, roomCode);
}

function resolveTrial(io, room, roomCode) {
  if (room.phase !== "day-trial") return;
  clearTimeout(room.gameState.day.timer);
  room.phase = "day-resolved";

  const accusedId = room.gameState.day.accusedId;
  // Igual que en la votación de acusación, el Intendente pesa doble acá también.
  let guiltyCount = 0;
  let innocentCount = 0;
  Object.entries(room.gameState.day.verdicts).forEach(([voterId, verdict]) => {
    const weight = voteWeight(room, voterId);
    if (verdict === "guilty") guiltyCount += weight;
    else if (verdict === "innocent") innocentCount += weight;
  });
  const executed = guiltyCount > innocentCount;
  // El Bufón gana en el momento en que el pueblo logra votarlo y ejecutarlo
  // — es una victoria propia, independiente del conteo binario Mafia/Ciudad.
  const wasBufon = executed && room.gameState.assignment[accusedId]?.roleId === "bufon";

  const deaths = [];
  const transformations = [];
  if (executed) killPlayer(room, accusedId, deaths, transformations);
  transformations.forEach((id) => applyLycanTransformSideEffects(io, room, id));

  const winner = wasBufon ? "bufon" : checkWinner(room);

  io.to(roomCode).emit("day:resolved", {
    guiltyCount,
    innocentCount,
    executed,
    accused: {
      id: accusedId,
      name: room.players[accusedId].name,
      icon: room.players[accusedId].icon,
    },
    // Igual que las muertes de noche, tampoco se revela el rol acá — a
    // futuro esto debería ser una opción configurable por sala.
    deaths: deaths.map((id) => ({
      id,
      name: room.players[id].name,
      icon: room.players[id].icon,
    })),
    transformations: transformations.map((id) => ({
      id,
      name: room.players[id].name,
      icon: room.players[id].icon,
    })),
    winner,
    roster: winner ? buildFinalRoster(room) : undefined,
  });

  pushHistory(
    io,
    room,
    roomCode,
    executed ? "💀" : "🕊️",
    `${room.players[accusedId].name} fue ${executed ? "ejecutado/a" : "absuelto/a"} (culpable: ${guiltyCount}, inocente: ${innocentCount}).`
  );
  // deaths[0] es el ejecutado (ya registrado arriba); lo que sigue es la
  // venganza en cadena del Cazador, si corresponde.
  deaths.slice(1).forEach((id) => pushHistory(io, room, roomCode, "💀", `${room.players[id].name} también murió.`));
  if (transformations.length > 0) {
    pushHistory(io, room, roomCode, "❓", "Algo protegió a alguien de la ejecución... y sigue con vida.");
  }
  if (winner) pushHistory(io, room, roomCode, "🏆", `Ganó: ${winner}.`);

  if (winner) {
    room.phase = "game-over";
    return;
  }

  clearTimeout(room.gameState.day.timer);
  room.gameState.day.timer = setTimeout(() => startNight(io, room, roomCode), DAY_RESULT_MS);
}

// Cada jugador se identifica solo por su socket.id, que cambia al
// reconectar — así que un rejoin exitoso tiene que "mudar" ese id viejo al
// nuevo en TODAS las estructuras de la sala que puedan referenciarlo, tanto
// como clave como como valor. La parte genérica (room.players, room.chat)
// la maneja la plataforma (ver platform/core/connection.js); esto es solo
// lo semánticamente Mafia — implementa el hook remapPlayerId(gameState,
// chat, oldId, newId) del contrato de plugin. Repasar esta lista si se
// agrega un campo nuevo a gameState.night/gameState.day que guarde un id
// de jugador.
function mafiaRemapPlayerId(gameState, chat, oldId, newId) {
  if (gameState.assignment && gameState.assignment[oldId]) {
    gameState.assignment[newId] = gameState.assignment[oldId];
    delete gameState.assignment[oldId];
  }

  if (gameState.mafiaOrder) {
    gameState.mafiaOrder = gameState.mafiaOrder.map((id) => (id === oldId ? newId : id));
  }

  if (gameState.loversIds) {
    gameState.loversIds = gameState.loversIds.map((id) => (id === oldId ? newId : id));
  }

  if (gameState.night) {
    if (gameState.night.leaderId === oldId) gameState.night.leaderId = newId;
    if (gameState.night.mafiaTargetId === oldId) gameState.night.mafiaTargetId = newId;
    if (gameState.night.detectiveTargetId === oldId) gameState.night.detectiveTargetId = newId;
    if (gameState.night.medicoTargetId === oldId) gameState.night.medicoTargetId = newId;
    if (gameState.night.brujaTargetId === oldId) gameState.night.brujaTargetId = newId;
    if (gameState.night.carniceroTargetId === oldId) gameState.night.carniceroTargetId = newId;
    if (gameState.night.mafiaSuggestions) {
      const remapped = {};
      Object.entries(gameState.night.mafiaSuggestions).forEach(([voterId, targetId]) => {
        remapped[voterId === oldId ? newId : voterId] = targetId === oldId ? newId : targetId;
      });
      gameState.night.mafiaSuggestions = remapped;
    }
  }

  if (gameState.day) {
    if (gameState.day.accusedId === oldId) gameState.day.accusedId = newId;
    if (gameState.day.silencedId === oldId) gameState.day.silencedId = newId;
    if (gameState.day.nominations) {
      const remapped = {};
      Object.entries(gameState.day.nominations).forEach(([voterId, targetId]) => {
        remapped[voterId === oldId ? newId : voterId] = targetId === oldId ? newId : targetId;
      });
      gameState.day.nominations = remapped;
    }
    if (gameState.day.verdicts && oldId in gameState.day.verdicts) {
      gameState.day.verdicts[newId] = gameState.day.verdicts[oldId];
      delete gameState.day.verdicts[oldId];
    }
  }
}

// Le reenvía a un jugador recién reconectado lo que le correspondería estar
// viendo ahora mismo — el rol (+ info de Amante) que ya tenía asignado, más
// lo que corresponde a la fase actual de la sala — así su pantalla deja de
// estar "congelada" en lo último que vio antes de desconectarse. Implementa
// el hook onReconnect({ io, room, roomCode, playerId }) del contrato de
// plugin; solo se invoca cuando room.started es true (ver
// platform/core/connection.js).
function mafiaOnReconnect({ io, room, roomCode, playerId }) {
  const r = room.gameState.assignment[playerId];
  if (r) {
    const playerNames = {};
    Object.keys(room.gameState.assignment).forEach((id) => {
      playerNames[id] = room.players[id]?.name;
    });
    const payload = {
      roleId: r.roleId,
      name: r.name,
      narrativeName: r.narrativeName,
      team: r.team,
      description: r.description,
      icon: r.icon,
    };
    if (r.team === "mafia") payload.accomplices = getMafiaAccomplices(room.gameState.assignment, playerId, playerNames);
    io.to(playerId).emit("role:assigned", payload);
  }
  if (room.gameState.loversIds.includes(playerId)) {
    const partnerId = room.gameState.loversIds.find((id) => id !== playerId);
    const partnerRole = room.gameState.assignment[partnerId];
    io.to(playerId).emit("role:loverInfo", {
      partner: {
        id: partnerId,
        name: room.players[partnerId]?.name,
        icon: room.players[partnerId]?.icon,
        roleId: partnerRole?.roleId,
        roleName: partnerRole?.name,
        narrativeName: partnerRole?.narrativeName,
        team: partnerRole?.team,
      },
    });
  }

  const player = room.players[playerId];
  if (!player || !player.alive) return;
  const myRole = room.gameState.assignment[playerId];
  if (!myRole) return;

  switch (room.phase) {
    case "night":
      if (myRole.team === "mafia") {
        io.to(playerId).emit("night:mafiaTurn", {
          isLeader: playerId === room.gameState.night.leaderId,
          leaderName: room.players[room.gameState.night.leaderId]?.name,
          targets: aliveTargets(room).filter((t) => room.gameState.assignment[t.id]?.team !== "mafia"),
        });
        broadcastMafiaSuggestions(io, room);
        if (myRole.mafiaPower) {
          const alreadySubmitted =
            (myRole.roleId === "bruja" && room.gameState.night.brujaSubmitted) ||
            (myRole.roleId === "carnicero" && room.gameState.night.carniceroSubmitted);
          io.to(playerId).emit("night:mafiaPower", {
            role: myRole.roleId,
            targets: aliveTargets(room),
            alreadySubmitted,
          });
        }
      } else if (myRole.hasNightAction) {
        const alreadySubmitted =
          (myRole.roleId === "detective" && room.gameState.night.detectiveSubmitted) ||
          (myRole.roleId === "medico" && room.gameState.night.medicoSubmitted);
        if (alreadySubmitted) {
          io.to(playerId).emit("player:rejoinWaiting", {
            message: "Ya hiciste tu elección de esta noche. Esperando al resto...",
          });
        } else {
          io.to(playerId).emit("night:yourTurn", {
            role: myRole.roleId,
            targets: myRole.roleId === "detective" ? aliveTargets(room, [playerId]) : aliveTargets(room),
          });
        }
      } else {
        io.to(playerId).emit("night:waiting", {});
      }
      break;
    case "day-discussion":
      io.to(playerId).emit("day:discussionPhone", {});
      break;
    case "day-voting":
      if (playerId === room.gameState.day.silencedId) {
        io.to(playerId).emit("day:silenced", {});
      } else if (playerId in room.gameState.day.nominations) {
        io.to(playerId).emit("player:rejoinWaiting", { message: "Ya votaste. Esperando al resto..." });
      } else {
        io.to(playerId).emit("day:yourVote", { targets: aliveTargets(room, [playerId]) });
      }
      break;
    case "day-defense":
      if (playerId === room.gameState.day.accusedId) io.to(playerId).emit("day:yourDefense", {});
      else
        io.to(playerId).emit("day:watchDefense", {
          accusedName: room.players[room.gameState.day.accusedId]?.name,
        });
      break;
    case "day-trial":
      if (playerId === room.gameState.day.accusedId || playerId in room.gameState.day.verdicts) {
        io.to(playerId).emit("day:waitVerdict", {});
      } else {
        io.to(playerId).emit("day:yourVerdict", {});
      }
      break;
    case "dawn":
    case "day-resolved":
      io.to(playerId).emit("player:rejoinWaiting", { message: "Mirá la pantalla para ver qué está pasando..." });
      break;
    default:
      break;
  }
}

// Expulsar a un jugador ya en partida (host). Se lo trata como una muerte
// silenciosa — sin narrativa ni revelar rol/causa, igual que cualquier otra
// muerte de este juego — reutilizando killPlayer (que ya encadena la
// venganza del Cazador si corresponde). Implementa el hook
// onKick({ io, room, roomCode, targetId }) del contrato de plugin; la
// plataforma (ver platform/core/connection.js) ya se ocupó del caso
// "todavía en el lobby" (borrar sin más) antes de llegar acá, y ya marcó
// target.kicked = true para que un rejoin posterior con ese token se
// rechace.
function mafiaOnKick({ io, room, roomCode, targetId }) {
  const target = room.players[targetId];
  const targetSocket = io.sockets.sockets.get(targetId);

  const deaths = [];
  const transformations = [];
  // bypassLycan: una expulsión del host es una acción fuera de la ficción
  // del juego — nunca debería transformar al expulsado directo. Pero si
  // esto dispara la venganza del Cazador y esa venganza cae sobre un Lycan,
  // esa muerte en cadena sí puede transformarlo (killPlayer no le pasa el
  // bypass a su propia llamada recursiva).
  killPlayer(room, targetId, deaths, transformations, { bypassLycan: true });
  transformations.forEach((id) => applyLycanTransformSideEffects(io, room, id));

  if (targetSocket) {
    targetSocket.emit("player:kicked", { reason: "Fuiste expulsado por el anfitrión." });
    targetSocket.disconnect(true);
  }
  io.to(roomCode).emit("player:removed", { removedIds: deaths, transformations });

  const winner = checkWinner(room);
  if (winner) {
    clearTimeout(room.gameState.night?.timer);
    clearTimeout(room.gameState.day?.timer);
    room.phase = "game-over";
    io.to(roomCode).emit("game:over", { winner, roster: buildFinalRoster(room) });
    return { ok: true };
  }

  if (room.phase === "day-voting") maybeResolveVoting(io, room, roomCode);
  else if (room.phase === "day-trial") maybeResolveTrial(io, room, roomCode);
  // De noche no se hace nada extra a propósito: la noche solo la corta su
  // propio timer (ver NIGHT_TIMEOUT_MS), nunca una acción de un jugador.

  return { ok: true };
}

// --- Handlers custom de Mafia, expuestos como plugin (ver plan de
//     migración paso 4). Los cuerpos siguen viviendo acá por ahora — recién
//     se mudan a games/mafia/ en un paso posterior — pero ya se despachan a
//     través de platform/core/connection.js en vez de registrarse
//     directamente sobre cada socket, así el mecanismo de despacho por
//     room.gameId queda probado desde ya. ctx = { io, socket, room, roomCode }.
const mafiaSocketHandlers = {
  // --- La pantalla arranca la partida: se sortean y reparten los roles ---
  "game:start": (ctx, _data, ack) => {
    const { io, socket, room, roomCode } = ctx;

    if (socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede empezar la partida." });
      return;
    }

    const connectedIds = Object.entries(room.players)
      .filter(([, p]) => p.connected)
      .map(([id]) => id);

    if (connectedIds.length < 6 || connectedIds.length > 10) {
      ack?.({
        ok: false,
        error: `Se necesitan entre 6 y 10 jugadores conectados (hay ${connectedIds.length}).`,
      });
      return;
    }

    const assignment = assignRoles(connectedIds);
    room.gameState.assignment = assignment; // queda guardado para las fases de Noche/Día
    room.started = true;
    room.gameState.mafiaOrder = connectedIds.filter((id) => assignment[id].team === "mafia");
    // Amante es un rol propio (ver roles.js) — los Amantes de esta partida
    // son, directamente, quienes lo recibieron (0 o 2, nunca uno solo).
    room.gameState.loversIds = connectedIds.filter((id) => assignment[id].roleId === "amante");
    room.history = [];
    connectedIds.forEach((id) => {
      room.players[id].alive = true;
    });

    const playerNames = {};
    connectedIds.forEach((id) => {
      playerNames[id] = room.players[id].name;
    });

    connectedIds.forEach((id) => {
      const r = assignment[id];
      const payload = {
        roleId: r.roleId,
        name: r.name,
        narrativeName: r.narrativeName,
        team: r.team,
        description: r.description,
        icon: r.icon,
      };
      if (r.team === "mafia") {
        payload.accomplices = getMafiaAccomplices(assignment, id, playerNames);
      }
      io.to(id).emit("role:assigned", payload);
    });

    if (room.gameState.loversIds.length === 2) {
      const [idA, idB] = room.gameState.loversIds;
      const loverPayload = (selfId, partnerId) => ({
        partner: {
          id: partnerId,
          name: room.players[partnerId].name,
          icon: room.players[partnerId].icon,
          roleId: assignment[partnerId].roleId,
          roleName: assignment[partnerId].name,
          narrativeName: assignment[partnerId].narrativeName,
          team: assignment[partnerId].team,
        },
      });
      io.to(idA).emit("role:loverInfo", loverPayload(idA, idB));
      io.to(idB).emit("role:loverInfo", loverPayload(idB, idA));
    }

    room.phase = "role-reveal";

    ack?.({ ok: true });
    io.to(roomCode).emit("game:started", {
      playerCount: connectedIds.length,
      roles: getRolesInPlay(assignment),
    });
    pushHistory(io, room, roomCode, "🎭", "Los roles fueron repartidos. Comienza la partida.");
  },

  // --- Ciclo Noche: Mafia (líder rotativo), Vidente y Médico mandan su acción ---
  "night:action": (ctx, { role, targetId }, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (room.phase !== "night") {
      ack?.({ ok: false, error: "No es de noche." });
      return;
    }
    const myRole = room.gameState.assignment[socket.id];
    if (!myRole) {
      ack?.({ ok: false, error: "No tenés un rol asignado." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés actuar." });
      return;
    }
    const target = room.players[targetId];

    if (role === "mafia") {
      if (myRole.team !== "mafia") {
        ack?.({ ok: false, error: "No sos de la mafia." });
        return;
      }
      if (socket.id !== room.gameState.night.leaderId) {
        ack?.({ ok: false, error: "Esta noche no te toca decidir a vos." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      if (room.gameState.assignment[targetId]?.team === "mafia") {
        ack?.({ ok: false, error: "No podés elegir a un cómplice." });
        return;
      }
      room.gameState.night.mafiaTargetId = targetId;
      room.gameState.night.mafiaSubmitted = true;
    } else if (role === "detective") {
      if (myRole.roleId !== "detective") {
        ack?.({ ok: false, error: "No sos el Vidente." });
        return;
      }
      if (room.gameState.night.detectiveSubmitted) {
        ack?.({ ok: false, error: "Ya investigaste esta noche." });
        return;
      }
      const targetRole = room.gameState.assignment[targetId];
      if (!target?.alive || !targetRole || targetId === socket.id) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.detectiveTargetId = targetId;
      room.gameState.night.detectiveSubmitted = true;

      // Ajuste del GDD: el Padrino se ve como inocente si lo investigan.
      const isMafia = targetRole.team === "mafia" && targetRole.roleId !== "padrino";
      io.to(socket.id).emit("night:investigateResult", {
        targetName: target.name,
        isMafia,
      });
    } else if (role === "medico") {
      if (myRole.roleId !== "medico") {
        ack?.({ ok: false, error: "No sos el Médico." });
        return;
      }
      if (room.gameState.night.medicoSubmitted) {
        ack?.({ ok: false, error: "Ya elegiste a quién proteger." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.medicoTargetId = targetId;
      room.gameState.night.medicoSubmitted = true;
    } else if (role === "bruja") {
      if (myRole.roleId !== "bruja") {
        ack?.({ ok: false, error: "No sos la Bruja." });
        return;
      }
      if (room.gameState.night.brujaSubmitted) {
        ack?.({ ok: false, error: "Ya usaste tu poder esta noche." });
        return;
      }
      const targetRole = room.gameState.assignment[targetId];
      if (!target?.alive || !targetRole) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.brujaTargetId = targetId;
      room.gameState.night.brujaSubmitted = true;

      // Revelación inmediata a TODO el equipo Mafia vivo y conectado (no
      // solo a la Bruja) — nunca a la sala entera, esto es información
      // secreta que jamás debe llegar a la pantalla ni a un no-mafioso.
      Object.keys(room.gameState.assignment)
        .filter(
          (id) => room.gameState.assignment[id]?.team === "mafia" && room.players[id]?.alive && room.players[id]?.connected
        )
        .forEach((id) =>
          io.to(id).emit("night:brujaReveal", {
            targetId,
            targetName: target.name,
            targetIcon: target.icon,
            roleId: targetRole.roleId,
            roleName: targetRole.name,
            narrativeName: targetRole.narrativeName,
            team: targetRole.team,
          })
        );
    } else if (role === "carnicero") {
      if (myRole.roleId !== "carnicero") {
        ack?.({ ok: false, error: "No sos el Carnicero." });
        return;
      }
      if (room.gameState.night.carniceroSubmitted) {
        ack?.({ ok: false, error: "Ya elegiste a quién silenciar." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.carniceroTargetId = targetId;
      room.gameState.night.carniceroSubmitted = true;
      // El efecto (no poder votar) se aplica recién al Día siguiente — ver startDiscussion/startVoting.
    } else {
      ack?.({ ok: false, error: "Acción desconocida." });
      return;
    }

    ack?.({ ok: true });
    // Si con esta acción ya no queda nadie por decidir, se acorta la espera
    // restante (ver maybeShortenNight/NIGHT_EARLY_RESOLVE_MS) en vez de
    // esperar el NIGHT_TIMEOUT_MS completo.
    maybeShortenNight(io, room, roomCode);
  },

  // --- Sugerencia no vinculante de la Mafia (para ponerse de acuerdo antes
  //     de que el líder confirme la elección real; cualquier mafioso puede
  //     mandar la suya, no solo el líder) ---
  "night:mafiaSuggest": (ctx, { targetId }, ack) => {
    const { io, socket, room } = ctx;
    if (room.phase !== "night") {
      ack?.({ ok: false, error: "No es de noche." });
      return;
    }
    const myRole = room.gameState.assignment[socket.id];
    if (!myRole || myRole.team !== "mafia") {
      ack?.({ ok: false, error: "No sos de la mafia." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés actuar." });
      return;
    }
    if (targetId !== null) {
      const target = room.players[targetId];
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      if (room.gameState.assignment[targetId]?.team === "mafia") {
        ack?.({ ok: false, error: "No podés señalar a un cómplice." });
        return;
      }
    }
    room.gameState.night.mafiaSuggestions[socket.id] = targetId; // null = borra la sugerencia

    ack?.({ ok: true });
    broadcastMafiaSuggestions(io, room);
  },

  // --- La pantalla corta antes de tiempo una fase de discusión/defensa ---
  "day:advance": (ctx, _data, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede avanzar de fase." });
      return;
    }
    if (room.phase === "role-reveal") {
      // La pantalla terminó de narrar las reglas y los roles en juego.
      startNight(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "day-discussion") {
      startVoting(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "day-defense") {
      startTrial(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "dawn") {
      // La pantalla terminó de reproducir la narrativa del amanecer.
      clearTimeout(room.gameState.night.timer);
      startDiscussion(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "day-resolved") {
      // La pantalla terminó de reproducir la narrativa del veredicto (o de
      // "nadie fue acusado").
      clearTimeout(room.gameState.day.timer);
      startNight(io, room, roomCode);
      ack?.({ ok: true });
    } else {
      // A propósito no hay rama para "game-over": ahí termina la partida, no
      // hay próxima fase a la que avanzar.
      ack?.({ ok: false, error: "No hay nada para avanzar ahora." });
    }
  },

  // --- Votación: a quién acusar ---
  "day:vote": (ctx, { targetId }, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (room.phase !== "day-voting") {
      ack?.({ ok: false, error: "No es momento de votar." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés votar." });
      return;
    }
    if (socket.id === room.gameState.day.silencedId) {
      ack?.({ ok: false, error: "Estás silenciado, no podés votar hoy." });
      return;
    }
    if (socket.id in room.gameState.day.nominations) {
      ack?.({ ok: false, error: "Ya votaste." });
      return;
    }
    if (targetId !== null && (!room.players[targetId]?.alive || targetId === socket.id)) {
      ack?.({ ok: false, error: "Objetivo inválido." });
      return;
    }
    room.gameState.day.nominations[socket.id] = targetId; // null = abstención

    ack?.({ ok: true });
    broadcastVotingProgress(io, room, roomCode);
    maybeResolveVoting(io, room, roomCode);
  },

  // --- Juicio: culpable o inocente ---
  "day:verdict": (ctx, { verdict }, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (room.phase !== "day-trial") {
      ack?.({ ok: false, error: "No es momento de votar el veredicto." });
      return;
    }
    if (socket.id === room.gameState.day.accusedId) {
      ack?.({ ok: false, error: "No podés votar tu propio juicio." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés votar." });
      return;
    }
    if (verdict !== "guilty" && verdict !== "innocent") {
      ack?.({ ok: false, error: "Veredicto inválido." });
      return;
    }
    if (socket.id in room.gameState.day.verdicts) {
      ack?.({ ok: false, error: "Ya votaste." });
      return;
    }
    room.gameState.day.verdicts[socket.id] = verdict;

    ack?.({ ok: true });
    io.to(roomCode).emit("day:verdictProgress", { votedIds: Object.keys(room.gameState.day.verdicts) });
    maybeResolveTrial(io, room, roomCode);
  },
};

// --- Chat: "general" (todos los conectados, en cualquier momento) y
//     "fantasmas" (solo jugadores ya eliminados, entre ellos). Implementa
//     el campo chatChannels del contrato de plugin — la plataforma (ver
//     platform/core/connection.js) usa canSend para decidir quién puede
//     mandar/leer cada canal y recipients para saber a quién entregarle
//     cada mensaje; nunca a toda la sala, así la pantalla compartida nunca
//     recibe tráfico de chat y "fantasmas" nunca se filtra a un jugador
//     vivo.
const mafiaChatChannels = [
  {
    id: "general",
    canSend: () => true,
    recipients: (room) => Object.keys(room.players),
  },
  {
    id: "fantasmas",
    canSend: (room, senderId) => room.players[senderId]?.alive === false,
    recipients: (room) => Object.keys(room.players).filter((id) => room.players[id].alive === false),
  },
];

registerGame({
  id: "mafia",
  socketHandlers: mafiaSocketHandlers,
  onReconnect: mafiaOnReconnect,
  remapPlayerId: mafiaRemapPlayerId,
  onKick: mafiaOnKick,
  chatChannels: mafiaChatChannels,
});

io.on("connection", (socket) => {
  // Despacha los eventos custom del juego activo en la sala del socket
  // (game:start, night:action, day:vote, ...) a través del registry — ver
  // platform/core/connection.js.
  attachPluginEvents(io, socket);
  // Reconexión, 100% genérica (ver platform/core/connection.js).
  attachConnectionHandlers(io, socket);

  // --- La pantalla compartida crea una sala nueva ---
  socket.on("screen:create", (data) => {
    // TODO(step 12): quitar el default una vez que games/index.js registre
    // juegos reales y los clientes siempre manden gameId explícito.
    const gameId = data?.gameId || "mafia";
    const code = generateRoomCode();
    const plugin = getGame(gameId);
    const chat = {};
    (plugin?.chatChannels || []).forEach((c) => {
      chat[c.id] = [];
    });
    rooms[code] = {
      screenSocketId: socket.id,
      gameId,
      players: {},
      phase: "lobby",
      chat,
      history: [],
      gameState: { loversIds: [] },
    };
    socket.join(code);
    socket.data.role = "screen";
    socket.data.roomCode = code;
    socket.emit("screen:created", { code });
  });

  // --- Un celular se une a una sala existente ---
  socket.on("player:join", ({ code, name }, ack) => {
    const room = rooms[code];
    if (!room) {
      ack?.({ ok: false, error: "Esa sala no existe. Revisá el código." });
      return;
    }
    if (room.started) {
      // Sin esto, alguien que se une después de repartidos los roles queda
      // "adentro" pero sin rol asignado — y si termina siendo blanco de una
      // acción de otro jugador (ej. el Vidente lo investiga), el servidor
      // se cae al intentar leer un rol que no existe.
      ack?.({ ok: false, error: "La partida ya empezó — pedile al anfitrión que arranque una nueva." });
      return;
    }
    const cleanName = (name || "").trim().slice(0, 20) || "Jugador";

    const nameTaken = Object.values(room.players).some(
      (p) => p.connected && p.name.toLowerCase() === cleanName.toLowerCase()
    );
    if (nameTaken) {
      ack?.({ ok: false, error: "Ya hay alguien conectado con ese nombre en la sala." });
      return;
    }

    const token = randomUUID();
    room.players[socket.id] = {
      name: cleanName,
      connected: true,
      alive: true,
      icon: pickIcon(room),
      token,
    };
    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;

    ack?.({ ok: true, code, name: cleanName, icon: room.players[socket.id].icon, token });

    // Avisa a la pantalla (y a los demás celulares) la lista actualizada
    io.to(code).emit("lobby:update", { players: publicPlayerList(room) });
  });

  // --- La pantalla pide la lista de jugadores para el panel de expulsión ---
  socket.on("screen:getRoster", (_data, ack) => {
    const { role, roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || role !== "screen") {
      ack?.({ ok: false, error: "No autorizado." });
      return;
    }
    ack?.({
      ok: true,
      players: Object.entries(room.players).map(([id, p]) => ({
        id,
        name: p.name,
        icon: p.icon,
        connected: p.connected,
        alive: room.started ? p.alive : undefined,
      })),
    });
  });

  // --- La pantalla reinicia la partida en la MISMA sala una vez terminada:
  //     vuelve todo al lobby (mismo código, mismos jugadores conectados) sin
  //     tener que recrear la sala ni volver a escanear el QR. ---
  socket.on("game:restart", (_data, ack) => {
    const { role, roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede reiniciar la partida." });
      return;
    }
    if (room.phase !== "game-over") {
      ack?.({ ok: false, error: "La partida no terminó todavía." });
      return;
    }

    clearTimeout(room.gameState.night?.timer);
    clearTimeout(room.gameState.day?.timer);

    room.started = false;
    room.phase = "lobby";
    room.gameState.assignment = {};
    room.gameState.mafiaOrder = [];
    room.gameState.loversIds = [];
    room.history = []; // partida nueva, log nuevo
    room.gameState.night = null;
    room.gameState.day = null;

    Object.keys(room.players).forEach((id) => {
      if (room.players[id].kicked) delete room.players[id];
      else room.players[id].alive = true;
    });

    ack?.({ ok: true });
    io.to(roomCode).emit("game:restarted");
    io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
  });

  socket.on("disconnect", () => {
    const { role, roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    if (role === "player" && room.players[socket.id]) {
      // No lo borramos: queda "congelado" (marcado como desconectado)
      // en vez de eliminarse, tal como quedó resuelto en el GDD.
      room.players[socket.id].connected = false;
      io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
    }

    if (role === "screen") {
      // Si se cae la pantalla, por ahora solo lo logueamos.
      // Fase de juego: decidir si la partida se recupera o se cierra la sala.
      console.log(`Pantalla desconectada de la sala ${roomCode}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`La Mafia (esqueleto) escuchando en http://localhost:${PORT}`);
  console.log(`Pantalla:  http://localhost:${PORT}/screen.html`);
  console.log(`Celular:   http://localhost:${PORT}/player.html`);
});
