// games/index.js
// Único punto que crece con cada juego nuevo: requerir su plugin.js (que se
// auto-registra en el registry por su efecto secundario al cargar) alcanza
// para sumarlo a la plataforma. Nada bajo platform/ necesita tocarse para
// agregar un juego más acá.
require("./mafia/plugin");
