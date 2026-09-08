const { io } = require("socket.io-client");

// 6 jugadores (mínimo): 1 Padrino, 1 Mafioso, 1 Detective, 1 Médico, 1
// Cazador, 1 Bufón. Cada noche nadie muere (el Médico protege al blanco de
// la Mafia); cada Día se fuerza la ejecución de un mafioso hasta que no
// quede ninguno — ahí debería declararse "winner: ciudad".
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];

const screen = io("http://localhost:3000");
let roomCode = null;
const players = [];
let joinedCount = 0;
let assignedCount = 0;
let currentAccusedId = null;
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
function markDead(deaths) {
  deaths.forEach((d) => {
    const p = players.find((x) => x.socketId === d.id);
    if (p) p.alive = false;
  });
}

screen.on("connect", () => screen.emit("screen:create"));

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

    // --- Noche: que no muera nadie (Médico protege al blanco de la Mafia) ---
    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader) return;
      const victim = targets[0];
      p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });

      const medico = players.find((x) => x.role?.roleId === "medico" && x.alive);
      if (medico) {
        if (medico.pendingYourTurn) {
          medico.socket.emit("night:action", { role: "medico", targetId: victim.id }, (res) => {
            if (!res.ok) fail("Médico no pudo proteger: " + res.error);
          });
          medico.pendingYourTurn = false;
        } else {
          medico.pendingProtect = victim.id;
        }
      }
    });

    p.on("night:yourTurn", ({ role, targets }) => {
      entry.pendingYourTurn = true;
      if (role === "medico" && entry.pendingProtect) {
        p.emit("night:action", { role: "medico", targetId: entry.pendingProtect }, (res) => {
          if (!res.ok) fail("Médico no pudo proteger: " + res.error);
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

    // --- Día: todos votan al mafioso elegido; él/ella se abstiene ---
    p.on("day:yourVote", () => {
      if (!currentAccusedId) return fail("No había acusado definido al votar.");
      const isSelf = entry.socketId === currentAccusedId;
      p.emit("day:vote", { targetId: isSelf ? null : currentAccusedId }, (res) => {
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
});

screen.on("night:resolved", ({ winner }) => {
  if (winner) fail("La noche no debería terminar la partida en este test.");
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del amanecer: " + res.error);
  });
});

screen.on("day:discussion", () => {
  const mafia = aliveMafia();
  if (!mafia.length) return fail("No quedaba mafia para acusar (¿ya debería haber ganado la Ciudad?).");
  currentAccusedId = mafia[0].socketId;
  console.log(`✅ Discusión — hoy se acusa a ${mafia[0].name} (mafia)`);
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la discusión: " + res.error);
  });
});

screen.on("day:noAccusation", () => {
  fail("Nadie fue acusado — se esperaba forzar la ejecución del mafioso.");
});

screen.on("day:defense", () => {
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la defensa: " + res.error);
  });
});

screen.on("day:resolved", ({ executed, deaths, winner, roster }) => {
  if (!executed) return fail("Se esperaba que el mafioso fuera ejecutado.");
  markDead(deaths);
  console.log(`✅ Ejecutado/a: ${deaths[0]?.name}. Mafia viva restante: ${aliveMafia().length}`);

  if (winner) {
    sawWinner = true;
    const winnerOk = winner === "ciudad";
    const rosterOk = Array.isArray(roster) && roster.length === NAMES.length;

    console.log(`\nChequeo: ganó la Ciudad: ${winnerOk ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: vino el roster completo (${roster?.length}/${NAMES.length}): ${rosterOk ? "OK" : "❌ MAL"}`);

    let advancedAgain = false;
    screen.once("night:begin", () => {
      advancedAgain = true;
    });
    setTimeout(() => {
      const stoppedOk = !advancedAgain;
      console.log(`Chequeo: el servidor frenó el ciclo (no arrancó otra noche): ${stoppedOk ? "OK" : "❌ MAL"}`);
      const allOk = winnerOk && rosterOk && stoppedOk;
      console.log(allOk ? "\n🎉 Condición de victoria (Ciudad) funcionando de punta a punta." : "\n❌ Algo falló.");
      cleanup(allOk ? 0 : 1);
    }, 3000);
    return;
  }

  // Seguir con la próxima noche sin esperar el timer de respaldo del servidor.
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del veredicto: " + res.error);
  });
});

// Este test necesita 2 noches (una por cada mafioso a ejecutar); cada una se
// resuelve apenas actúan todos (ver NIGHT_EARLY_RESOLVE_MS en server.js), así
// que este timeout es solo una red de seguridad generosa.
setTimeout(() => {
  if (!sawWinner) {
    console.error("❌ Timeout: algo no terminó a tiempo.");
    cleanup(1);
  }
}, 180000);
