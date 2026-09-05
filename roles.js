// roles.js
// Catálogo MVP confirmado en el GDD (sección 6.1) + reskin narrativo (sección 3.1).
//
// Nota: "Aldeano" es un rol de relleno sin habilidad que NO estaba en el listado
// original que subiste — hacía falta agregarlo para poder completar el bando
// Ciudad en partidas de 7-10 jugadores, ya que el MVP solo tiene 3 roles Ciudad
// con habilidad (Detective, Médico, Cazador). Es el "jugador de a pie" clásico
// del género Mafia/Hombre Lobo.

const ROLE_INFO = {
  padrino: {
    name: "Padrino",
    narrativeName: "Lobo Alfa",
    icon: "🐺",
    team: "mafia",
    hasNightAction: true,
    description: "Líder de la mafia. El Detective/Vidente lo ve como inocente si lo investiga.",
    tip: "Padrino: el Detective te ve como inocente si te investiga — usá esa ventaja para no levantar sospechas.",
  },
  mafioso: {
    name: "Mafioso",
    narrativeName: "Hombre Lobo",
    icon: "🐾",
    team: "mafia",
    hasNightAction: true,
    description: "Miembro de la mafia. Participa en la elección nocturna de la víctima.",
    tip: "Mafioso: tu sugerencia en la reunión nocturna no es definitiva — el líder de turno decide la víctima final.",
  },
  detective: {
    name: "Detective",
    narrativeName: "Vidente",
    icon: "🔮",
    team: "ciudad",
    hasNightAction: true,
    description: "De noche, investigás a un jugador para saber si es de la mafia.",
    tip: "Detective: guardate el resultado de tus investigaciones para el momento justo — revelarlo muy pronto te convierte en el próximo blanco de la Mafia.",
  },
  medico: {
    name: "Médico",
    narrativeName: "Curandero/a",
    icon: "💊",
    team: "ciudad",
    hasNightAction: true,
    description: "De noche, elegís a alguien para protegerlo de un ataque.",
    tip: "Médico: no protejas siempre al mismo jugador — si la Mafia te descubre el patrón, dejás de salvar a nadie.",
  },
  cazador: {
    name: "Cazador",
    narrativeName: "Cazador",
    icon: "🏹",
    team: "ciudad",
    hasNightAction: false, // se dispara al morir, no es una acción nocturna proactiva
    description: "Si te matan, disparás automáticamente a otro jugador al azar.",
    tip: "Cazador: cuidado con eliminar a este sujeto, siempre arrastra a alguien con él.",
  },
  aldeano: {
    name: "Aldeano",
    narrativeName: "Aldeano",
    icon: "🌾",
    team: "ciudad",
    hasNightAction: false,
    description: "Sin habilidad especial. Tu arma es tu voto y tu palabra durante el Día.",
    tip: "Aldeano: no tenés poder especial, pero tu palabra y tu voto durante el Día valen tanto como cualquier otro.",
  },
  bufon: {
    name: "Bufón",
    narrativeName: "Bufón",
    icon: "🃏",
    team: "independiente",
    hasNightAction: false,
    description: "Ganás vos solo si el pueblo te vota y te expulsa durante el Día.",
    tip: "Bufón: no jugás para la Mafia ni para la Ciudad — tu única forma de ganar es lograr que el pueblo te vote y te expulse.",
  },
};

// Escalado de roles por cantidad de jugadores (GDD sección 6, corregido acá para
// reservarle un lugar fijo al Bufón como Independiente — la tabla original del
// documento no restaba ese lugar del total, lo cual quedó desactualizado desde
// que agregamos la facción Independiente).
const SCALING = {
  6: { padrino: 1, mafioso: 1, detective: 1, medico: 1, cazador: 1, aldeano: 0, bufon: 1 },
  7: { padrino: 1, mafioso: 1, detective: 1, medico: 1, cazador: 1, aldeano: 1, bufon: 1 },
  8: { padrino: 1, mafioso: 1, detective: 1, medico: 1, cazador: 1, aldeano: 2, bufon: 1 },
  9: { padrino: 1, mafioso: 2, detective: 1, medico: 1, cazador: 1, aldeano: 2, bufon: 1 },
  10: { padrino: 1, mafioso: 2, detective: 1, medico: 1, cazador: 1, aldeano: 3, bufon: 1 },
};

function buildRoleDeck(playerCount) {
  const table = SCALING[playerCount];
  if (!table) {
    throw new Error(
      `No hay escalado de roles definido para ${playerCount} jugadores (se soportan 6 a 10).`
    );
  }
  const deck = [];
  for (const [roleId, count] of Object.entries(table)) {
    for (let i = 0; i < count; i++) deck.push(roleId);
  }
  return deck;
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * @param {string[]} playerIds - socket.id de los jugadores conectados
 * @returns {Object.<string, object>} socket.id -> { roleId, name, narrativeName, team, ... }
 */
function assignRoles(playerIds) {
  const deck = shuffle(buildRoleDeck(playerIds.length));
  const assignment = {};
  playerIds.forEach((id, i) => {
    const roleId = deck[i];
    assignment[id] = { roleId, ...ROLE_INFO[roleId] };
  });
  return assignment;
}

// Para que todos vean qué roles están en juego esta partida (sin revelar
// quién tiene cada uno) — se muestra en la pantalla compartida al repartir.
function getRolesInPlay(playerCount) {
  const table = SCALING[playerCount];
  if (!table) return [];
  return Object.entries(table)
    .filter(([, count]) => count > 0)
    .map(([roleId, count]) => ({ roleId, count, ...ROLE_INFO[roleId] }));
}

// Los mafiosos se conocen entre sí (GDD sección 6, Fase 0).
function getMafiaAccomplices(assignment, selfSocketId, playerNames) {
  return Object.entries(assignment)
    .filter(([id, r]) => id !== selfSocketId && r.team === "mafia")
    .map(([id]) => playerNames[id]);
}

module.exports = {
  ROLE_INFO,
  SCALING,
  buildRoleDeck,
  assignRoles,
  getMafiaAccomplices,
  getRolesInPlay,
};
