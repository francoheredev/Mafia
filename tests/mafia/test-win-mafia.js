const { io } = require("socket.io-client");

// 6 jugadores (mínimo): 1 Padrino, 1 Mafioso, 1 Detective, 1 Médico, 1
// Cazador, 1 Bufón (2 mafia vs 4 buenos). Cada Día se fuerza "nadie
// acusado" (todos se abstienen); cada noche la Mafia mata a un bueno sin
// que el Médico lo proteja de verdad (protege al propio líder de la Mafia,
// a propósito, para no salvar a la víctima real) — evitando además elegir
// al Cazador como víctima, para no disparar su venganza y descontrolar el
// conteo. Tras 3 muertes buenas (2 mafia vs 1 bueno) debería declararse
// "winner: mafia".
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
function aliveMafia() {
  return players.filter((p) => p.alive && p.role?.team === "mafia");
}
function aliveGood() {
  return players.filter((p) => p.alive && p.role?.team !== "mafia");
}
function roleOf(socketId) {
  return players.find((p) => p.socketId === socketId)?.role;
}
function markDead(deaths) {
  deaths.forEach((d) => {
    const p = players.find((x) => x.socketId === d.id);
    if (p) p.alive = false;
  });
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
        console.log("✅ Todos los jugadores tienen su rol.");
        console.log("Mafia:", aliveMafia().map((x) => x.name));
      }
    });

    // --- Noche: la Mafia mata a un bueno (no al Cazador) sin protección real ---
    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader) return;
      const victim = targets.find((t) => roleOf(t.id)?.roleId !== "cazador") || targets[0];
      console.log(`✅ Líder de la Mafia (${entry.name}) ataca a ${victim.name}`);
      p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });

      // El Médico "protege" al propio líder de la Mafia a propósito, para
      // no salvar a la víctima real.
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

    // --- Día: todos se abstienen, a propósito, para que nadie sea acusado ---
    p.on("day:yourVote", () => {
      p.emit("day:vote", { targetId: null }, (res) => {
        if (!res.ok) fail("No se pudo votar: " + res.error);
      });
    });

    p.on("day:yourVerdict", () => {
      fail("No se esperaba un juicio en este test (nadie debería ser acusado).");
    });
  });
});

screen.on("night:begin", ({ number }) => {
  console.log(`\n✅ Empezó la noche #${number}`);
});

screen.on("night:resolved", ({ deaths, winner, roster }) => {
  markDead(deaths);
  console.log(
    `Muertes: ${deaths.map((d) => d.name).join(", ") || "ninguna"} — Mafia viva: ${
      aliveMafia().length
    }, buenos vivos: ${aliveGood().length}`
  );

  if (winner) {
    sawWinner = true;
    const winnerOk = winner === "mafia";
    const rosterOk = Array.isArray(roster) && roster.length === NAMES.length;

    console.log(`\nChequeo: ganó la Mafia: ${winnerOk ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: vino el roster completo (${roster?.length}/${NAMES.length}): ${rosterOk ? "OK" : "❌ MAL"}`);

    let advancedAgain = false;
    screen.once("day:discussion", () => {
      advancedAgain = true;
    });
    setTimeout(() => {
      const stoppedOk = !advancedAgain;
      console.log(`Chequeo: el servidor frenó el ciclo (no arrancó otro día): ${stoppedOk ? "OK" : "❌ MAL"}`);
      const allOk = winnerOk && rosterOk && stoppedOk;
      console.log(allOk ? "\n🎉 Condición de victoria (Mafia) funcionando de punta a punta." : "\n❌ Algo falló.");
      cleanup(allOk ? 0 : 1);
    }, 3000);
    return;
  }

  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del amanecer: " + res.error);
  });
});

screen.on("day:discussion", () => {
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la discusión: " + res.error);
  });
});

screen.on("day:noAccusation", () => {
  console.log("✅ Nadie fue acusado (a propósito) — sigue la noche");
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de 'nadie acusado': " + res.error);
  });
});

screen.on("day:defense", () => {
  fail("No se esperaba una acusación en este test.");
});

// Este test necesita 3 noches completas para que la Mafia supere en número
// a los buenos. Cada noche se resuelve apenas actúan Mafia/Detective/Médico
// (ver NIGHT_EARLY_RESOLVE_MS en server.js), así que el timeout de acá es
// solo una red de seguridad generosa, no una duración esperada.
setTimeout(() => {
  if (!sawWinner) {
    console.error("❌ Timeout: algo no terminó a tiempo.");
    cleanup(1);
  }
}, 240000);
