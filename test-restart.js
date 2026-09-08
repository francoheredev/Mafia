const { io } = require("socket.io-client");

// Fase A: game:restart antes de game-over debe rechazarse.
// Fase B: reutiliza el flujo de test-win-mafia.js para llegar a "winner:
// mafia", pide game:restart, y confirma que la sala vuelve a lobby (se
// puede arrancar game:start de nuevo, en el mismo código, sin recrear la
// sala ni reconectar a nadie).
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function runPhaseA(onDone) {
  const screen = io("http://localhost:3000");
  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", () => {
    screen.emit("game:restart", null, (res) => {
      const rejected = res.ok === false;
      console.log(`Chequeo: restart antes de game-over es rechazado: ${rejected ? "OK" : "❌ MAL"}`);
      screen.close();
      if (!rejected) return fail("game:restart no debería aceptarse fuera de game-over.");
      console.log("\n🎉 Fase A (restart prematuro rechazado) OK.");
      onDone();
    });
  });
}

function runPhaseB() {
  const screen = io("http://localhost:3000");
  let roomCode = null;
  const players = [];
  let joinedCount = 0;
  let assignedCount = 0;
  let sawWinner = false;

  function fail2(msg) {
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
  function roleOf(socketId) {
    return players.find((p) => p.socketId === socketId)?.role;
  }
  function markDead(deaths) {
    deaths.forEach((d) => {
      const p = players.find((x) => x.socketId === d.id);
      if (p) p.alive = false;
    });
  }

  function joinAll(afterAllAssigned) {
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p, role: null, alive: true };
      players.push(entry);

      p.on("connect", () => {
        p.emit("player:join", { code: roomCode, name }, (res) => {
          if (!res.ok) return fail2("Error al unirse: " + res.error);
          joinedCount++;
          if (joinedCount === NAMES.length) {
            screen.emit("game:start", null, (res2) => {
              if (!res2.ok) return fail2("Error al arrancar: " + res2.error);
              screen.emit("day:advance", null, (res3) => {
                if (!res3.ok) fail2("No se pudo pasar la intro de roles: " + res3.error);
              });
            });
          }
        });
      });

      p.on("role:assigned", (role) => {
        entry.role = role;
        entry.socketId = p.id;
        entry.alive = true;
        assignedCount++;
        if (assignedCount === NAMES.length) afterAllAssigned();
      });

      p.on("night:mafiaTurn", ({ isLeader, targets }) => {
        if (!isLeader) return;
        const victim = targets.find((t) => roleOf(t.id)?.roleId !== "cazador") || targets[0];
        p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
          if (!res.ok) fail2("Mafia no pudo elegir: " + res.error);
        });
        const medico = players.find((x) => x.role?.roleId === "medico" && x.alive);
        if (medico) {
          if (medico.pendingYourTurn) {
            medico.socket.emit("night:action", { role: "medico", targetId: entry.socketId }, (res) => {
              if (!res.ok) fail2("Médico no pudo actuar: " + res.error);
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
            if (!res.ok) fail2("Médico no pudo actuar: " + res.error);
          });
          entry.pendingYourTurn = false;
        }
        if (role === "detective") {
          p.emit("night:action", { role: "detective", targetId: targets[0].id }, (res) => {
            if (!res.ok) fail2("Vidente no pudo investigar: " + res.error);
          });
        }
      });

      p.on("day:yourVote", () => {
        p.emit("day:vote", { targetId: null }, (res) => {
          if (!res.ok) fail2("No se pudo votar: " + res.error);
        });
      });
      p.on("day:yourVerdict", () => fail2("No se esperaba juicio en este test."));
    });
  }

  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    roomCode = code;
    console.log("\n✅ [Fase B] Sala creada:", roomCode);
    joinAll(() => console.log("✅ [Fase B] Roles repartidos, Mafia:", aliveMafia().map((x) => x.name)));
  });

  screen.on("night:resolved", ({ deaths, winner }) => {
    markDead(deaths);
    if (winner) {
      sawWinner = true;
      console.log(`✅ [Fase B] Ganó: ${winner}. Pidiendo game:restart...`);
      screen.emit("game:restart", null, (res) => {
        if (!res.ok) return fail2("game:restart en game-over falló: " + res.error);
      });
      return;
    }
    screen.emit("day:advance", null, (res) => {
      if (!res.ok) fail2("No se pudo avanzar del amanecer: " + res.error);
    });
  });

  screen.on("day:discussion", () => {
    screen.emit("day:advance", null, (res) => {
      if (!res.ok) fail2("No se pudo avanzar de la discusión: " + res.error);
    });
  });
  screen.on("day:noAccusation", () => {
    screen.emit("day:advance", null, (res) => {
      if (!res.ok) fail2("No se pudo avanzar de 'nadie acusado': " + res.error);
    });
  });
  screen.on("day:defense", () => fail2("No se esperaba una acusación en este test."));

  let restarted = false;
  screen.on("game:restarted", () => {
    restarted = true;
  });

  screen.on("lobby:update", ({ players: list }) => {
    if (!restarted || !sawWinner) return; // ignorá los lobby:update normales del join inicial
    const allBack = list.length === NAMES.length;
    console.log(`Chequeo: game:restarted + lobby:update trajeron a los ${NAMES.length} jugadores: ${allBack ? "OK" : "❌ MAL"}`);
    if (!allBack) return fail2("No volvieron todos los jugadores al lobby tras el restart.");

    // Reasigna roles frescos para probar que la sala quedó realmente lista
    // para una partida nueva, sin recrearla.
    assignedCount = 0;
    players.forEach((p) => (p.role = null));
    screen.once("night:begin", ({ number }) => {
      const freshStart = number === 1;
      console.log(`Chequeo: se pudo arrancar una partida nueva en la misma sala (Noche #${number}): ${freshStart ? "OK" : "❌ MAL"}`);
      cleanup(freshStart ? 0 : 1);
    });
    screen.emit("game:start", null, (res) => {
      if (!res.ok) return fail2("No se pudo re-arrancar game:start tras el restart: " + res.error);
      screen.emit("day:advance", null, (res3) => {
        if (!res3.ok) fail2("No se pudo pasar la intro de roles tras el restart: " + res3.error);
      });
    });
  });

  setTimeout(() => {
    if (!restarted) fail2("Timeout: no se llegó a reiniciar la partida.");
  }, 240000);
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 260000);

runPhaseA(runPhaseB);
