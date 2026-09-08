const { io } = require("socket.io-client");

// Prueba la reconexión 100% genérica contra el plugin de prueba: un
// rejoin en el lobby (antes de "arrancar") no debería disparar
// plugin.onReconnect; uno mid-partida (room.started === true, simulado acá
// con el evento custom test:start del plugin) sí debería.

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

const screen = io("http://localhost:3000");
let roomCode = null;
let token = null;

screen.on("connect", () => screen.emit("screen:create", { gameId: "test-game" }));

screen.on("screen:created", ({ code }) => {
  roomCode = code;
  console.log("✅ Sala creada:", code);
  joinAndDisconnect();
});

function joinAndDisconnect() {
  const p1 = io("http://localhost:3000");
  p1.on("connect", () => {
    p1.emit("player:join", { code: roomCode, name: "Fede" }, (res) => {
      if (!res.ok) return fail("Error al unirse: " + res.error);
      token = res.token;
      p1.close();
      setTimeout(rejoinInLobby, 300);
    });
  });
}

function rejoinInLobby() {
  const p2 = io("http://localhost:3000");
  let gotOnReconnectTooEarly = false;
  p2.on("test:onReconnect", () => {
    gotOnReconnectTooEarly = true;
  });
  p2.on("connect", () => {
    p2.emit("player:rejoin", { code: roomCode, token }, (res) => {
      if (!res.ok) return fail("player:rejoin falló en el lobby: " + res.error);
      console.log("✅ Rejoin aceptado en el lobby:", res.name);
      setTimeout(() => {
        console.log(
          `Chequeo: onReconnect NO se dispara en el lobby (sala sin arrancar): ${
            gotOnReconnectTooEarly ? "❌ MAL" : "OK"
          }`
        );
        p2.close();
        if (gotOnReconnectTooEarly) return fail("onReconnect se disparó antes de tiempo.");
        startThenReconnect();
      }, 300);
    });
  });
}

function startThenReconnect() {
  screen.emit("test:start", null, (res) => {
    if (!res.ok) return fail("test:start falló: " + res.error);
    console.log("✅ Sala 'arrancada' (test:start).");

    const p3 = io("http://localhost:3000");
    let gotOnReconnect = false;
    p3.on("test:onReconnect", () => {
      gotOnReconnect = true;
    });
    p3.on("connect", () => {
      p3.emit("player:rejoin", { code: roomCode, token }, (res2) => {
        if (!res2.ok) return fail("player:rejoin falló mid-partida: " + res2.error);
        setTimeout(() => {
          console.log(`Chequeo: onReconnect del plugin se disparó mid-partida: ${gotOnReconnect ? "OK" : "❌ MAL"}`);
          p3.close();
          screen.close();
          if (!gotOnReconnect) return fail("El hook onReconnect no se disparó.");
          console.log("\n🎉 Reconexión genérica (plugin de prueba) funcionando de punta a punta.");
          process.exit(0);
        }, 300);
      });
    });
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 15000);
