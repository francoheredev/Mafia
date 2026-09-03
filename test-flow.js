const { io } = require("socket.io-client");

const screen = io("http://localhost:3000");
const player = io("http://localhost:3000");

let roomCode = null;

screen.on("connect", () => screen.emit("screen:create"));

screen.on("screen:created", ({ code }) => {
  roomCode = code;
  console.log("✅ Pantalla creó la sala:", code);
  player.emit("player:join", { code, name: "Fede" }, (res) => {
    console.log("✅ Celular se unió:", res);
    if (!res.ok) process.exit(1);
  });
});

screen.on("lobby:update", ({ players }) => {
  console.log("✅ La pantalla ve la lista actualizada:", players);
  console.log("\n🎉 Flujo completo funcionando de punta a punta.");
  process.exit(0);
});

setTimeout(() => {
  console.error("❌ Timeout: algo no disparó el evento esperado.");
  process.exit(1);
}, 5000);
