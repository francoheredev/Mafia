const { io } = require("socket.io-client");

// Fase A (lobby): un jugador se une, se "cae" (cierra el socket) antes de que
// arranque la partida, y reconecta con el mismo token vía player:rejoin.
// Debería recuperar su lugar en la sala sin quedar duplicado en la lista.
// Fase B (mid-partida, 6 jugadores): el Bufón (sin acción nocturna propia) se
// desconecta apenas se reparten los roles y reconecta durante la Noche.
// Debería recibir de nuevo su role:assigned con el mismo rol y el estado de
// fase actual (night:waiting), mientras el resto de la partida sigue su
// curso normalmente.

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function runPhaseA(onDone) {
  const screen = io("http://localhost:3000");
  let roomCode = null;
  let token = null;

  function cleanup() {
    screen.close();
  }

  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    roomCode = code;
    console.log("✅ [Fase A] Sala creada:", roomCode);

    const p1 = io("http://localhost:3000");
    p1.on("connect", () => {
      p1.emit("player:join", { code: roomCode, name: "Fede" }, (res) => {
        if (!res.ok) return fail("Error al unirse: " + res.error);
        token = res.token;
        if (!token) return fail("El ack de player:join no trajo token.");
        console.log("✅ [Fase A] Fede se unió, token guardado. Cerrando conexión (simula caída)...");
        p1.close();

        setTimeout(() => {
          const p1b = io("http://localhost:3000");
          p1b.on("connect", () => {
            p1b.emit("player:rejoin", { code: roomCode, token }, (res2) => {
              if (!res2.ok) return fail("player:rejoin falló en el lobby: " + res2.error);
              console.log("✅ [Fase A] Rejoin aceptado, nombre:", res2.name);
            });
          });

          screen.on("lobby:update", ({ players }) => {
            const fede = players.filter((pl) => pl.name === "Fede");
            const singleEntry = fede.length === 1;
            const reconnected = fede[0]?.connected === true;
            console.log(`Chequeo: no quedó duplicado en la sala: ${singleEntry ? "OK" : "❌ MAL"}`);
            console.log(`Chequeo: la sala lo ve conectado de nuevo: ${reconnected ? "OK" : "❌ MAL"}`);
            p1b.close();
            cleanup();
            if (!singleEntry || !reconnected) return fail("El rejoin en el lobby no dejó el estado esperado.");
            console.log("\n🎉 Fase A (rejoin en lobby) OK.");
            onDone();
          });
        }, 300);
      });
    });
  });
}

function runPhaseB() {
  const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];
  const screen = io("http://localhost:3000");
  const players = [];
  let joinedCount = 0;
  let assignedCount = 0;
  let bufonEntry = null;
  let bufonRejoined = false;
  const pendingActions = [];

  function cleanup(code) {
    players.forEach((p) => p.socket.close());
    if (bufonEntry?.newSocket) bufonEntry.newSocket.close();
    screen.close();
    process.exit(code);
  }
  function failB(msg) {
    console.error("❌", msg);
    cleanup(1);
  }
  function whenReady(fn) {
    if (bufonRejoined) fn();
    else pendingActions.push(fn);
  }

  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    console.log("\n✅ [Fase B] Sala creada:", code);
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p, role: null, token: null };
      players.push(entry);

      p.on("connect", () => {
        p.emit("player:join", { code, name }, (res) => {
          if (!res.ok) return failB("Error al unirse: " + res.error);
          entry.token = res.token;
          joinedCount++;
          if (joinedCount === NAMES.length) {
            screen.emit("game:start", null, (res2) => {
              if (!res2.ok) return failB("Error al arrancar: " + res2.error);
              screen.emit("day:advance", null, (res3) => {
                if (!res3.ok) failB("No se pudo pasar la intro de roles: " + res3.error);
              });
            });
          }
        });
      });

      p.on("role:assigned", (role) => {
        entry.role = role;
        entry.socketId = p.id;
        if (role.roleId === "bufon") bufonEntry = entry;
        assignedCount++;
        if (assignedCount === NAMES.length) {
          if (!bufonEntry) return failB("No salió Bufón en el reparto de 6 jugadores.");
          console.log(`✅ [Fase B] Roles repartidos. Bufón: ${bufonEntry.name}. Desconectándolo...`);
          bufonEntry.socket.close();

          setTimeout(() => {
            const p2 = io("http://localhost:3000");
            bufonEntry.newSocket = p2;
            let gotRoleAssigned = false;
            let gotNightWaiting = false;

            p2.on("connect", () => {
              p2.emit("player:rejoin", { code, token: bufonEntry.token }, (res3) => {
                if (!res3.ok) return failB("player:rejoin falló mid-partida: " + res3.error);
              });
            });
            p2.on("role:assigned", (role) => {
              gotRoleAssigned = role.roleId === "bufon";
            });
            p2.on("night:waiting", () => {
              gotNightWaiting = true;
            });

            setTimeout(() => {
              console.log(`Chequeo: reconectado recibió su mismo rol (Bufón): ${gotRoleAssigned ? "OK" : "❌ MAL"}`);
              console.log(`Chequeo: reconectado recibió el estado de la Noche en curso: ${gotNightWaiting ? "OK" : "❌ MAL"}`);
              if (!gotRoleAssigned || !gotNightWaiting) return failB("El rejoin mid-partida no reenvió el estado esperado.");
              bufonRejoined = true;
              pendingActions.forEach((fn) => fn());
              pendingActions.length = 0;
            }, 500);
          }, 300);
        }
      });

      // El resto de la partida sigue normal, pero recién actúa una vez
      // confirmado el rejoin del Bufón, para no resolver la Noche antes de
      // poder chequear su estado reconectado.
      p.on("night:mafiaTurn", ({ isLeader, targets }) => {
        if (!isLeader) return;
        whenReady(() => {
          const victim = targets.find((t) => t.id !== bufonEntry.socketId) || targets[0];
          p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
            if (!res.ok) failB("Mafia no pudo elegir: " + res.error);
          });
        });
      });

      p.on("night:yourTurn", ({ role, targets }) => {
        whenReady(() => {
          if (role === "medico" || role === "detective") {
            p.emit("night:action", { role, targetId: targets[0].id }, (res) => {
              if (!res.ok) failB(`${role} no pudo actuar: ` + res.error);
            });
          }
        });
      });
    });
  });

  screen.on("night:resolved", () => {
    console.log("\n🎉 Fase B (rejoin mid-partida) OK — la Noche se resolvió con normalidad.");
    cleanup(0);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 60000);

runPhaseA(runPhaseB);
