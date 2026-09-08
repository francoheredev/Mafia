// rules.js
// Explicación general de la dinámica del juego, para el tutorial que se
// muestra al arrancar la partida (y queda disponible para consultar
// después, tanto en el celular como en la pantalla). Separado de roles.js
// porque esto es contenido de reglas generales, no datos de un rol puntual.

const GENERAL_RULES = [
  {
    icon: "🎯",
    title: "El objetivo",
    text: "La Mafia gana si sus miembros igualan o superan en número al resto. La Ciudad gana si logra eliminar a toda la Mafia antes de que eso pase.",
  },
  {
    icon: "🌙",
    title: "De noche",
    text: "La Mafia elige en secreto a quién eliminar. El Detective investiga a alguien para saber si es de la Mafia. El Médico protege a alguien de un ataque. Todos los demás solo esperan.",
  },
  {
    icon: "💬",
    title: "Discusión",
    text: "Al amanecer, todo el pueblo discute en voz alta quién le parece sospechoso — sin turnos, mirando la pantalla compartida.",
  },
  {
    icon: "🗳️",
    title: "Votación y juicio",
    text: "Cada uno vota (o se abstiene) a quién acusar. Si hay empate entre los más votados, se sortea entre ellos — no se salva nadie por empatar. El más votado (o el sorteado) se defiende, y después el resto decide con un veredicto de culpable o inocente si lo expulsa.",
  },
  {
    icon: "🤫",
    title: "El secreto de la muerte",
    text: "Cuando alguien muere o es expulsado, el sistema nunca revela su rol ni la causa — eso se descubre (o no) discutiendo entre todos.",
  },
];

module.exports = { GENERAL_RULES };
