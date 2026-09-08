// games/mafia/plugin.js
// Punto de entrada del plugin de Mafia: junta la lógica pura (logic.js), el
// catálogo de roles/reglas (roles.js/rules.js) y arma el objeto que la
// plataforma necesita — socketHandlers para los eventos custom del juego,
// más los hooks del contrato de plugin (onReconnect, remapPlayerId, onKick,
// chatChannels, staticRoutes) — y lo registra con registerGame(...).
// server.js NUNCA importa nada de acá directamente: solo hace
// require("./games"), que a su vez requiere este archivo por su efecto
// secundario (el registerGame de más abajo).

const { registerGame } = require("../../platform/core/registry");
const { assignRoles, getMafiaAccomplices, getRolesInPlay, ROLE_INFO } = require("./roles");
const { GENERAL_RULES } = require("./rules");
const {
  startNight,
  startVoting,
  startTrial,
  startDiscussion,
  maybeShortenNight,
  broadcastMafiaSuggestions,
  broadcastVotingProgress,
  maybeResolveVoting,
  maybeResolveTrial,
  mafiaRemapPlayerId,
  mafiaOnReconnect,
  mafiaOnKick,
} = require("./logic");
const { pushHistory, publicPlayerList } = require("../../platform/core/rooms");

// --- Handlers custom de Mafia (game:start, game:restart, night:action,
//     night:mafiaSuggest, day:advance, day:vote, day:verdict), despachados
//     por platform/core/connection.js según room.gameId — ver contrato de
//     plugin. ctx = { io, socket, room, roomCode }.
const mafiaSocketHandlers = {
  // --- La pantalla arranca la partida: se sortean y reparten los roles ---
  "game:start": (ctx, _data, ack) => {
    const { io, socket, room, roomCode } = ctx;

    if (socket.data.role !== "screen") {
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
    room.gameState.assignment = assignment; // queda guardado para las fases de Noche/Día
    room.started = true;
    room.gameState.mafiaOrder = connectedIds.filter((id) => assignment[id].team === "mafia");
    // Amante es un rol propio (ver roles.js) — los Amantes de esta partida
    // son, directamente, quienes lo recibieron (0 o 2, nunca uno solo).
    room.gameState.loversIds = connectedIds.filter((id) => assignment[id].roleId === "amante");
    room.history = [];
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
      };
      if (r.team === "mafia") {
        payload.accomplices = getMafiaAccomplices(assignment, id, playerNames);
      }
      io.to(id).emit("role:assigned", payload);
    });

    if (room.gameState.loversIds.length === 2) {
      const [idA, idB] = room.gameState.loversIds;
      const loverPayload = (selfId, partnerId) => ({
        partner: {
          id: partnerId,
          name: room.players[partnerId].name,
          icon: room.players[partnerId].icon,
          roleId: assignment[partnerId].roleId,
          roleName: assignment[partnerId].name,
          narrativeName: assignment[partnerId].narrativeName,
          team: assignment[partnerId].team,
        },
      });
      io.to(idA).emit("role:loverInfo", loverPayload(idA, idB));
      io.to(idB).emit("role:loverInfo", loverPayload(idB, idA));
    }

    room.phase = "role-reveal";

    ack?.({ ok: true });
    io.to(roomCode).emit("game:started", {
      playerCount: connectedIds.length,
      roles: getRolesInPlay(assignment),
    });
    pushHistory(io, room, roomCode, "🎭", "Los roles fueron repartidos. Comienza la partida.");
  },

  // --- Ciclo Noche: Mafia (líder rotativo), Vidente y Médico mandan su acción ---
  "night:action": (ctx, { role, targetId }, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (room.phase !== "night") {
      ack?.({ ok: false, error: "No es de noche." });
      return;
    }
    const myRole = room.gameState.assignment[socket.id];
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
      if (socket.id !== room.gameState.night.leaderId) {
        ack?.({ ok: false, error: "Esta noche no te toca decidir a vos." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      if (room.gameState.assignment[targetId]?.team === "mafia") {
        ack?.({ ok: false, error: "No podés elegir a un cómplice." });
        return;
      }
      room.gameState.night.mafiaTargetId = targetId;
      room.gameState.night.mafiaSubmitted = true;
    } else if (role === "detective") {
      if (myRole.roleId !== "detective") {
        ack?.({ ok: false, error: "No sos el Vidente." });
        return;
      }
      if (room.gameState.night.detectiveSubmitted) {
        ack?.({ ok: false, error: "Ya investigaste esta noche." });
        return;
      }
      const targetRole = room.gameState.assignment[targetId];
      if (!target?.alive || !targetRole || targetId === socket.id) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.detectiveTargetId = targetId;
      room.gameState.night.detectiveSubmitted = true;

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
      if (room.gameState.night.medicoSubmitted) {
        ack?.({ ok: false, error: "Ya elegiste a quién proteger." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.medicoTargetId = targetId;
      room.gameState.night.medicoSubmitted = true;
    } else if (role === "bruja") {
      if (myRole.roleId !== "bruja") {
        ack?.({ ok: false, error: "No sos la Bruja." });
        return;
      }
      if (room.gameState.night.brujaSubmitted) {
        ack?.({ ok: false, error: "Ya usaste tu poder esta noche." });
        return;
      }
      const targetRole = room.gameState.assignment[targetId];
      if (!target?.alive || !targetRole) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.brujaTargetId = targetId;
      room.gameState.night.brujaSubmitted = true;

      // Revelación inmediata a TODO el equipo Mafia vivo y conectado (no
      // solo a la Bruja) — nunca a la sala entera, esto es información
      // secreta que jamás debe llegar a la pantalla ni a un no-mafioso.
      Object.keys(room.gameState.assignment)
        .filter(
          (id) => room.gameState.assignment[id]?.team === "mafia" && room.players[id]?.alive && room.players[id]?.connected
        )
        .forEach((id) =>
          io.to(id).emit("night:brujaReveal", {
            targetId,
            targetName: target.name,
            targetIcon: target.icon,
            roleId: targetRole.roleId,
            roleName: targetRole.name,
            narrativeName: targetRole.narrativeName,
            team: targetRole.team,
          })
        );
    } else if (role === "carnicero") {
      if (myRole.roleId !== "carnicero") {
        ack?.({ ok: false, error: "No sos el Carnicero." });
        return;
      }
      if (room.gameState.night.carniceroSubmitted) {
        ack?.({ ok: false, error: "Ya elegiste a quién silenciar." });
        return;
      }
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      room.gameState.night.carniceroTargetId = targetId;
      room.gameState.night.carniceroSubmitted = true;
      // El efecto (no poder votar) se aplica recién al Día siguiente — ver startDiscussion/startVoting.
    } else {
      ack?.({ ok: false, error: "Acción desconocida." });
      return;
    }

    ack?.({ ok: true });
    // Si con esta acción ya no queda nadie por decidir, se acorta la espera
    // restante (ver maybeShortenNight/NIGHT_EARLY_RESOLVE_MS) en vez de
    // esperar el NIGHT_TIMEOUT_MS completo.
    maybeShortenNight(io, room, roomCode);
  },

  // --- Sugerencia no vinculante de la Mafia (para ponerse de acuerdo antes
  //     de que el líder confirme la elección real; cualquier mafioso puede
  //     mandar la suya, no solo el líder) ---
  "night:mafiaSuggest": (ctx, { targetId }, ack) => {
    const { io, socket, room } = ctx;
    if (room.phase !== "night") {
      ack?.({ ok: false, error: "No es de noche." });
      return;
    }
    const myRole = room.gameState.assignment[socket.id];
    if (!myRole || myRole.team !== "mafia") {
      ack?.({ ok: false, error: "No sos de la mafia." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés actuar." });
      return;
    }
    if (targetId !== null) {
      const target = room.players[targetId];
      if (!target?.alive) {
        ack?.({ ok: false, error: "Objetivo inválido." });
        return;
      }
      if (room.gameState.assignment[targetId]?.team === "mafia") {
        ack?.({ ok: false, error: "No podés señalar a un cómplice." });
        return;
      }
    }
    room.gameState.night.mafiaSuggestions[socket.id] = targetId; // null = borra la sugerencia

    ack?.({ ok: true });
    broadcastMafiaSuggestions(io, room);
  },

  // --- La pantalla corta antes de tiempo una fase de discusión/defensa ---
  "day:advance": (ctx, _data, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede avanzar de fase." });
      return;
    }
    if (room.phase === "role-reveal") {
      // La pantalla terminó de narrar las reglas y los roles en juego.
      startNight(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "day-discussion") {
      startVoting(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "day-defense") {
      startTrial(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "dawn") {
      // La pantalla terminó de reproducir la narrativa del amanecer.
      clearTimeout(room.gameState.night.timer);
      startDiscussion(io, room, roomCode);
      ack?.({ ok: true });
    } else if (room.phase === "day-resolved") {
      // La pantalla terminó de reproducir la narrativa del veredicto (o de
      // "nadie fue acusado").
      clearTimeout(room.gameState.day.timer);
      startNight(io, room, roomCode);
      ack?.({ ok: true });
    } else {
      // A propósito no hay rama para "game-over": ahí termina la partida, no
      // hay próxima fase a la que avanzar.
      ack?.({ ok: false, error: "No hay nada para avanzar ahora." });
    }
  },

  // --- Votación: a quién acusar ---
  "day:vote": (ctx, { targetId }, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (room.phase !== "day-voting") {
      ack?.({ ok: false, error: "No es momento de votar." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés votar." });
      return;
    }
    if (socket.id === room.gameState.day.silencedId) {
      ack?.({ ok: false, error: "Estás silenciado, no podés votar hoy." });
      return;
    }
    if (socket.id in room.gameState.day.nominations) {
      ack?.({ ok: false, error: "Ya votaste." });
      return;
    }
    if (targetId !== null && (!room.players[targetId]?.alive || targetId === socket.id)) {
      ack?.({ ok: false, error: "Objetivo inválido." });
      return;
    }
    room.gameState.day.nominations[socket.id] = targetId; // null = abstención

    ack?.({ ok: true });
    broadcastVotingProgress(io, room, roomCode);
    maybeResolveVoting(io, room, roomCode);
  },

  // --- Juicio: culpable o inocente ---
  "day:verdict": (ctx, { verdict }, ack) => {
    const { io, socket, room, roomCode } = ctx;
    if (room.phase !== "day-trial") {
      ack?.({ ok: false, error: "No es momento de votar el veredicto." });
      return;
    }
    if (socket.id === room.gameState.day.accusedId) {
      ack?.({ ok: false, error: "No podés votar tu propio juicio." });
      return;
    }
    if (!room.players[socket.id]?.alive) {
      ack?.({ ok: false, error: "Estás eliminado, no podés votar." });
      return;
    }
    if (verdict !== "guilty" && verdict !== "innocent") {
      ack?.({ ok: false, error: "Veredicto inválido." });
      return;
    }
    if (socket.id in room.gameState.day.verdicts) {
      ack?.({ ok: false, error: "Ya votaste." });
      return;
    }
    room.gameState.day.verdicts[socket.id] = verdict;

    ack?.({ ok: true });
    io.to(roomCode).emit("day:verdictProgress", { votedIds: Object.keys(room.gameState.day.verdicts) });
    maybeResolveTrial(io, room, roomCode);
  },

  // --- La pantalla reinicia la partida en la MISMA sala una vez terminada:
  //     vuelve todo al lobby (mismo código, mismos jugadores conectados) sin
  //     tener que recrear la sala ni volver a escanear el QR. ---
  "game:restart": (ctx, _data, ack) => {
    const { io, room, roomCode } = ctx;
    if (ctx.socket.data.role !== "screen") {
      ack?.({ ok: false, error: "Solo la pantalla puede reiniciar la partida." });
      return;
    }
    if (room.phase !== "game-over") {
      ack?.({ ok: false, error: "La partida no terminó todavía." });
      return;
    }

    clearTimeout(room.gameState.night?.timer);
    clearTimeout(room.gameState.day?.timer);

    room.started = false;
    room.phase = "lobby";
    room.gameState.assignment = {};
    room.gameState.mafiaOrder = [];
    room.gameState.loversIds = [];
    room.history = []; // partida nueva, log nuevo
    room.gameState.night = null;
    room.gameState.day = null;

    Object.keys(room.players).forEach((id) => {
      if (room.players[id].kicked) delete room.players[id];
      else room.players[id].alive = true;
    });

    ack?.({ ok: true });
    io.to(roomCode).emit("game:restarted");
    io.to(roomCode).emit("lobby:update", { players: publicPlayerList(room) });
  },
};

// --- Chat: "general" (todos los conectados, en cualquier momento) y
//     "fantasmas" (solo jugadores ya eliminados, entre ellos). Implementa
//     el campo chatChannels del contrato de plugin — la plataforma (ver
//     platform/core/connection.js) usa canSend para decidir quién puede
//     mandar/leer cada canal y recipients para saber a quién entregarle
//     cada mensaje; nunca a toda la sala, así la pantalla compartida nunca
//     recibe tráfico de chat y "fantasmas" nunca se filtra a un jugador
//     vivo.
const mafiaChatChannels = [
  {
    id: "general",
    canSend: () => true,
    recipients: (room) => Object.keys(room.players),
  },
  {
    id: "fantasmas",
    canSend: (room, senderId) => room.players[senderId]?.alive === false,
    recipients: (room) => Object.keys(room.players).filter((id) => room.players[id].alive === false),
  },
];

// Catálogo completo de roles (no solo los de esta partida) + reglas
// generales, servido como JS estático para que tanto el celular como la
// pantalla lo tengan disponible desde que cargan la página, sin necesidad
// de un evento de socket dedicado ni de duplicar estos datos en el cliente.
// Implementa el campo staticRoutes del contrato de plugin — la plataforma
// monta cada ruta bajo /${gameId}${path}, sin saber qué devuelve.
function mafiaRulesDataRoute(req, res) {
  res.type("application/javascript").send(
    `window.GAME_RULES = ${JSON.stringify({
      allRoles: Object.entries(ROLE_INFO).map(([roleId, r]) => ({ roleId, ...r })),
      generalRules: GENERAL_RULES,
    })};`
  );
}

module.exports = registerGame({
  id: "mafia",
  createGameState: () => ({ loversIds: [] }),
  socketHandlers: mafiaSocketHandlers,
  onReconnect: mafiaOnReconnect,
  remapPlayerId: mafiaRemapPlayerId,
  onKick: mafiaOnKick,
  chatChannels: mafiaChatChannels,
  staticRoutes: [{ path: "/rules-data.js", handler: mafiaRulesDataRoute }],
  publicDir: __dirname + "/../../public/games/mafia",
});
