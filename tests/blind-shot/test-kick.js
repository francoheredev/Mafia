const { io } = require("socket.io-client");

// Fase A (lobby): la pantalla expulsa a un jugador antes de arrancar —
// rama 100% genérica de la plataforma (mismo patrón que Mafia).
// Fase B1 (mid-partida, 2 jugadores): kickear al único rival deja a 1 solo
// en pie — checkWinner tiene que dispararse EN EL ACTO (game:over), sin
// esperar a que la ronda en curso resuelva por su cuenta.
// Fase B2 (mid-partida, 3 jugadores): kickear a uno sin que eso decida la
// partida — la ronda en curso tiene que seguir resolviendo normal, por su
// propio timer, con el kickeado ya excluido del `order`.

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

  screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));
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
    if (!kickRequested || players.length !== 1) return;
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

function runPhaseB1(onDone) {
  const screen = io("http://localhost:3000");
  const NAMES = ["Fede", "Juli"];
  const players = [];
  let joinedCount = 0;
  let gotGameOver = false;
  let gotRoundResolvedAfter = false;

  function cleanup() {
    players.forEach((p) => p.socket.close());
    screen.close();
  }

  screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));
  screen.on("screen:created", ({ code }) => {
    console.log("\n✅ [Fase B1] Sala creada:", code);
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p };
      players.push(entry);
      p.on("connect", () => {
        p.emit("player:join", { code, name }, (res) => {
          if (!res.ok) return fail("Error al unirse: " + res.error);
          entry.id = p.id;
          joinedCount++;
          if (joinedCount === NAMES.length) {
            screen.emit("game:start", null, (res2) => {
              if (!res2.ok) return fail("Error al arrancar: " + res2.error);
            });
          }
        });
      });
    });
  });

  screen.on("round:begin", () => {
    const juli = players.find((p) => p.name === "Juli");
    if (!juli || gotGameOver) return;
    console.log("✅ [Fase B1] Ronda arrancó. Expulsando a Juli (deja a Fede solo en pie)...");
    screen.emit("player:kick", { targetId: juli.id }, (res) => {
      if (!res.ok) fail("player:kick falló mid-partida: " + res.error);
    });
  });

  screen.on("game:over", ({ winner }) => {
    if (gotGameOver) return;
    gotGameOver = true;
    const fede = players.find((p) => p.name === "Fede");
    const winnerOk = winner === fede.id;
    console.log(`Chequeo: game:over dispara EN EL ACTO al quedar 1 solo en pie: OK`);
    console.log(`Chequeo: el ganador es quien quedó en pie (Fede): ${winnerOk ? "OK" : "❌ MAL"}`);

    // Espera más que ROUND_MOVE_MS + REVEAL_MS (acortados por
    // NODE_ENV=test) para confirmar que el timer de la ronda se cortó de
    // verdad — si no, llegaría un round:resolved de más después del final.
    setTimeout(() => {
      console.log(`Chequeo: no llegó ningún round:resolved después del final: ${!gotRoundResolvedAfter ? "OK" : "❌ MAL"}`);
      cleanup();
      if (!winnerOk || gotRoundResolvedAfter) return fail("El kick mid-partida (1 vs 1) no dejó el estado esperado.");
      console.log("\n🎉 Fase B1 (kick deja a 1 solo en pie) OK.");
      onDone();
    }, 1800);
  });

  screen.on("round:resolved", () => {
    if (gotGameOver) gotRoundResolvedAfter = true;
  });
}

function runPhaseB2() {
  const screen = io("http://localhost:3000");
  const NAMES = ["Fede", "Juli", "Male"];
  const players = [];
  let joinedCount = 0;
  let kickSent = false;

  function cleanup(code) {
    players.forEach((p) => p.socket.close());
    screen.close();
    process.exit(code);
  }
  function failB(msg) {
    console.error("❌", msg);
    cleanup(1);
  }

  screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));
  screen.on("screen:created", ({ code }) => {
    console.log("\n✅ [Fase B2] Sala creada:", code);
    NAMES.forEach((name) => {
      const p = io("http://localhost:3000");
      const entry = { name, socket: p, submitted: false };
      players.push(entry);

      p.on("connect", () => {
        p.emit("player:join", { code, name }, (res) => {
          if (!res.ok) return failB("Error al unirse: " + res.error);
          entry.id = p.id;
          joinedCount++;
          if (joinedCount === NAMES.length) {
            screen.emit("game:start", null, (res2) => {
              if (!res2.ok) failB("Error al arrancar: " + res2.error);
            });
          }
        });
      });

      // Fede y Juli se quedan quietos apuntando lejos entre sí (mismo
      // truco geométrico que test-round-resolve.js) — la ronda tiene que
      // resolver sin ninguna muerte, con Male ya afuera.
      if (name === "Fede") {
        p.on("round:yourTurn", () => {
          if (entry.submitted) return;
          entry.submitted = true;
          p.emit("round:submit", { x: 0, y: 0, angle: Math.PI / 2 }, (res) => {
            if (!res.ok) failB("round:submit de Fede falló: " + res.error);
          });
        });
      }
      if (name === "Juli") {
        p.on("round:yourTurn", () => {
          if (entry.submitted) return;
          entry.submitted = true;
          p.emit("round:submit", { x: 100, y: 0, angle: Math.PI / 2 }, (res) => {
            if (!res.ok) failB("round:submit de Juli falló: " + res.error);
          });
        });
      }
    });
  });

  screen.on("round:begin", () => {
    if (kickSent) return;
    const male = players.find((p) => p.name === "Male");
    if (!male) return;
    kickSent = true;
    console.log("✅ [Fase B2] Ronda arrancó. Expulsando a Male (quedan 2 en pie, sigue la partida)...");
    screen.emit("player:kick", { targetId: male.id }, (res) => {
      if (!res.ok) failB("player:kick falló mid-partida: " + res.error);
    });
  });

  screen.on("round:resolved", ({ order, winner }) => {
    const onlyTwoActed = order.length === 2;
    const maleExcluded = !order.some((e) => e.shooterId === players.find((p) => p.name === "Male").id);
    console.log(`Chequeo: la ronda resolvió con normalidad tras el kick (sin trabarse): OK`);
    console.log(`Chequeo: el order excluye al expulsado (solo Fede y Juli): ${onlyTwoActed && maleExcluded ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: la partida sigue (nadie murió esta ronda, sin ganador): ${winner === null ? "OK" : "❌ MAL"}`);

    if (!onlyTwoActed || !maleExcluded || winner !== null) return failB("El kick mid-ronda (sin decidir la partida) no dejó el estado esperado.");
    console.log("\n🎉 Fase B2 (kick mid-ronda, la partida sigue) OK.");
    cleanup(0);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 20000);

runPhaseA(() => runPhaseB1(runPhaseB2));
