// rules.js
// Explicación general de la dinámica del juego, para el tutorial que se
// muestra al arrancar la partida (y queda disponible para consultar
// después, tanto en el celular como en la pantalla). Separado de roles.js
// porque esto es contenido de reglas generales, no datos de un rol puntual.
//
// Acá solo vive el orden y el ícono de cada sección: el título y el texto
// salen del catálogo de traducciones (claves rules.<id>.title/.text en
// public/locales/es.json), así cada cliente los muestra en su idioma.

const { t } = require("../../platform/core/i18n");

const GENERAL_RULES = [
  { id: "objective", icon: "🎯" },
  { id: "night", icon: "🌙" },
  { id: "discussion", icon: "💬" },
  { id: "voting", icon: "🗳️" },
  { id: "secret", icon: "🤫" },
].map((section) => ({
  ...section,
  titleKey: `rules.${section.id}.title`,
  textKey: `rules.${section.id}.text`,
  title: t(`rules.${section.id}.title`),
  text: t(`rules.${section.id}.text`),
}));

module.exports = { GENERAL_RULES };
