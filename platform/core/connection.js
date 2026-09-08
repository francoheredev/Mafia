// platform/core/connection.js
// Despacho genérico de los eventos "custom" que cada plugin declara en
// `socketHandlers` (ver contrato de plugin). La plataforma no sabe qué
// significa "night:action" o cualquier otro nombre de evento — solo sabe
// que, para el socket que lo mandó, hay que mirar en qué sala está
// (`socket.data.roomCode`), de qué juego es esa sala (`room.gameId`) y
// buscar el handler correspondiente en el registry.
//
// El aislamiento entre juegos concurrentes en el mismo `io` no viene de un
// namespace de socket.io ni de un prefijo literal en el nombre del evento:
// viene de que el despacho SIEMPRE resuelve el handler a través de
// room.gameId en el momento de la llamada. Dos plugins pueden declarar el
// mismo nombre de evento (ej. los dos usan "start") sin pisarse nunca,
// porque cada socket solo puede disparar el handler del plugin dueño de la
// sala en la que está en ese momento.
const { rooms } = require("./rooms");
const { getGame, listGames } = require("./registry");

// Unión de todos los nombres de evento custom que declaró CUALQUIER plugin
// registrado — se recalcula en cada conexión porque es barato y así no hay
// que preocuparse por el orden entre registerGame(...) y el primer socket
// que se conecta.
function collectCustomEventNames() {
  const names = new Set();
  listGames().forEach((plugin) => {
    Object.keys(plugin.socketHandlers || {}).forEach((name) => names.add(name));
  });
  return names;
}

// Engancha, sobre un socket recién conectado, un socket.on(...) genérico por
// cada evento custom declarado por algún plugin. Se llama una sola vez por
// conexión, desde el io.on("connection") de la plataforma.
function attachPluginEvents(io, socket) {
  collectCustomEventNames().forEach((eventName) => {
    socket.on(eventName, (data, ack) => {
      const { roomCode } = socket.data;
      const room = roomCode && rooms[roomCode];
      if (!room) {
        ack?.({ ok: false, error: "La sala ya no existe." });
        return;
      }
      const plugin = getGame(room.gameId);
      const handler = plugin?.socketHandlers?.[eventName];
      if (!handler) {
        ack?.({ ok: false, error: "Evento no soportado en este juego." });
        return;
      }
      handler({ io, socket, room, roomCode }, data, ack);
    });
  });
}

module.exports = { attachPluginEvents };
