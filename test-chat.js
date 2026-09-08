const { io } = require("socket.io-client");

// 6 jugadores: se prueba el chat "general" (llega a todos, vivos o no) y el
// chat "fantasmas" (solo entre jugadores ya eliminados — un jugador vivo no
// puede ni mandar ni recibir mensajes de ese canal). Para tener un
// "fantasma" real (no solo desconectado) se deja morir a un jugador de
// verdad en la noche, en vez de usar un kick (el kick desconecta el socket
// del expulsado, así que no serviría para probar que sigue chateando).
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];

const screen = io("http://localhost:3000");
const players = [];
let joinedCount = 0;
let assignedCount = 0;

function byRoleId(roleId) {
  return players.find((p) => p.role?.roleId === roleId);
}
function fail(msg) {
  console.error("❌", msg);
  cleanup(1);
}
function cleanup(code) {
  players.forEach((p) => p.socket.close());
  screen.close();
  process.exit(code);
}

screen.on("connect", () => screen.emit("screen:create"));
screen.on("screen:created", ({ code }) => {
  console.log("✅ Sala creada:", code);
  NAMES.forEach((name) => {
    const p = io("http://localhost:3000");
    const entry = { name, socket: p, role: null };
    players.push(entry);

    p.on("connect", () => {
      p.emit("player:join", { code, name }, (res) => {
        if (!res.ok) return fail("Error al unirse: " + res.error);
        joinedCount++;
        if (joinedCount === NAMES.length) {
          testLobbyGeneralChat();
        }
      });
    });

    p.on("role:assigned", (role) => {
      entry.role = role;
      entry.socketId = p.id;
      assignedCount++;
    });

    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader) return;
      const detective = byRoleId("detective");
      const target = targets.find((t) => t.id === detective.socketId);
      p.emit("night:action", { role: "mafia", targetId: target.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });
      // El Médico se protege a sí mismo a propósito, para que el Detective muera de verdad.
      const medico = byRoleId("medico");
      medico.socket.emit("night:action", { role: "medico", targetId: medico.socketId }, (res) => {
        if (!res.ok) fail("Médico no pudo actuar: " + res.error);
      });
    });

    // El Vidente también tiene que actuar, si no la noche no se acorta
    // (ver NIGHT_EARLY_RESOLVE_MS en server.js) y el test espera de más.
    p.on("night:yourTurn", ({ role, targets }) => {
      if (role === "detective") {
        p.emit("night:action", { role: "detective", targetId: targets[0].id }, (res) => {
          if (!res.ok) fail("Vidente no pudo investigar: " + res.error);
        });
      }
    });
  });
});

// --- Paso 1: chat general funciona desde el lobby, antes de arrancar ---
function testLobbyGeneralChat() {
  console.log(`✅ Los ${NAMES.length} jugadores se unieron. Probando chat general en el lobby...`);
  const [sender, receiver] = players;
  let received = false;
  receiver.socket.once("chat:message", (msg) => {
    received = msg.channel === "general" && msg.text === "hola desde el lobby";
  });
  sender.socket.emit("chat:send", { channel: "general", text: "hola desde el lobby" }, (res) => {
    if (!res.ok) return fail("No se pudo mandar un mensaje general: " + res.error);
    setTimeout(() => {
      console.log(`Chequeo: chat general llega en el lobby: ${received ? "OK" : "❌ MAL"}`);
      if (!received) return fail("El chat general no funcionó en el lobby.");
      startGameForGhostChat();
    }, 500);
  });
}

function startGameForGhostChat() {
  screen.emit("game:start", null, (res) => {
    if (!res.ok) return fail("Error al arrancar: " + res.error);
    screen.emit("day:advance", null, (res3) => {
      if (!res3.ok) fail("No se pudo pasar la intro de roles: " + res3.error);
    });
  });
}

screen.on("night:resolved", ({ deaths }) => {
  const detective = byRoleId("detective");
  const detectiveDied = deaths.some((d) => d.id === detective.socketId);
  console.log(`\nChequeo: el Detective murió de verdad (no un kick): ${detectiveDied ? "OK" : "❌ MAL"}`);
  if (!detectiveDied) return fail("El Detective no murió — no se puede probar el chat de fantasmas.");
  testGhostChat();
});

function testGhostChat() {
  const detective = byRoleId("detective");
  const cazador = byRoleId("cazador"); // sigue vivo

  // Un jugador vivo no puede ni mandar ni pedir el historial de fantasmas.
  cazador.socket.emit("chat:send", { channel: "fantasmas", text: "no debería poder" }, (res) => {
    const aliveRejectedSend = res.ok === false;

    cazador.socket.emit("chat:getHistory", { channel: "fantasmas" }, (res2) => {
      const aliveRejectedHistory = res2.ok === false;

      // Nadie vivo debería recibir un mensaje de fantasmas.
      let leakedToAlive = false;
      players
        .filter((p) => p !== detective)
        .forEach((p) => {
          p.socket.on("chat:message", (msg) => {
            if (msg.channel === "fantasmas") leakedToAlive = true;
          });
        });

      let ghostReceived = false;
      detective.socket.once("chat:message", (msg) => {
        ghostReceived = msg.channel === "fantasmas" && msg.text === "somos fantasmas ahora";
      });

      detective.socket.emit("chat:send", { channel: "fantasmas", text: "somos fantasmas ahora" }, (res3) => {
        const deadCanSend = res3.ok === true;

        setTimeout(() => {
          console.log(`Chequeo: un vivo no puede mandar al chat de fantasmas: ${aliveRejectedSend ? "OK" : "❌ MAL"}`);
          console.log(`Chequeo: un vivo no puede pedir el historial de fantasmas: ${aliveRejectedHistory ? "OK" : "❌ MAL"}`);
          console.log(`Chequeo: un fantasma sí puede mandar al chat de fantasmas: ${deadCanSend ? "OK" : "❌ MAL"}`);
          console.log(`Chequeo: el mensaje de fantasmas le llega al fantasma: ${ghostReceived ? "OK" : "❌ MAL"}`);
          console.log(`Chequeo: el mensaje de fantasmas NO le llega a nadie vivo: ${!leakedToAlive ? "OK" : "❌ MAL"}`);

          const allOk = aliveRejectedSend && aliveRejectedHistory && deadCanSend && ghostReceived && !leakedToAlive;
          console.log(allOk ? "\n🎉 Chat (general + fantasmas) funcionando de punta a punta." : "\n❌ Algo falló.");
          cleanup(allOk ? 0 : 1);
        }, 1000);
      });
    });
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 60000);
