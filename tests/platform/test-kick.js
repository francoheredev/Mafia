const { io } = require("socket.io-client");

// Prueba el kick 100% genérico contra el plugin de prueba: en el lobby lo
// resuelve la plataforma sola (borra al jugador, sin ningún hook de por
// medio); mid-partida delega en plugin.onKick — acá comprobamos que ESE
// hook realmente se invoca y que su resultado (player:removed) llega.

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

const screen = io("http://localhost:3000");
let roomCode = null;

screen.on("connect", () => screen.emit("screen:create", { gameId: "test-game" }));

screen.on("screen:created", ({ code }) => {
  roomCode = code;
  console.log("✅ Sala creada:", code);
  runLobbyKick();
});

function runLobbyKick() {
  const p1 = io("http://localhost:3000");
  let gotKicked = false;
  p1.on("player:kicked", () => {
    gotKicked = true;
  });
  p1.on("connect", () => {
    p1.emit("player:join", { code: roomCode, name: "Fede" }, (res) => {
      if (!res.ok) return fail("Error al unirse: " + res.error);
      screen.emit("player:kick", { targetId: p1.id }, (res2) => {
        if (!res2.ok) return fail("player:kick falló (lobby): " + res2.error);
        setTimeout(() => {
          console.log(`Chequeo: la expulsada del lobby recibió player:kicked: ${gotKicked ? "OK" : "❌ MAL"}`);
          if (!gotKicked) return fail("El kick en el lobby no notificó al expulsado.");
          console.log("✅ [Fase A] Kick en el lobby (rama genérica de la plataforma) OK.");
          runMidGameKick();
        }, 300);
      });
    });
  });
}

function runMidGameKick() {
  const p2 = io("http://localhost:3000");
  p2.on("connect", () => {
    p2.emit("player:join", { code: roomCode, name: "Juli" }, (res) => {
      if (!res.ok) return fail("Error al unirse (fase B): " + res.error);
      screen.emit("test:start", null, (res2) => {
        if (!res2.ok) return fail("test:start falló: " + res2.error);

        screen.once("player:removed", ({ removedIds }) => {
          const removed = removedIds.includes(p2.id);
          console.log(`Chequeo: plugin.onKick sacó al jugador (player:removed): ${removed ? "OK" : "❌ MAL"}`);
          p2.close();
          screen.close();
          if (!removed) return fail("El hook onKick no dejó el estado esperado.");
          console.log("\n🎉 Kick genérico (plugin de prueba) funcionando de punta a punta.");
          process.exit(0);
        });

        screen.emit("player:kick", { targetId: p2.id }, (res3) => {
          if (!res3.ok) fail("player:kick falló mid-partida: " + res3.error);
        });
      });
    });
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 10000);
