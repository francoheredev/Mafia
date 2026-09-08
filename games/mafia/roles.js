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
  bruja: {
    name: "Bruja",
    narrativeName: "Bruja",
    icon: "🧙‍♀️",
    team: "mafia",
    hasNightAction: true,
    mafiaPower: "reveal", // además del voto colectivo, tiene un poder nocturno propio
    description: "Miembro de la mafia. Además de participar en la elección de la víctima, de noche podés señalar a un jugador para que toda la Mafia sepa exactamente qué rol tiene.",
    tip: "Bruja: usá tu visión para detectar amenazas como el Detective o el Médico antes de que se conviertan en un problema.",
  },
  carnicero: {
    name: "Carnicero",
    narrativeName: "Carnicero",
    icon: "🔪",
    team: "mafia",
    hasNightAction: true,
    mafiaPower: "silence", // además del voto colectivo, tiene un poder nocturno propio
    description: "Miembro de la mafia. Además de participar en la elección de la víctima, de noche podés silenciar a un jugador: no podrá votar en la acusación del Día siguiente.",
    tip: "Carnicero: silenciá a quien creas que puede armar un caso sólido contra la Mafia justo antes de que amanezca.",
  },
  intendente: {
    name: "Intendente",
    narrativeName: "Intendente",
    icon: "🎖️",
    team: "ciudad",
    hasNightAction: false,
    voteWeight: 2, // su voto vale doble en la acusación y en el juicio
    description: "Sin habilidad nocturna, pero tu voto vale doble tanto en la acusación como en el juicio.",
    tip: "Intendente: tu palabra pesa el doble — elegí con cuidado a quién apoyás.",
  },
  lycan: {
    name: "Lycan",
    narrativeName: "Lycan",
    icon: "🐕",
    team: "ciudad", // hasta que sobreviva a un intento de asesinato — ver killPlayer en server.js
    hasNightAction: false,
    description: "Parecés un aldeano común... hasta que alguien intenta matarte. La primera vez que eso pase, sobrevivís — y desde ese momento jugás para la Mafia.",
    tip: "Lycan: no tenés voto especial ni acción nocturna. Tu arma es sobrevivir al primer golpe que te den.",
  },
  amante: {
    name: "Amante",
    narrativeName: "Amante",
    icon: "💞",
    team: "ciudad",
    hasNightAction: false,
    description: "Sin habilidad especial, como el Aldeano — pero conocés en secreto la identidad de tu Amante: el otro jugador con este mismo rol.",
    tip: "Amante: no tenés poder ni voto especial. Tu única ventaja es saber quién es tu Amante — cuídense mutuamente durante las votaciones.",
  },
};

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
