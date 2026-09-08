const { io } = require("socket.io-client");

const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];

const screen = io("http://localhost:3000");
let roomCode = null;
const players = [];
let joinedCount = 0;
let assignedCount = 0;

function finishIfDone() {
  if (assignedCount === NAMES.length) {
    console.log("\n🎉 Todos los jugadores recibieron su rol.");

    const mafiaNames = players.filter((p) => p.role.team === "mafia").map((p) => p.name);
    const ciudadNames = players.filter((p) => p.role.team === "ciudad").map((p) => p.name);
    const indepNames = players.filter((p) => p.role.team === "independiente").map((p) => p.name);

    console.log("Mafia:", mafiaNames);
    console.log("Ciudad:", ciudadNames);
    console.log("Independientes:", indepNames);

    // Chequeo: cada mafioso debería listar exactamente a los OTROS mafiosos como cómplices
    const mafiaPlayers = players.filter((p) => p.role.team === "mafia");
    let mafiaOk = true;
    mafiaPlayers.forEach((p) => {
      const expected = mafiaPlayers.filter((x) => x.name !== p.name).map((x) => x.name).sort();
      const got = [...(p.role.accomplices || [])].sort();
      const match = JSON.stringify(expected) === JSON.stringify(got);
      console.log(
        `  ${p.name} (mafia) ve como cómplices a [${got.join(", ")}] — ${match ? "OK" : "❌ MAL"}`
      );
      if (!match) mafiaOk = false;
    });

    const totalOk = mafiaNames.length === 2 && ciudadNames.length === 3 && indepNames.length === 1;
    console.log(
      `\nTotales esperados para 6 jugadores (Mal=2, Bien=3, Indep=1): ${
        totalOk ? "OK" : "❌ MAL"
      }`
    );

    players.forEach((p) => p.socket.close());
    screen.close();
    process.exit(mafiaOk && totalOk ? 0 : 1);
  }
}

screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));

screen.on("screen:created", ({ code }) => {
  roomCode = code;
  console.log("✅ Sala creada:", code);

  NAMES.forEach((name) => {
    const p = io("http://localhost:3000");
    players.push({ name, socket: p, role: null });

    p.on("connect", () => {
      p.emit("player:join", { code, name }, (res) => {
        if (!res.ok) {
          console.error("❌ Error al unirse:", res.error);
          process.exit(1);
        }
        joinedCount++;
        if (joinedCount === NAMES.length) {
          console.log(`✅ Los ${NAMES.length} jugadores se unieron. Arrancando partida...`);
          screen.emit("game:start", null, (res2) => {
            if (!res2.ok) {
              console.error("❌ Error al arrancar:", res2.error);
              process.exit(1);
            }
          });
        }
      });
    });

    p.on("role:assigned", (role) => {
      const entry = players.find((x) => x.socket === p);
      entry.role = role;
      assignedCount++;
      finishIfDone();
    });
  });
});

setTimeout(() => {
  console.error("❌ Timeout: algo no terminó a tiempo.");
  process.exit(1);
}, 8000);
