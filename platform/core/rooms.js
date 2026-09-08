// platform/core/rooms.js
// Estado de salas en memoria + utilidades genéricas para manipularlo. 100%
// agnóstico de juego: no sabe nada de Mafia ni de ningún otro plugin —
// cualquier juego que corra sobre esta plataforma comparte este mismo mapa
// de salas y estas mismas funciones de bajo nivel.

const { randomUUID } = require("crypto");

// --- Estado en memoria (alcanza para el esqueleto; en un server real
//     esto podría vivir en Redis si hay más de un proceso) ---
// rooms[code] = { screenSocketId, gameId, players: { socketId: { name, connected } }, ... }
const rooms = {};

// Agrega un elemento a una lista tope (chat/historial) descartando lo más
// viejo cuando se pasa del límite — evita que una sala muy larga acumule
// memoria sin límite.
function capPush(list, item, max = 200) {
  list.push(item);
  if (list.length > max) list.shift();
}

// Historial público de la partida: registra solo lo que ya se anuncia en
// pantalla, para que se pueda repasar más tarde.
function pushHistory(io, room, roomCode, icon, text) {
  const entry = { id: randomUUID(), ts: Date.now(), icon, text };
  capPush(room.history, entry);
  io.to(roomCode).emit("history:entry", entry);
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin O/0/I/1 para evitar confusión
function generateRoomCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");
  } while (rooms[code]); // evita colisiones
  return code;
}

function publicPlayerList(room) {
  return Object.values(room.players).map((p) => ({
    name: p.name,
    connected: p.connected,
    icon: p.icon,
  }));
}

module.exports = {
  rooms,
  capPush,
  pushHistory,
  generateRoomCode,
  publicPlayerList,
};
