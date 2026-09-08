// games/index.js
// Único punto que crece con cada juego nuevo: requerir su plugin.js (que se
// auto-registra en el registry por su efecto secundario al cargar) alcanza
// para sumarlo a la plataforma. Nada bajo platform/ necesita tocarse para
// agregar un juego más acá.
require("./mafia/plugin");

// Plugin trivial, solo para que tests/platform/*.js pueda probar la
// plataforma (lobby, reconexión, kick, chat) sin depender de la lógica de
// Mafia — nunca se registra fuera de NODE_ENV=test.
if (process.env.NODE_ENV === "test") {
  require("./__test__/plugin");
}
