// games/mafia/logic.js
// Toda la lógica de juego pura de La Mafia: ciclo Noche, ciclo Día, muerte
// (incluida la venganza del Cazador y la transformación del Lycan),
// condición de victoria, y los tres hooks del contrato de plugin que
// necesitan conocer esos mecanismos (onReconnect, remapPlayerId, onKick).
// Nada acá sabe de Express, Socket.IO como transporte genérico, ni del
// registry — solo recibe `io`/`room`/`roomCode` ya resueltos y hace lo que
// corresponda. server.js NO vive acá: esto se mueve tal cual desde ahí (ver
// plan de migración, paso 9).

const { pushHistory } = require("../../platform/core/rooms");
const { startTimer } = require("../../platform/core/timer");
const { getMafiaAccomplices } = require("./roles");

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
  // El silencio del Carnicero se calcula ANTES de pisar room.gameState.night
  // (todavía es la de la noche que recién terminó) y dura un solo Día: se
  // recalcula de cero cada vez que se llama a esta función.
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
// juicio) — su peso se lee en vivo de room.gameState.assignment, no hay que
// guardarlo aparte por voto.
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

module.exports = {
  getAliveIds,
  getActiveIds,
  playerBrief,
  aliveTargets,
  pickLeader,
  broadcastMafiaSuggestions,
  startTimer,
  startNight,
  allNightActionsSubmitted,
  maybeShortenNight,
  killPlayer,
  applyLycanTransformSideEffects,
  checkWinner,
  buildFinalRoster,
  resolveNight,
  startDiscussion,
  startVoting,
  broadcastVotingProgress,
  maybeResolveVoting,
  voteWeight,
  tallyVotes,
  resolveVoting,
  startDefense,
  startTrial,
  maybeResolveTrial,
  resolveTrial,
  mafiaRemapPlayerId,
  mafiaOnReconnect,
  mafiaOnKick,
};
