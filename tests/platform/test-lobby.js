const { io } = require("socket.io-client");

// Prueba el lobby 100% genérico (screen:create, player:join, lobby:update)
// contra el plugin de prueba (games/__test__/plugin.js) en vez de Mafia —
// si esto pasa sin que la plataforma sepa nada de "test-game", el lobby de
// verdad está desacoplado de cualquier juego en particular.

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

const screen = io("http://localhost:3000");
const player = io("http://localhost:3000");

screen.on("connect", () => screen.emit("screen:create", { gameId: "test-game" }));

screen.on("screen:created", ({ code }) => {
  console.log("✅ Sala creada (plugin de prueba):", code);
  player.emit("player:join", { code, name: "Fede" }, (res) => {
    if (!res.ok) return fail("player:join falló: " + res.error);
    console.log("✅ Celular se unió:", res.name);
  });
});

screen.on("lobby:update", ({ players }) => {
  const ok = players.length === 1 && players[0].name === "Fede" && players[0].connected;
  console.log(`Chequeo: la pantalla ve al jugador en el lobby: ${ok ? "OK" : "❌ MAL"}`);
  screen.close();
  player.close();
  if (!ok) return fail("lobby:update no trajo el estado esperado.");
  console.log("\n🎉 Lobby genérico (plugin de prueba) funcionando de punta a punta.");
  process.exit(0);
});

setTimeout(() => fail("Timeout: algo no disparó el evento esperado."), 5000);
