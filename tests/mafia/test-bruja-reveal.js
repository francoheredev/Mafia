const { io } = require("socket.io-client");

// 9 jugadores (incluye Bruja): cuando la Bruja usa su poder nocturno, el
// reveal (night:brujaReveal) tiene que llegar a TODA la Mafia viva —
// incluida ella misma — y a NADIE que no sea de la Mafia. No hace falta
// completar la noche entera para probar esto.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno", "Sol"];

const screen = io("http://localhost:3000");
const players = [];
let joinedCount = 0;
let assignedCount = 0;
let mafiaTeamSize = 0;
let mafiaRevealCount = 0;
let violationDetected = false;
let evaluated = false;

function fail(msg) {
  console.error("❌", msg);
  cleanup(1);
}
function cleanup(code) {
  players.forEach((p) => p.socket.close());
  screen.close();
  process.exit(code);
}

screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));
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
          screen.emit("game:start", null, (res2) => {
            if (!res2.ok) return fail("Error al arrancar: " + res2.error);
            screen.emit("day:advance", null, (res3) => {
              if (!res3.ok) fail("No se pudo pasar la intro de roles: " + res3.error);
            });
          });
        }
      });
    });

    p.on("role:assigned", (role) => {
      entry.role = role;
      entry.socketId = p.id;
      assignedCount++;
      if (assignedCount === NAMES.length) {
        mafiaTeamSize = players.filter((x) => x.role.team === "mafia").length;
        console.log(`✅ Roles repartidos. Mafia (${mafiaTeamSize}):`, players.filter((x) => x.role.team === "mafia").map((x) => x.name));
      }
    });

    // La Bruja usa su poder personal apenas le llega — no hace falta que la
    // Mafia también decida a quién matar para probar el secreto del reveal.
    p.on("night:mafiaPower", ({ role, targets }) => {
      if (role !== "bruja") return;
      const target = targets.find((t) => t.id !== entry.socketId) || targets[0];
      console.log(`✅ La Bruja (${entry.name}) revela a ${target.name}`);
      p.emit("night:action", { role: "bruja", targetId: target.id }, (res) => {
        if (!res.ok) return fail("La Bruja no pudo revelar: " + res.error);
        // Da tiempo a que el broadcast llegue a todo el mundo antes de evaluar.
        if (!evaluated) {
          evaluated = true;
          setTimeout(evaluate, 2500);
        }
      });
    });

    p.on("night:brujaReveal", () => {
      if (entry.role.team !== "mafia") {
        violationDetected = true;
        return;
      }
      mafiaRevealCount++;
    });
  });
});

function evaluate() {
  const countOk = mafiaRevealCount === mafiaTeamSize;
  console.log(`\nChequeo: toda la Mafia recibió el reveal (${mafiaRevealCount}/${mafiaTeamSize}): ${countOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: ningún no-mafia recibió el reveal: ${!violationDetected ? "OK" : "❌ MAL"}`);
  const allOk = countOk && !violationDetected;
  console.log(allOk ? "\n🎉 Secreto del reveal de la Bruja funcionando de punta a punta." : "\n❌ Algo falló.");
  cleanup(allOk ? 0 : 1);
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 60000);
