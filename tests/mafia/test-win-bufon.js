const { io } = require("socket.io-client");

// 6 jugadores (mínimo): 1 Padrino, 1 Mafioso, 1 Detective, 1 Médico, 1
// Cazador, 1 Bufón. De noche, la Mafia ataca al Detective (no al Cazador,
// para no disparar su venganza al azar contra el Bufón antes de tiempo) y el
// Médico "protege" al propio líder de la Mafia a propósito, para no bloquear
// ese ataque. Al llegar el Día, todos los vivos que no son el Bufón lo votan
// y lo declaran culpable en el juicio — debería declararse "winner: bufon"
// apenas se lo ejecuta, sin importar cómo queda el conteo Mafia/Ciudad.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];

const screen = io("http://localhost:3000");
let roomCode = null;
const players = [];
let joinedCount = 0;
let assignedCount = 0;
let sawWinner = false;

function fail(msg) {
  console.error("❌", msg);
  cleanup(1);
}
function cleanup(code) {
  players.forEach((p) => p.socket.close());
  screen.close();
  process.exit(code);
}
function bufonEntry() {
  return players.find((p) => p.role?.roleId === "bufon");
}

screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));

screen.on("screen:created", ({ code }) => {
  roomCode = code;
  console.log("✅ Sala creada:", code);

  NAMES.forEach((name) => {
    const p = io("http://localhost:3000");
    const entry = { name, socket: p, role: null, alive: true };
    players.push(entry);

    p.on("connect", () => {
      p.emit("player:join", { code, name }, (res) => {
        if (!res.ok) return fail("Error al unirse: " + res.error);
        joinedCount++;
        if (joinedCount === NAMES.length) {
          console.log(`✅ Los ${NAMES.length} jugadores se unieron. Arrancando partida...`);
          screen.emit("game:start", null, (res2) => {
            if (!res2.ok) return fail("Error al arrancar: " + res2.error);
            screen.emit("day:advance", null, (res3) => {
              if (!res3.ok) fail("No se pudo pasar la intro de roles: " + res3.error);
            });
          });
        }
      });
    });

    p.on("role:assigned", (role) => {
      entry.role = role;
      entry.socketId = p.id;
      assignedCount++;
      if (assignedCount === NAMES.length) {
        console.log("✅ Todos los jugadores tienen su rol. Bufón:", bufonEntry()?.name);
      }
    });

    // --- Noche: la Mafia ataca al Detective; el Médico "protege" al líder
    //     de la Mafia a propósito, para no bloquear ese ataque real. ---
    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader) return;
      const victim = targets.find((t) => {
        const r = players.find((x) => x.socketId === t.id)?.role;
        return r?.roleId === "detective";
      });
      if (!victim) return fail("No encontré al Detective entre los objetivos.");
      p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });

      const medico = players.find((x) => x.role?.roleId === "medico" && x.alive);
      if (medico) {
        if (medico.pendingYourTurn) {
          medico.socket.emit("night:action", { role: "medico", targetId: entry.socketId }, (res) => {
            if (!res.ok) fail("Médico no pudo actuar: " + res.error);
          });
          medico.pendingYourTurn = false;
        } else {
          medico.pendingProtect = entry.socketId;
        }
      }
    });

    p.on("night:yourTurn", ({ role, targets }) => {
      entry.pendingYourTurn = true;
      if (role === "medico" && entry.pendingProtect) {
        p.emit("night:action", { role: "medico", targetId: entry.pendingProtect }, (res) => {
          if (!res.ok) fail("Médico no pudo actuar: " + res.error);
        });
        entry.pendingYourTurn = false;
      }
      if (role === "detective") {
        const someone = targets[0];
        p.emit("night:action", { role: "detective", targetId: someone.id }, (res) => {
          if (!res.ok) fail("Vidente no pudo investigar: " + res.error);
        });
      }
    });

    // --- Día: todos votan al Bufón (que se abstiene, no puede votarse a sí
    //     mismo) y lo declaran culpable en el juicio. ---
    p.on("day:yourVote", () => {
      const bufon = bufonEntry();
      const targetId = bufon && bufon.socketId !== entry.socketId ? bufon.socketId : null;
      p.emit("day:vote", { targetId }, (res) => {
        if (!res.ok) fail("No se pudo votar: " + res.error);
      });
    });

    p.on("day:yourVerdict", () => {
      p.emit("day:verdict", { verdict: "guilty" }, (res) => {
        if (!res.ok) fail("No se pudo votar el veredicto: " + res.error);
      });
    });
  });
});

screen.on("night:begin", ({ number }) => {
  console.log(`\n✅ Empezó la noche #${number}`);
  if (number > 1) fail("No se esperaba una segunda noche en este test.");
});

screen.on("night:resolved", ({ winner }) => {
  if (winner) return fail(`No se esperaba un ganador en la noche (llegó: ${winner}).`);
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del amanecer: " + res.error);
  });
});

screen.on("day:discussion", () => {
  console.log("✅ Empezó la discusión — se salta directo a la votación.");
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la discusión: " + res.error);
  });
});

screen.on("day:noAccusation", () => {
  fail("No se esperaba 'nadie acusado' — todos votan al Bufón.");
});

screen.on("day:defense", ({ accused }) => {
  console.log(`✅ Acusado: ${accused.name} (esperado: ${bufonEntry()?.name})`);
  if (accused.name !== bufonEntry()?.name) fail("El acusado no fue el Bufón.");
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la defensa: " + res.error);
  });
});

screen.on("day:resolved", ({ executed, accused, winner, roster }) => {
  sawWinner = Boolean(winner);
  const winnerOk = winner === "bufon";
  const executedOk = executed === true && accused.name === bufonEntry()?.name;
  const rosterOk = Array.isArray(roster) && roster.length === NAMES.length;

  console.log(`\nChequeo: se ejecutó al Bufón: ${executedOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: ganó el Bufón: ${winnerOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: vino el roster completo (${roster?.length}/${NAMES.length}): ${rosterOk ? "OK" : "❌ MAL"}`);

  let advancedAgain = false;
  screen.once("night:begin", () => {
    advancedAgain = true;
  });
  setTimeout(() => {
    const stoppedOk = !advancedAgain;
    console.log(`Chequeo: el servidor frenó el ciclo (no arrancó otra noche): ${stoppedOk ? "OK" : "❌ MAL"}`);
    const allOk = winnerOk && executedOk && rosterOk && stoppedOk;
    console.log(allOk ? "\n🎉 Condición de victoria (Bufón) funcionando de punta a punta." : "\n❌ Algo falló.");
    cleanup(allOk ? 0 : 1);
  }, 3000);
});

setTimeout(() => {
  if (!sawWinner) {
    console.error("❌ Timeout: algo no terminó a tiempo.");
    cleanup(1);
  }
}, 60000);
