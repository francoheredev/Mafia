const { io } = require("socket.io-client");

// 10 jugadores: Padrino, Bruja, Carnicero (mafia), Detective, Médico,
// Cazador, Intendente, Lycan, 1 Aldeano (ciudad), Bufón (independiente).
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno", "Sol", "Nico"];

const screen = io("http://localhost:3000");
let roomCode = null;
const players = []; // { name, socket, role, socketId, mafiaTurn, yourTurn, mafiaPower, investigateResult }
let joinedCount = 0;
let assignedCount = 0;
let actedMafia = false;
let actedDetective = false;
let actedMedico = false;
const actedMafiaPower = new Set();

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

screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));

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

    // Bruja/Carnicero: además del voto colectivo de arriba, tienen un poder
    // personal — hay que usarlo para que la noche se acorte (ver
    // NIGHT_EARLY_RESOLVE_MS en server.js), si no el test se queda
    // esperando el NIGHT_TIMEOUT_MS completo.
    p.on("night:mafiaPower", ({ role, targets }) => {
      if (actedMafiaPower.has(entry.socketId)) return;
      actedMafiaPower.add(entry.socketId);
      const target = targets.find((t) => t.id !== entry.socketId) || targets[0];
      p.emit("night:action", { role, targetId: target.id }, (res) => {
        if (!res.ok) fail(`${role} no pudo usar su poder: ` + res.error);
      });
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

function onNightResolved({ number, deaths, transformations, saved }) {
  console.log(`\n☀️ Amanece (noche #${number})`);
  console.log(
    "Muertes:",
    deaths.map((d) => d.name),
    "(rol no revelado por el sistema — a propósito)"
  );
  if (transformations?.length) {
    console.log("Transformaciones (Lycan sobrevivió):", transformations.map((t) => t.name));
  }

  const detective = byRoleId("detective");
  const cazador = byRoleId("cazador");

  const detectiveOk = detective.investigateResult?.isMafia === false; // Padrino se ve inocente
  const cazadorDied = deaths.some((d) => d.name === cazador.name);
  // La venganza del Cazador es al azar entre TODOS los demás vivos — si le
  // toca al Lycan, no muere: sobrevive y se transforma en Mafia (ver
  // killPlayer en server.js). Cualquiera de los dos desenlaces cuenta como
  // "la venganza ocurrió".
  const revengeHappened = deaths.length === 2 || (deaths.length === 1 && transformations?.length === 1);

  console.log(`\nChequeo: Vidente vio al Padrino como inocente: ${detectiveOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: murió el Cazador (no lo protegieron): ${cazadorDied ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: venganza del Cazador (murió o transformó a alguien más): ${revengeHappened ? "OK" : "❌ MAL"}`);

  const allOk = detectiveOk && cazadorDied && revengeHappened;
  console.log(allOk ? "\n🎉 Ciclo de Noche funcionando de punta a punta." : "\n❌ Algo falló.");
  cleanup(allOk ? 0 : 1);
}

// El servidor espera ROLE_REVEAL_MS (22s) antes de que caiga la noche, y la
// noche se resuelve apenas actúan todos (ver NIGHT_EARLY_RESOLVE_MS en
// server.js) — este timeout es solo una red de seguridad generosa.
setTimeout(() => {
  console.error("❌ Timeout: algo no terminó a tiempo.");
  cleanup(1);
}, 95000);
