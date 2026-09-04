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
const { assignRoles, getMafiaAccomplices, getRolesInPlay } = require("./roles");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// --- Estado en memoria (alcanza para el esqueleto; en un server real
//     esto podría vivir en Redis si hay más de un proceso) ---
// rooms[code] = { screenSocketId, players: { socketId: { name, connected } } }
const rooms = {};

// Si nadie manda su acción nocturna a tiempo (AFK, wifi caído), la noche
// se resuelve igual con lo que sí llegó a tiempo.
const NIGHT_TIMEOUT_MS = 60000;

// Tiempo para que todos lean su rol (celular) y el catálogo de roles en
// juego (pantalla) antes de que arranque la primera noche.
const ROLE_REVEAL_MS = 10000;

// Cada jugador recibe uno de estos como avatar al unirse (ambientación de
// aldea de fantasía — ver GDD sección 3.1). Se intenta no repetir dentro
// de una misma sala mientras haya opciones disponibles.
const PLAYER_ICONS = [
  "🦊", "🐻", "🦉", "🦌", "🦔", "🐿️", "🦇", "🐗", "🦅", "🐢",
  "🦆", "🐸", "🦋", "🐝", "🦎", "🐍", "🦂", "🐌", "🦡", "🐇",
  "🦃", "🦩", "🦚", "🦜", "🐦", "🦢", "🐴", "🐐", "🐑", "🐖",
];
function pickIcon(room) {
  const used = new Set(Object.values(room.players).map((p) => p.icon));
  const available = PLAYER_ICONS.filter((i) => !used.has(i));
  const pool = available.length > 0 ? available : PLAYER_ICONS;
  return pool[Math.floor(Math.random() * pool.length)];
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

function getAliveIds(room) {
  return Object.keys(room.players).filter((id) => room.players[id].alive);
}

function hasAliveRole(room, roleId) {
  return Object.entries(room.players).some(
    ([id, p]) => p.alive && room.assignment[id]?.roleId === roleId
  );
}

function findAliveIdByRole(room, roleId) {
  const entry = Object.entries(room.players).find(
    ([id, p]) => p.alive && room.assignment[id]?.roleId === roleId
  );
  return entry?.[0] || null;
}

// La Mafia rota quién de ellos decide la víctima cada noche.
function pickLeader(room) {
  const order = (room.mafiaOrder || []).filter((id) => room.players[id]?.alive);
  if (order.length === 0) return null;
  const idx = (room.night.number - 1) % order.length;
  return order[idx];
}

function broadcastNightProgress(io, room, roomCode) {
  const actedIds = [];
  if (room.night.mafiaSubmitted && room.night.leaderId) actedIds.push(room.night.leaderId);
  if (room.night.detectiveSubmitted) {
    const id = findAliveIdByRole(room, "detective");
    if (id) actedIds.push(id);
  }
  if (room.night.medicoSubmitted) {
    const id = findAliveIdByRole(room, "medico");
    if (id) actedIds.push(id);
  }

  io.to(roomCode).emit("night:progress", {
    mafiaDone: room.night.mafiaSubmitted || !room.night.leaderId,
    detectiveDone: room.night.detectiveSubmitted || !hasAliveRole(room, "detective"),
    medicoDone: room.night.medicoSubmitted || !hasAliveRole(room, "medico"),
    actedIds,
  });
}

function startNight(io, room, roomCode) {
  const number = (room.night?.number || 0) + 1;
  room.phase = "night";
  room.night = {
    number,
    leaderId: null,
    mafiaTargetId: null,
    mafiaSubmitted: false,
    detectiveTargetId: null,
    detectiveSubmitted: false,
    medicoTargetId: null,
    medicoSubmitted: false,
  };
  room.night.leaderId = pickLeader(room);

  const aliveIds = getAliveIds(room);
  const targets = aliveIds.map((id) => ({
    id,
    name: room.players[id].name,
    icon: room.players[id].icon,
  }));

  io.to(roomCode).emit("night:begin", { number, players: targets, timeoutMs: NIGHT_TIMEOUT_MS });

  aliveIds.forEach((id) => {
    const r = room.assignment[id];
    if (!r) return;

    if (r.team === "mafia") {
      const isLeader = id === room.night.leaderId;
      io.to(id).emit("night:mafiaTurn", {
        isLeader,
        leaderName: room.players[room.night.leaderId]?.name,
        targets: targets.filter((t) => room.assignment[t.id]?.team !== "mafia"),
        timeoutMs: NIGHT_TIMEOUT_MS,
      });
    } else if (r.hasNightAction) {
      // Hoy son Detective (Vidente) o Médico — ver ROLE_INFO en roles.js.
      const roleTargets =
        r.roleId === "detective" ? targets.filter((t) => t.id !== id) : targets;
      io.to(id).emit("night:yourTurn", {
        role: r.roleId,
        targets: roleTargets,
        timeoutMs: NIGHT_TIMEOUT_MS,
      });
    } else {
      io.to(id).emit("night:waiting", { timeoutMs: NIGHT_TIMEOUT_MS });
    }
  });

  broadcastNightProgress(io, room, roomCode);

  clearTimeout(room.night.timer);
  room.night.timer = setTimeout(() => resolveNight(io, room, roomCode), NIGHT_TIMEOUT_MS);
}

function maybeResolveNight(io, room, roomCode) {
  const mafiaReady = room.night.mafiaSubmitted || !room.night.leaderId;
  const detectiveReady = room.night.detectiveSubmitted || !hasAliveRole(room, "detective");
  const medicoReady = room.night.medicoSubmitted || !hasAliveRole(room, "medico");
  if (mafiaReady && detectiveReady && medicoReady) {
    resolveNight(io, room, roomCode);
  }
}

// Si matan al Cazador, dispara al azar contra otro jugador vivo (GDD: habilidad al morir).
function killPlayer(room, id, deaths) {
  if (!room.players[id]?.alive) return;
  room.players[id].alive = false;
  deaths.push(id);

  if (room.assignment[id]?.roleId === "cazador") {
    const aliveOthers = Object.keys(room.players).filter(
      (pid) => pid !== id && room.players[pid].alive
    );
    if (aliveOthers.length > 0) {
      const revengeId = aliveOthers[Math.floor(Math.random() * aliveOthers.length)];
      killPlayer(room, revengeId, deaths);
    }
  }
}

function resolveNight(io, room, roomCode) {
  if (room.phase !== "night") return; // ya se resolvió (evita doble resolución con el timeout)
  clearTimeout(room.night.timer);
  room.phase = "dawn";

  const victimId = room.night.mafiaTargetId;
  const saved = Boolean(victimId && victimId === room.night.medicoTargetId);

  const deaths = [];
  if (victimId && !saved) killPlayer(room, victimId, deaths);

  io.to(roomCode).emit("night:resolved", {
    number: room.night.number,
    saved,
    // No se revela el rol de quien murió — solo que murió (ver GDD: eso
    // se discute/descubre durante el Día, no lo anuncia el sistema).
    deaths: deaths.map((id) => ({
      id,
      name: room.players[id].name,
      icon: room.players[id].icon,
    })),
  });
}

io.on("connection", (socket) => {
  // --- La pantalla compartida crea una sala nueva ---
  socket.on("screen:create", () => {
    const code = generateRoomCode();
    rooms[code] = { screenSocketId: socket.id, players: {}, phase: "lobby" };
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

    room.players[socket.id] = {
      name: cleanName,
      connected: true,
      alive: true,
      icon: pickIcon(room),
    };
    socket.join(code);
    socket.data.role = "player";
    socket.data.roomCode = code;

    ack?.({ ok: true, code, name: cleanName, icon: room.players[socket.id].icon });

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
    room.mafiaOrder = connectedIds.filter((id) => assignment[id].team === "mafia");
    connectedIds.forEach((id) => {
      room.players[id].alive = true;
    });

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
        icon: r.icon,
        revealMs: ROLE_REVEAL_MS,
      };
      if (r.team === "mafia") {
        payload.accomplices = getMafiaAccomplices(assignment, id, playerNames);
      }
      io.to(id).emit("role:assigned", payload);
    });

    ack?.({ ok: true });
    io.to(roomCode).emit("game:started", {
      playerCount: connectedIds.length,
      roles: getRolesInPlay(connectedIds.length),
      revealMs: ROLE_REVEAL_MS,
    });

    setTimeout(() => startNight(io, room, roomCode), ROLE_REVEAL_MS);
  });

  // --- Ciclo Noche: Mafia (líder rotativo), Vidente y Médico mandan su acción ---
  socket.on("night:action", ({ role, targetId }, ack) => {
    const { roomCode } = socket.data;
    const room = rooms[roomCode];
    if (!room || room.phase !== "night") {
      ack?.({ ok: false, error: "No es de noche." });
      return;
    }
    const myRole = room.assignment[socket.id];
    if (!myRole) {
      ack?.({ ok: false, error: "No tenés un rol asignado." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés actuar." });
      return;
    }
    const target = room.players[targetId];

    if (role === "mafia") {
      if (myRole.team !== "mafia") {
        ack?.({ ok: false, error: "No sos de la mafia." });
        return;
      }
      if (socket.id !== room.night.leaderId) {
        ack?.({ ok: false, error: "Esta noche no te toca decidir a vos." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      if (room.assignment[targetId]?.team === "mafia") {
        ack?.({ ok: false, error: "No podés elegir a un cómplice." });
        return;
      }
      room.night.mafiaTargetId = targetId;
      room.night.mafiaSubmitted = true;
    } else if (role === "detective") {
      if (myRole.roleId !== "detective") {
        ack?.({ ok: false, error: "No sos el Vidente." });
        return;
      }
      if (room.night.detectiveSubmitted) {
        ack?.({ ok: false, error: "Ya investigaste esta noche." });
        return;
      }
      if (!target?.alive || targetId === socket.id) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.night.detectiveTargetId = targetId;
      room.night.detectiveSubmitted = true;

      const targetRole = room.assignment[targetId];
      // Ajuste del GDD: el Padrino se ve como inocente si lo investigan.
      const isMafia = targetRole.team === "mafia" && targetRole.roleId !== "padrino";
      io.to(socket.id).emit("night:investigateResult", {
        targetName: target.name,
        isMafia,
      });
    } else if (role === "medico") {
      if (myRole.roleId !== "medico") {
        ack?.({ ok: false, error: "No sos el Médico." });
        return;
      }
      if (room.night.medicoSubmitted) {
        ack?.({ ok: false, error: "Ya elegiste a quién proteger." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.night.medicoTargetId = targetId;
      room.night.medicoSubmitted = true;
    } else {
      ack?.({ ok: false, error: "Acción desconocida." });
      return;
    }

    ack?.({ ok: true });
    broadcastNightProgress(io, room, roomCode);
    maybeResolveNight(io, room, roomCode);
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
