// server.js
// Esqueleto técnico de "La Mafia": la pantalla compartida crea una sala,
// los celulares se unen escaneando un código, y todo se sincroniza por
// WebSockets (Socket.IO) contra este servidor autoritativo.
//
// Esto NO incluye todavía la lógica del juego (roles, Día/Noche, votos).
// Es a propósito: primero se valida que el "esqueleto" pantalla<->celular
// funcione de punta a punta, y recién después se le agrega el juego encima
// (ver GDD sección 6).

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { assignRoles, getMafiaAccomplices } = require("./roles");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// --- Estado en memoria (alcanza para el esqueleto; en un server real
//     esto podría vivir en Redis si hay más de un proceso) ---
// rooms[code] = { screenSocketId, players: { socketId: { name, connected } } }
const rooms = {};

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
  }));
}

io.on("connection", (socket) => {
  // --- La pantalla compartida crea una sala nueva ---
  socket.on("screen:create", () => {
    const code = generateRoomCode();
    rooms[code] = { screenSocketId: socket.id, players: {} };
    socket.join(code);
    socket.data.role = "screen";
    socket.data.roomCode = code;
    socket.emit("screen:created", { code });
  });

  // --- Un celular se une a una sala existente ---
  socket.on("player:join", ({ code, name }, ack) => {
    const room = rooms[code];
    if (!room) {
      ack?.({ ok: false, error: "Esa sala no existe. Revisá el código." });
      return;
    }
    const cleanName = (name || "").trim().slice(0, 20) || "Jugador";

    room.players[socket.id] = { name: cleanName, connected: true };
    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;

    ack?.({ ok: true, code, name: cleanName });

    // Avisa a la pantalla (y a los demás celulares) la lista actualizada
    io.to(code).emit("lobby:update", { players: publicPlayerList(room) });
  });

  // --- La pantalla arranca la partida: se sortean y reparten los roles ---
  socket.on("game:start", (_data, ack) => {
    const { role, roomCode } = socket.data;
    const room = rooms[roomCode];

    if (!room) {
      ack?.({ ok: false, error: "La sala ya no existe." });
      return;
    }
    if (role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede empezar la partida." });
      return;
    }

    const connectedIds = Object.entries(room.players)
      .filter(([, p]) => p.connected)
      .map(([id]) => id);

    if (connectedIds.length < 6 || connectedIds.length > 10) {
      ack?.({
        ok: false,
        error: `Se necesitan entre 6 y 10 jugadores conectados (hay ${connectedIds.length}).`,
      });
      return;
    }

    const assignment = assignRoles(connectedIds);
    room.assignment = assignment; // queda guardado para las fases de Noche/Día
    room.started = true;

    const playerNames = {};
    connectedIds.forEach((id) => {
      playerNames[id] = room.players[id].name;
    });

    connectedIds.forEach((id) => {
      const r = assignment[id];
      const payload = {
        roleId: r.roleId,
        name: r.name,
        narrativeName: r.narrativeName,
        team: r.team,
        description: r.description,
      };
      if (r.team === "mafia") {
        payload.accomplices = getMafiaAccomplices(assignment, id, playerNames);
      }
      io.to(id).emit("role:assigned", payload);
    });

    ack?.({ ok: true });
    io.to(roomCode).emit("game:started", { playerCount: connectedIds.length });
  });

  // --- Reconexión: RESUELTO en el GDD como "rol congelado hasta que vuelve" ---
  socket.on("player:rejoin", ({ code, name }, ack) => {
    const room = rooms[code];
    if (!room) {
      ack?.({ ok: false, error: "Esa sala ya no existe." });
      return;
    }
    // TODO (fase de juego): en vez de crear un jugador nuevo, esto debería
    // reasignar el socket al jugador "congelado" que coincide por nombre/token
    // de sesión, sin perder su rol ni su estado. Para el esqueleto de lobby
    // alcanza con reutilizar el mismo flujo que player:join.
    socket.emit("player:join", { code, name });
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const { role, roomCode } = socket.data;
    if (!roomCode || !rooms[roomCode]) return;
    const room = rooms[roomCode];

    if (role === "player" && room.players[socket.id]) {
      // No lo borramos: queda "congelado" (marcado como desconectado)
      // en vez de eliminarse, tal como quedó resuelto en el GDD.
      room.players[socket.id].connected = false;
      io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
    }

    if (role === "screen") {
      // Si se cae la pantalla, por ahora solo lo logueamos.
      // Fase de juego: decidir si la partida se recupera o se cierra la sala.
      console.log(`Pantalla desconectada de la sala ${roomCode}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`La Mafia (esqueleto) escuchando en http://localhost:${PORT}`);
  console.log(`Pantalla:  http://localhost:${PORT}/screen.html`);
  console.log(`Celular:   http://localhost:${PORT}/player.html`);
});
