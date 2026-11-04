// roles.js
// Catálogo MVP confirmado en el GDD (sección 6.1) + reskin narrativo (sección 3.1).
//
// Nota: "Aldeano" es un rol de relleno sin habilidad que NO estaba en el listado
// original que subiste — hacía falta agregarlo para poder completar el bando
// Ciudad en partidas de 7-10 jugadores, ya que el MVP solo tiene 3 roles Ciudad
// con habilidad (Detective, Médico, Cazador). Es el "jugador de a pie" clásico
// del género Mafia/Hombre Lobo.

const { t } = require("../../platform/core/i18n");

const ROLE_INFO = {
  padrino: {
    icon: "🐺",
    team: "mafia",
    hasNightAction: true,
  },
  mafioso: {
    icon: "🐾",
    team: "mafia",
    hasNightAction: true,
  },
  detective: {
    icon: "🔮",
    team: "ciudad",
    hasNightAction: true,
  },
  medico: {
    icon: "💊",
    team: "ciudad",
    hasNightAction: true,
  },
  cazador: {
    icon: "🏹",
    team: "ciudad",
    hasNightAction: false, // se dispara al morir, no es una acción nocturna proactiva
  },
  aldeano: {
    icon: "🌾",
    team: "ciudad",
    hasNightAction: false,
  },
  bufon: {
    icon: "🃏",
    team: "independiente",
    hasNightAction: false,
  },
  bruja: {
    icon: "🧙‍♀️",
    team: "mafia",
    hasNightAction: true,
    mafiaPower: "reveal", // además del voto colectivo, tiene un poder nocturno propio
  },
  carnicero: {
    icon: "🔪",
    team: "mafia",
    hasNightAction: true,
    mafiaPower: "silence", // además del voto colectivo, tiene un poder nocturno propio
  },
  intendente: {
    icon: "🎖️",
    team: "ciudad",
    hasNightAction: false,
    voteWeight: 2, // su voto vale doble en la acusación y en el juicio
  },
  lycan: {
    icon: "🐕",
    team: "ciudad", // hasta que sobreviva a un intento de asesinato — ver killPlayer en games/mafia/logic.js
    hasNightAction: false,
  },
  amante: {
    icon: "💞",
    team: "ciudad",
    hasNightAction: false,
  },
};

// Los textos de cada rol (nombre, nombre narrativo, descripción y consejo)
// no se escriben acá: salen del catálogo de traducciones (claves
// roles.<id>.<campo> en public/locales/es.json). El servidor los guarda en
// español como respaldo; cada cliente los muestra en su idioma por roleId.
const ROLE_TEXT_FIELDS = ["name", "narrativeName", "description", "tip"];
Object.entries(ROLE_INFO).forEach(([roleId, info]) => {
  ROLE_TEXT_FIELDS.forEach((field) => {
    info[field] = t(`roles.${roleId}.${field}`);
  });
});

// Amante es un rol propio (ver ROLE_INFO.amante) — nunca se superpone con
// otro rol. Solo puede salir a partir de esta cantidad de jugadores, para no
// sumarle más complejidad social a las salas más chicas.
const LOVERS_MIN_PLAYERS = 8;

// Y ni siquiera ahí sale siempre: Intendente y Lycan (la "flavorización" de
// lo que originalmente eran 2 Aldeanos de relleno a 8 jugadores — ver el
// comentario de SCALING más abajo) ceden su lugar a los 2 Amantes, así que
// si saliera en TODAS las partidas de 8+, esos 2 roles dejarían de existir
// para siempre en el juego. En cambio, cada partida de 8+ tiene esta chance
// de salir con Amantes (reemplazando a Intendente + Lycan esa vez) — el
// resto de las veces, la partida reparte su tabla normal sin tocar nada.
const LOVERS_CHANCE = 0.5;

// Escalado de roles por cantidad de jugadores (GDD sección 6, corregido acá para
// reservarle un lugar fijo al Bufón como Independiente — la tabla original del
// documento no restaba ese lugar del total, lo cual quedó desactualizado desde
// que agregamos la facción Independiente).
//
// A partir de acá, cada tramo reparte el MISMO total de Mafia/Ciudad/Indep. que
// tenía la tabla original a esa cantidad de jugadores — solo se "reskinean"
// roles de relleno (aldeanos extra, el 2º mafioso) en los roles nuevos a medida
// que crece el grupo, para sumar variedad sin inflar el poder de ningún bando:
//  - 7p: el único aldeano pasa a ser Intendente (mafia=2, ciudad=4, indep=1).
//  - 8p: los 2 aldeanos pasan a ser Intendente + Lycan (mafia=2, ciudad=5, indep=1).
//  - 9p: el 2º mafioso pasa a ser Bruja (mafia=3, ciudad=5, indep=1).
//  - 10p: ya no queda "mafioso" genérico — Bruja + Carnicero + Padrino ya dan
//    mafia=3 (igual que el padrino+mafioso×2 original); dejar además un
//    mafioso ahí sumaría una 4ta mafia, más de lo que el reparto original le
//    daba a 10 jugadores (ciudad=6 con 1 aldeano de relleno, indep=1).
//
// A 8+ jugadores, esta tabla es la base "sin Amantes" — ver
// maybeApplyLovers más abajo, que a veces reemplaza Intendente + Lycan por
// 2 Amantes sin tocar el total de Ciudad.
const SCALING = {
  6: { padrino: 1, mafioso: 1, detective: 1, medico: 1, cazador: 1, aldeano: 0, bufon: 1 },
  7: { padrino: 1, mafioso: 1, detective: 1, medico: 1, cazador: 1, intendente: 1, aldeano: 0, bufon: 1 },
  8: { padrino: 1, mafioso: 1, detective: 1, medico: 1, cazador: 1, intendente: 1, lycan: 1, aldeano: 0, bufon: 1 },
  9: { padrino: 1, mafioso: 1, bruja: 1, detective: 1, medico: 1, cazador: 1, intendente: 1, lycan: 1, aldeano: 0, bufon: 1 },
  10: { padrino: 1, bruja: 1, carnicero: 1, detective: 1, medico: 1, cazador: 1, intendente: 1, lycan: 1, aldeano: 1, bufon: 1 },
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

// Si corresponde (ver LOVERS_MIN_PLAYERS/LOVERS_CHANCE), reemplaza en el deck
// — antes de barajarlo — los lugares de Intendente y Lycan por 2 Amantes.
function maybeApplyLovers(deck) {
  if (deck.length < LOVERS_MIN_PLAYERS) return deck;
  if (Math.random() >= LOVERS_CHANCE) return deck;
  const intendenteIdx = deck.indexOf("intendente");
  const lycanIdx = deck.indexOf("lycan");
  if (intendenteIdx === -1 || lycanIdx === -1) return deck;
  const next = [...deck];
  next[intendenteIdx] = "amante";
  next[lycanIdx] = "amante";
  return next;
}

/**
 * @param {string[]} playerIds - socket.id de los jugadores conectados
 * @returns {Object.<string, object>} socket.id -> { roleId, name, narrativeName, team, ... }
 */
function assignRoles(playerIds) {
  const deck = shuffle(maybeApplyLovers(buildRoleDeck(playerIds.length)));
  const assignment = {};
  playerIds.forEach((id, i) => {
    const roleId = deck[i];
    assignment[id] = { roleId, ...ROLE_INFO[roleId] };
  });
  return assignment;
}

// Para que todos vean qué roles están en juego esta partida (sin revelar
// quién tiene cada uno) — se muestra en la pantalla compartida al repartir.
// Se deriva del assignment real (no de SCALING) para reflejar correctamente
// partidas donde salieron Amantes en vez de Intendente + Lycan.
function getRolesInPlay(assignment) {
  const counts = {};
  Object.values(assignment).forEach((r) => {
    counts[r.roleId] = (counts[r.roleId] || 0) + 1;
  });
  return Object.entries(counts).map(([roleId, count]) => ({ roleId, count, ...ROLE_INFO[roleId] }));
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
  LOVERS_MIN_PLAYERS,
  buildRoleDeck,
  assignRoles,
  getMafiaAccomplices,
  getRolesInPlay,
};
