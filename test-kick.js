const { io } = require("socket.io-client");

// Fase A (lobby): la pantalla expulsa a un jugador antes de arrancar la
// partida. Debería desaparecer de la sala, recibir "player:kicked", y no
// poder volver a entrar ni siquiera con su token viejo.
// Fase B (mid-partida, 6 jugadores): la pantalla expulsa a un jugador vivo
// (el Bufón, sin efectos secundarios al morir) durante la Noche. Debería
// morir de verdad (removedIds) sin frenar el resto de la partida.

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function runPhaseA(onDone) {
  const screen = io("http://localhost:3000");
  let roomCode = null;
  let targetSocket = null;
  let targetToken = null;
  let gotKicked = false;
  let kickRequested = false;

  function cleanup() {
    screen.close();
    targetSocket?.close();
  }

  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    roomCode = code;
    console.log("✅ [Fase A] Sala creada:", roomCode);

    const p1 = io("http://localhost:3000");
    const p2 = io("http://localhost:3000");
    let joined = 0;

    function join(p, name, onJoined) {
      p.on("connect", () => {
        p.emit("player:join", { code: roomCode, name }, (res) => {
          if (!res.ok) return fail("Error al unirse: " + res.error);
          onJoined(res);
          joined++;
        });
      });
    }

    join(p1, "Fede", () => {});
    join(p2, "Juli", (res) => {
      targetSocket = p2;
      targetToken = res.token;
    });

    p2.on("player:kicked", () => {
      gotKicked = true;
    });

    const check = setInterval(() => {
      if (joined < 2) return;
      clearInterval(check);
      console.log("✅ [Fase A] Ambos se unieron. Expulsando a Juli...");
      kickRequested = true;
      screen.emit("player:kick", { targetId: p2.id }, (res) => {
        if (!res.ok) return fail("player:kick falló: " + res.error);
      });
    }, 50);
  });

  screen.on("lobby:update", ({ players }) => {
    if (!kickRequested || players.length !== 1) return; // ignorá los lobby:update previos al kick
    const onlyFede = players[0]?.name === "Fede";
    console.log(`Chequeo: la sala quedó solo con Fede: ${onlyFede ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: la expulsada recibió player:kicked: ${gotKicked ? "OK" : "❌ MAL"}`);

    const p2b = io("http://localhost:3000");
    p2b.on("connect", () => {
      p2b.emit("player:rejoin", { code: roomCode, token: targetToken }, (res) => {
        const rejected = res.ok === false;
        console.log(`Chequeo: no puede volver a entrar con el token viejo: ${rejected ? "OK" : "❌ MAL"}`);
        p2b.close();
        cleanup();
        if (!onlyFede || !gotKicked || !rejected) return fail("El kick en el lobby no dejó el estado esperado.");
        console.log("\n🎉 Fase A (kick en lobby) OK.");
        onDone();
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
  let bufonWasKicked = false;

  function cleanup(code) {
    players.forEach((p) => p.socket.close());
    screen.close();
    process.exit(code);
  }
  function failB(msg) {
    console.error("❌", msg);
    cleanup(1);
  }

  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    console.log("\n✅ [Fase B] Sala creada:", code);
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p, role: null };
      players.push(entry);

      p.on("connect", () => {
        p.emit("player:join", { code, name }, (res) => {
          if (!res.ok) return failB("Error al unirse: " + res.error);
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
          console.log(`✅ [Fase B] Roles repartidos. Expulsando al Bufón (${bufonEntry.name}) en plena Noche...`);
          screen.emit("player:kick", { targetId: bufonEntry.socketId }, (res) => {
            if (!res.ok) failB("player:kick falló mid-partida: " + res.error);
          });
        }
      });

      p.on("player:kicked", () => {
        if (entry === bufonEntry) bufonWasKicked = true;
      });

      // El resto sigue jugando su Noche con normalidad para confirmar que
      // el kick no la trabó.
      p.on("night:mafiaTurn", ({ isLeader, targets }) => {
        if (!isLeader) return;
        const victim = targets.find((t) => t.id !== bufonEntry?.socketId) || targets[0];
        p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
          if (!res.ok) failB("Mafia no pudo elegir: " + res.error);
        });
      });
      p.on("night:yourTurn", ({ role, targets }) => {
        if (role === "medico" || role === "detective") {
          p.emit("night:action", { role, targetId: targets[0].id }, (res) => {
            if (!res.ok) failB(`${role} no pudo actuar: ` + res.error);
          });
        }
      });
    });
  });

  screen.on("player:removed", ({ removedIds }) => {
    const reallyDied = removedIds.includes(bufonEntry.socketId);
    console.log(`Chequeo: el Bufón expulsado murió de verdad: ${reallyDied ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: la expulsada recibió player:kicked: ${bufonWasKicked ? "OK" : "❌ MAL"}`);
    if (!reallyDied || !bufonWasKicked) return failB("El kick mid-partida no dejó el estado esperado.");
  });

  screen.on("night:resolved", ({ deaths }) => {
    // El Bufón ya murió por el kick (evento player:removed, chequeado
    // arriba) — acá solo confirmamos que la Noche pudo resolverse igual,
    // sin que la expulsión la haya trabado.
    const bufonNotDoubleKilled = !deaths.some((d) => d.id === bufonEntry.socketId);
    console.log(`Chequeo: la Noche se resolvió con normalidad tras el kick: OK`);
    console.log(`Chequeo: el Bufón no vuelve a aparecer como muerto de la Noche (ya lo mató el kick): ${bufonNotDoubleKilled ? "OK" : "❌ MAL"}`);
    console.log(bufonNotDoubleKilled ? "\n🎉 Fase B (kick mid-partida) OK." : "\n❌ Algo falló.");
    cleanup(bufonNotDoubleKilled ? 0 : 1);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 60000);

runPhaseA(runPhaseB);
