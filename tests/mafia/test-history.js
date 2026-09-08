const { io } = require("socket.io-client");

// 6 jugadores: el historial público tiene que ir creciendo a medida que
// pasan los sucesos (reparto de roles, noche, muerte, día, juicio) y nunca
// debe mencionar ningún nombre de rol — es información pública, no debe
// filtrar nada de lo que la ficción del juego mantiene en secreto.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi"];
const ROLE_NAMES = [
  "Padrino",
  "Mafioso",
  "Bruja",
  "Carnicero",
  "Detective",
  "Vidente",
  "Médico",
  "Curandero",
  "Cazador",
  "Intendente",
  "Lycan",
  "Aldeano",
  "Bufón",
];

const screen = io("http://localhost:3000");
const players = [];
let joinedCount = 0;
const liveEntries = [];

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

screen.on("connect", () => screen.emit("screen:create", { gameId: "mafia" }));
screen.on("history:entry", (entry) => liveEntries.push(entry));

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
    });

    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader) return;
      const detective = byRoleId("detective");
      const target = targets.find((t) => t.id === detective.socketId);
      p.emit("night:action", { role: "mafia", targetId: target.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });
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

    // Todos votan a la misma persona (el Cazador) para forzar una ejecución.
    p.on("day:yourVote", () => {
      const cazador = byRoleId("cazador");
      const isSelf = entry.role.roleId === "cazador";
      p.emit("day:vote", { targetId: isSelf ? null : cazador.socketId }, (res) => {
        if (!res.ok) fail("No se pudo votar: " + res.error);
      });
    });
    p.on("day:yourVerdict", () => {
      p.emit("day:verdict", { verdict: "guilty" }, (res) => {
        if (!res.ok) fail("No se pudo votar el veredicto: " + res.error);
      });
    });
  });
});

screen.on("night:resolved", () => {
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del amanecer: " + res.error);
  });
});
screen.on("day:discussion", () => {
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la discusión: " + res.error);
  });
});
screen.on("day:noAccusation", () => fail("Se esperaba que acusaran al Cazador."));
screen.on("day:defense", () => {
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la defensa: " + res.error);
  });
});

screen.on("day:resolved", () => {
  setTimeout(evaluate, 500);
});

function evaluate() {
  screen.emit("history:get", null, (res) => {
    if (!res.ok) return fail("No se pudo pedir el historial: " + res.error);
    const entries = res.entries;
    console.log(`\nEntradas del historial (${entries.length}):`);
    entries.forEach((e) => console.log(`  ${e.icon} ${e.text}`));

    const grewEnough = entries.length >= 5;
    const matchesLive = entries.length === liveEntries.length;
    const noSecrets = !entries.some((e) => ROLE_NAMES.some((name) => e.text.includes(name)));

    console.log(`\nChequeo: el historial creció con los sucesos (≥5 entradas): ${grewEnough ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: history:get coincide con los history:entry recibidos en vivo: ${matchesLive ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: ninguna entrada menciona un nombre de rol (info secreta): ${noSecrets ? "OK" : "❌ MAL"}`);

    const allOk = grewEnough && matchesLive && noSecrets;
    console.log(allOk ? "\n🎉 Historial funcionando de punta a punta." : "\n❌ Algo falló.");
    cleanup(allOk ? 0 : 1);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 60000);
