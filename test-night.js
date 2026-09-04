const { io } = require("socket.io-client");

// 10 jugadores: 1 Padrino, 2 Mafiosos, 1 Detective, 1 Médico, 1 Cazador, 3 Aldeanos, 1 Bufón.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno", "Sol", "Nico"];

const screen = io("http://localhost:3000");
let roomCode = null;
const players = []; // { name, socket, role, socketId, mafiaTurn, yourTurn, investigateResult }
let joinedCount = 0;
let assignedCount = 0;
let actedMafia = false;
let actedDetective = false;
let actedMedico = false;

function byRoleId(roleId) {
  return players.find((p) => p.role?.roleId === roleId);
}
function byTeam(team) {
  return players.filter((p) => p.role?.team === team);
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
  roomCode = code;
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
          console.log(`✅ Los ${NAMES.length} jugadores se unieron. Arrancando partida...`);
          screen.emit("game:start", null, (res2) => {
            if (!res2.ok) fail("Error al arrancar: " + res2.error);
          });
        }
      });
    });

    p.on("role:assigned", (role) => {
      entry.role = role;
      entry.socketId = p.id;
      assignedCount++;
      if (assignedCount === NAMES.length) onRolesReady();
    });

    p.on("night:mafiaTurn", ({ isLeader, leaderName, targets }) => {
      entry.mafiaTurn = { isLeader, leaderName, targets };
      maybeActMafiaLeader();
    });

    p.on("night:yourTurn", ({ role, targets }) => {
      entry.yourTurn = { role, targets };
      maybeActDetectiveMedico();
    });

    p.on("night:investigateResult", (res) => {
      entry.investigateResult = res;
    });

    p.on("night:resolved", (payload) => onNightResolved(payload));
  });
});

screen.on("night:begin", ({ number }) => {
  console.log(`✅ Empezó la noche #${number}`);
});

function onRolesReady() {
  console.log("✅ Todos los jugadores tienen su rol.");
  console.log("Mafia:", byTeam("mafia").map((p) => p.name));
  console.log("Ciudad:", byTeam("ciudad").map((p) => p.name));
  console.log("Independientes:", byTeam("independiente").map((p) => p.name));
}

function maybeActMafiaLeader() {
  if (actedMafia) return;
  const leader = players.find((p) => p.mafiaTurn?.isLeader);
  if (!leader) return;
  actedMafia = true;

  const cazador = byRoleId("cazador");
  console.log(`\n✅ Líder de la Mafia esta noche: ${leader.name}`);
  console.log(`   → Ataca a ${cazador.name} (Cazador)`);

  leader.socket.emit("night:action", { role: "mafia", targetId: cazador.socketId }, (res) => {
    if (!res.ok) fail("La Mafia no pudo elegir víctima: " + res.error);
  });
}

function maybeActDetectiveMedico() {
  const detective = byRoleId("detective");
  const medico = byRoleId("medico");
  const padrino = byRoleId("padrino");

  if (!actedDetective && detective?.yourTurn?.role === "detective") {
    actedDetective = true;
    console.log(`✅ El Vidente (${detective.name}) investiga a ${padrino.name} (Padrino)`);
    detective.socket.emit(
      "night:action",
      { role: "detective", targetId: padrino.socketId },
      (res) => {
        if (!res.ok) fail("El Vidente no pudo investigar: " + res.error);
      }
    );
  }

  if (!actedMedico && medico?.yourTurn?.role === "medico") {
    actedMedico = true;
    console.log(`✅ El Médico (${medico.name}) protege a ${detective.name} (no al Cazador)`);
    medico.socket.emit(
      "night:action",
      { role: "medico", targetId: detective.socketId },
      (res) => {
        if (!res.ok) fail("El Médico no pudo proteger: " + res.error);
      }
    );
  }
}

function onNightResolved({ number, deaths, saved }) {
  console.log(`\n☀️ Amanece (noche #${number})`);
  console.log(
    "Muertes:",
    deaths.map((d) => d.name),
    "(rol no revelado por el sistema — a propósito)"
  );

  const detective = byRoleId("detective");
  const cazador = byRoleId("cazador");

  const detectiveOk = detective.investigateResult?.isMafia === false; // Padrino se ve inocente
  const cazadorDied = deaths.some((d) => d.name === cazador.name);
  const revengeHappened = deaths.length === 2;

  console.log(`\nChequeo: Vidente vio al Padrino como inocente: ${detectiveOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: murió el Cazador (no lo protegieron): ${cazadorDied ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: venganza del Cazador (murieron 2): ${revengeHappened ? "OK" : "❌ MAL"}`);

  const allOk = detectiveOk && cazadorDied && revengeHappened;
  console.log(allOk ? "\n🎉 Ciclo de Noche funcionando de punta a punta." : "\n❌ Algo falló.");
  cleanup(allOk ? 0 : 1);
}

// El servidor espera ROLE_REVEAL_MS (10s) antes de que caiga la noche, para
// que en el juego real la gente llegue a leer su rol.
setTimeout(() => {
  console.error("❌ Timeout: algo no terminó a tiempo.");
  cleanup(1);
}, 16000);
