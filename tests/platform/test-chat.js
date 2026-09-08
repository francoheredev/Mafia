const { io } = require("socket.io-client");

// Prueba el chat 100% genérico contra el plugin de prueba, que solo
// declara un canal ("general", abierto a cualquiera). Chequea que ese
// canal funciona de punta a punta y que un canal que el plugin NO declaró
// (ej. "fantasmas", propio de Mafia) se rechaza — la plataforma no debería
// conocer ningún nombre de canal por su cuenta.

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

  const sender = io("http://localhost:3000");
  const receiver = io("http://localhost:3000");
  let joined = 0;

  function join(p, name) {
    p.on("connect", () => {
      p.emit("player:join", { code: roomCode, name }, (res) => {
        if (!res.ok) return fail("Error al unirse: " + res.error);
        joined++;
        if (joined === 2) testChat(sender, receiver);
      });
    });
  }
  join(sender, "Fede");
  join(receiver, "Juli");
});

function testChat(sender, receiver) {
  let received = false;
  receiver.once("chat:message", (msg) => {
    received = msg.channel === "general" && msg.text === "hola desde el plugin de prueba";
  });

  sender.emit("chat:send", { channel: "general", text: "hola desde el plugin de prueba" }, (res) => {
    if (!res.ok) return fail("No se pudo mandar el mensaje: " + res.error);

    setTimeout(() => {
      console.log(`Chequeo: el canal declarado por el plugin ("general") llega: ${received ? "OK" : "❌ MAL"}`);

      sender.emit("chat:send", { channel: "fantasmas", text: "no debería existir acá" }, (res2) => {
        const rejected = res2.ok === false;
        console.log(`Chequeo: un canal que el plugin no declaró es rechazado: ${rejected ? "OK" : "❌ MAL"}`);

        sender.close();
        receiver.close();
        screen.close();
        if (!received || !rejected) return fail("El chat genérico no dejó el estado esperado.");
        console.log("\n🎉 Chat genérico (plugin de prueba) funcionando de punta a punta.");
        process.exit(0);
      });
    }, 400);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 10000);
