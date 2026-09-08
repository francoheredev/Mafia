const { io } = require("socket.io-client");

// Fase A (lobby): un jugador se une, se "cae" (cierra el socket) antes de
// que arranque la partida, y reconecta con el mismo token vía
// player:rejoin. Debería recuperar su lugar sin quedar duplicado —
// idéntico patrón al de Mafia.
// Fase B (mid-ronda, 3 jugadores): las posiciones finales están fijadas a
// mano (no dependen del spawn al azar) para que el resultado del disparo
// sea 100% determinístico: Fede dispara y mata a Juli, Male sobrevive sin
// que nadie le apunte. Fede se desconecta apenas recibe round:yourTurn (sin
// mandar su jugada) y reconecta con el mismo token — debería recibir de
// nuevo round:yourTurn con el MISMO deadline (no uno nuevo) y
// alreadySubmitted:false. Una vez que la ronda resuelve y Juli murió, Juli
// se desconecta y reconecta — debería recibir el marcador explícito de
// espectador (round:spectator), a diferencia de Mafia, donde no hace
// falta porque el celular ya "sabe" que murió.

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

  screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));
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
  const screen = io("http://localhost:3000");
  let roomCode = null;

  const fede = { name: "Fede", socket: null, token: null, id: null, submitted: false };
  const juli = { name: "Juli", socket: null, token: null, id: null, submitted: false };
  const male = { name: "Male", socket: null, token: null, id: null, submitted: false };
  const roster = [fede, juli, male];

  let joinedCount = 0;
  let fedeReconnectChecked = false;
  let juliSpectatorChecked = false;

  function cleanup(code) {
    roster.forEach((p) => p.socket?.close());
    fede.newSocket?.close();
    juli.newSocket?.close();
    screen.close();
    process.exit(code);
  }
  function failB(msg) {
    console.error("❌", msg);
    cleanup(1);
  }

  screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));
  screen.on("screen:created", ({ code }) => {
    roomCode = code;
    console.log("\n✅ [Fase B] Sala creada:", roomCode);

    roster.forEach((entry) => {
      const p = io("http://localhost:3000");
      entry.socket = p;

      p.on("connect", () => {
        p.emit("player:join", { code: roomCode, name: entry.name }, (res) => {
          if (!res.ok) return failB("Error al unirse: " + res.error);
          entry.token = res.token;
          entry.id = p.id;
          joinedCount++;
          if (joinedCount === roster.length) {
            console.log("✅ [Fase B] Los 3 jugadores se unieron. Arrancando partida...");
            screen.emit("game:start", null, (res2) => {
              if (!res2.ok) failB("Error al arrancar: " + res2.error);
            });
          }
        });
      });

      // --- Juli: dispara lejos de todos y no se mueve del punto acordado
      //     (100,0) — va a morir por el disparo de Fede sin importar el
      //     orden en que le toque tirar. ---
      if (entry === juli) {
        p.on("round:yourTurn", () => {
          if (entry.submitted) return;
          entry.submitted = true;
          p.emit("round:submit", { x: 100, y: 0, angle: Math.PI / 2 }, (res) => {
            if (!res.ok) failB("round:submit de Juli falló: " + res.error);
          });
        });
      }

      // --- Male: se queda en (500,500) apuntando lejos — no le pega a
      //     nadie ni nadie le pega a él. ---
      if (entry === male) {
        p.on("round:yourTurn", () => {
          if (entry.submitted) return;
          entry.submitted = true;
          p.emit("round:submit", { x: 500, y: 500, angle: Math.PI / 2 }, (res) => {
            if (!res.ok) failB("round:submit de Male falló: " + res.error);
          });
        });
      }

      // --- Fede: la primera vez que recibe round:yourTurn, en vez de
      //     mandar su jugada, se desconecta (sin submission) y reconecta
      //     con el mismo token — recién ahí manda (0,0) apuntando a
      //     (100,0), directo a donde va a estar Juli. ---
      if (entry === fede) {
        p.on("round:yourTurn", ({ deadline }) => {
          if (fedeReconnectChecked || entry.disconnectedOnce) return;
          entry.disconnectedOnce = true;
          entry.firstDeadline = deadline;
          console.log("✅ [Fase B] Fede recibió round:yourTurn — desconectando antes de mandar jugada...");
          p.close();

          setTimeout(() => {
            const p2 = io("http://localhost:3000");
            fede.newSocket = p2;
            p2.on("connect", () => {
              p2.emit("player:rejoin", { code: roomCode, token: entry.token }, (res3) => {
                if (!res3.ok) return failB("player:rejoin falló mid-ronda (Fede): " + res3.error);
              });
            });
            p2.on("round:yourTurn", ({ deadline: deadline2, alreadySubmitted }) => {
              if (fedeReconnectChecked) return;
              fedeReconnectChecked = true;
              const sameDeadline = deadline2 === entry.firstDeadline;
              const notSubmittedYet = alreadySubmitted === false;
              console.log(`Chequeo: round:yourTurn se reenvía con el MISMO deadline: ${sameDeadline ? "OK" : "❌ MAL"}`);
              console.log(`Chequeo: alreadySubmitted es false (Fede no había mandado nada): ${notSubmittedYet ? "OK" : "❌ MAL"}`);
              if (!sameDeadline || !notSubmittedYet) return failB("El reconnect mid-ronda de Fede no trajo el estado esperado.");

              p2.emit("round:submit", { x: 0, y: 0, angle: 0 }, (res4) => {
                if (!res4.ok) failB("round:submit de Fede (tras reconectar) falló: " + res4.error);
              });
            });
          }, 300);
        });
      }
    });
  });

  screen.on("round:resolved", ({ order, winner }) => {
    const juliEvent = order.find((e) => e.hitId === juli.id);
    const juliDied = Boolean(juliEvent);
    console.log(`Chequeo: Fede (reconectado) le dio a Juli según lo planeado: ${juliDied ? "OK" : "❌ MAL"}`);
    if (!juliDied) return failB("El disparo determinístico de Fede no eliminó a Juli.");

    // Juli ya murió — se desconecta y reconecta para comprobar que un
    // jugador muerto recibe el marcador explícito de espectador.
    juli.socket.close();
    setTimeout(() => {
      const p3 = io("http://localhost:3000");
      juli.newSocket = p3;
      p3.on("connect", () => {
        p3.emit("player:rejoin", { code: roomCode, token: juli.token }, (res) => {
          if (!res.ok) return failB("player:rejoin falló para Juli (muerta): " + res.error);
        });
      });
      p3.on("round:spectator", () => {
        if (juliSpectatorChecked) return;
        juliSpectatorChecked = true;
        console.log("Chequeo: Juli (muerta) reconecta y recibe round:spectator: OK");
        console.log(`Chequeo: la partida sigue (2 vivos, sin ganador todavía): ${winner === null ? "OK" : "❌ MAL"}`);
        console.log("\n🎉 Fase B (reconnect mid-ronda + espectador) OK.");
        cleanup(winner === null ? 0 : 1);
      });
    }, 300);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 20000);

runPhaseA(runPhaseB);
