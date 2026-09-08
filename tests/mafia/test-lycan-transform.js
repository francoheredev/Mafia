const { io } = require("socket.io-client");

// Fase A (8 jugadores): la Mafia ataca directo al Lycan de noche. Debería
// sobrevivir (no aparece en "deaths") y pasar a jugar para la Mafia (aparece
// en "transformations"), sin que eso dispare un ganador. Para probar que a
// partir de ahí es un mafioso normal, se lo vota y ejecuta al día siguiente
// — esa segunda "muerte" sí debería ser real (ya no lo protege más el truco
// del Lycan, porque su equipo ya es "mafia").
// Fase B (sala nueva, 8 jugadores): un kick del host a un Lycan todavía sin
// transformar debería matarlo de verdad, no transformarlo — kickPlayer usa
// bypassLycan a propósito porque es una acción fuera de la ficción del juego.
//
// A 8 jugadores, Amante ahora compite por el mismo lugar que Lycan (ver
// maybeApplyLovers en roles.js) — sale con 50% de chance, así que no todas
// las salas de 8 tienen Lycan. Ambas fases reintentan con una sala nueva
// hasta que salga.

const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno"];
const MAX_ATTEMPTS = 15;

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function runPhaseA(onDone, attempt = 1) {
  if (attempt > MAX_ATTEMPTS) return fail(`No salió Lycan en ${MAX_ATTEMPTS} intentos (¿Amante lo está reemplazando siempre?).`);
  const screen = io("http://localhost:3000");
  const players = [];
  let joinedCount = 0;
  let assignedCount = 0;
  let lycanEntry = null;
  let actedMafia = false;

  function cleanup() {
    players.forEach((p) => p.socket.close());
    screen.close();
  }

  screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));
  screen.on("screen:created", ({ code }) => {
    console.log(`✅ [Fase A, intento ${attempt}] Sala creada:`, code);
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p, role: null };
      players.push(entry);

      p.on("connect", () => {
        p.emit("player:join", { code, name }, (res) => {
          if (!res.ok) return fail("Error al unirse: " + res.error);
          joinedCount++;
          if (joinedCount === NAMES.length) {
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
        if (role.roleId === "lycan") lycanEntry = entry;
        assignedCount++;
        if (assignedCount === NAMES.length) {
          if (!lycanEntry) {
            console.log(`[Fase A, intento ${attempt}] No salió Lycan esta vez (salió Amante) — reintentando...`);
            cleanup();
            return runPhaseA(onDone, attempt + 1);
          }
          console.log("✅ [Fase A] Roles repartidos. Lycan:", lycanEntry.name);
        }
      });

      p.on("night:mafiaTurn", ({ isLeader, targets }) => {
        if (!isLeader || actedMafia) return;
        actedMafia = true;
        const target = targets.find((t) => t.id === lycanEntry.socketId);
        if (!target) return fail("El Lycan no apareció como objetivo válido de la Mafia.");
        console.log(`✅ [Fase A] Líder de la Mafia (${entry.name}) ataca al Lycan (${lycanEntry.name})`);
        p.emit("night:action", { role: "mafia", targetId: target.id }, (res) => {
          if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
        });
      });

      p.on("night:yourTurn", ({ role, targets }) => {
        // El Médico se protege a sí mismo a propósito, para no salvar al Lycan.
        if (role === "medico") {
          p.emit("night:action", { role: "medico", targetId: entry.socketId }, (res) => {
            if (!res.ok) fail("Médico no pudo actuar: " + res.error);
          });
        }
        if (role === "detective") {
          p.emit("night:action", { role: "detective", targetId: targets[0].id }, (res) => {
            if (!res.ok) fail("Vidente no pudo investigar: " + res.error);
          });
        }
      });

      p.on("day:yourVote", () => {
        const isSelf = entry.socketId === lycanEntry.socketId;
        p.emit("day:vote", { targetId: isSelf ? null : lycanEntry.socketId }, (res) => {
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

  screen.on("night:resolved", ({ deaths, transformations, winner }) => {
    const survived = !deaths.some((d) => d.id === lycanEntry.socketId);
    const transformed = transformations?.some((t) => t.id === lycanEntry.socketId);
    console.log(`\nChequeo: el Lycan sobrevivió al ataque: ${survived ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: el Lycan aparece transformado: ${transformed ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: la transformación no dispara un ganador: ${!winner ? "OK" : "❌ MAL"}`);
    if (!survived || !transformed || winner) {
      cleanup();
      return fail("La transformación del Lycan no funcionó como se esperaba.");
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
  screen.on("day:noAccusation", () => fail("No se esperaba 'nadie acusado' — todos votan al Lycan."));
  screen.on("day:defense", ({ accused }) => {
    if (accused.name !== lycanEntry.name) return fail("El acusado no fue el Lycan transformado.");
    screen.emit("day:advance", null, (res) => {
      if (!res.ok) fail("No se pudo avanzar de la defensa: " + res.error);
    });
  });

  screen.on("day:resolved", ({ executed, deaths, transformations, winner }) => {
    const reallyDied = executed && deaths.some((d) => d.id === lycanEntry.socketId);
    const noSecondTransform = !transformations?.some((t) => t.id === lycanEntry.socketId);
    console.log(`\nChequeo: el Lycan (ya mafia) muere de verdad la segunda vez: ${reallyDied ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: esta vez NO se vuelve a transformar: ${noSecondTransform ? "OK" : "❌ MAL"}`);
    const allOk = reallyDied && noSecondTransform;
    cleanup();
    if (!allOk) return fail("La segunda muerte del Lycan (ya como mafia) no fue real.");
    console.log("\n🎉 Fase A (transformación + muerte real posterior) OK.");
    onDone();
  });
}

function runPhaseB(attempt = 1) {
  if (attempt > MAX_ATTEMPTS) return fail(`No salió Lycan en ${MAX_ATTEMPTS} intentos (¿Amante lo está reemplazando siempre?).`);

  const screen = io("http://localhost:3000");
  const players = [];
  let joinedCount = 0;
  let assignedCount = 0;
  let lycanEntry = null;

  function cleanup(code) {
    players.forEach((p) => p.socket.close());
    screen.close();
    if (code !== undefined) process.exit(code);
  }

  screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));
  screen.on("screen:created", ({ code }) => {
    console.log(`\n✅ [Fase B, intento ${attempt}] Sala creada:`, code);
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p, role: null };
      players.push(entry);

      p.on("connect", () => {
        p.emit("player:join", { code, name }, (res) => {
          if (!res.ok) return fail("Error al unirse: " + res.error);
          joinedCount++;
          if (joinedCount === NAMES.length) {
            screen.emit("game:start", null, (res2) => {
              if (!res2.ok) fail("Error al arrancar: " + res2.error);
            });
          }
        });
      });

      p.on("role:assigned", (role) => {
        entry.role = role;
        entry.socketId = p.id;
        if (role.roleId === "lycan") lycanEntry = entry;
        assignedCount++;
        if (assignedCount === NAMES.length) {
          if (!lycanEntry) {
            console.log(`[Fase B, intento ${attempt}] No salió Lycan esta vez (salió Amante) — reintentando...`);
            cleanup();
            return runPhaseB(attempt + 1);
          }
          console.log(`✅ [Fase B] Roles repartidos. Expulsando al Lycan (${lycanEntry.name}) antes de que caiga la noche...`);
          screen.emit("player:kick", { targetId: lycanEntry.socketId }, (res) => {
            if (!res.ok) fail("No se pudo expulsar: " + res.error);
          });
        }
      });
    });
  });

  screen.on("player:removed", ({ removedIds, transformations }) => {
    const reallyDied = removedIds.includes(lycanEntry.socketId);
    const noBypassTransform = !transformations?.some((t) => t.id === lycanEntry.socketId);
    console.log(`Chequeo: el kick mata de verdad al Lycan (no lo transforma): ${reallyDied ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: no aparece en transformations: ${noBypassTransform ? "OK" : "❌ MAL"}`);
    const allOk = reallyDied && noBypassTransform;
    console.log(allOk ? "\n🎉 Fase B (kick no transforma) OK." : "\n❌ Algo falló.");
    cleanup(allOk ? 0 : 1);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 60000);

runPhaseA(runPhaseB);
