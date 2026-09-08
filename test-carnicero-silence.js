const { io } = require("socket.io-client");

// 10 jugadores (incluye Carnicero): el jugador que el Carnicero silencia de
// noche no puede votar la acusación del Día siguiente (recibe day:silenced
// en vez de day:yourVote, y un day:vote explícito de su parte es
// rechazado). El silencio dura un solo Día: si el Carnicero silencia a otra
// persona la noche siguiente, la primera vuelve a poder votar normalmente.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno", "Sol", "Nico"];

const screen = io("http://localhost:3000");
const players = [];
let joinedCount = 0;
let assignedCount = 0;
let nightNumber = 0;
let dayNumber = 0;
let carniceroActionCount = 0; // decide el objetivo por conteo propio, no por
// nightNumber (que llega por el socket de la pantalla, en un evento aparte
// del de night:mafiaPower — mejor no asumir el orden relativo entre sockets).
const silencedLog = []; // { day, name }
const votedLog = []; // { day, name }
let sawSilenceRejected = false;

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
      if (assignedCount === NAMES.length) console.log("✅ Roles repartidos.");
    });

    // La Mafia siempre "ataca" al Aldeano, y el Médico lo protege siempre —
    // así nadie muere y el test se queda enfocado en el silencio.
    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader) return;
      const aldeano = byRoleId("aldeano");
      const target = targets.find((t) => t.id === aldeano.socketId);
      p.emit("night:action", { role: "mafia", targetId: target.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });
    });

    p.on("night:yourTurn", ({ role, targets }) => {
      if (role === "medico") {
        const aldeano = byRoleId("aldeano");
        p.emit("night:action", { role: "medico", targetId: aldeano.socketId }, (res) => {
          if (!res.ok) fail("Médico no pudo proteger: " + res.error);
        });
      }
      if (role === "detective") {
        p.emit("night:action", { role: "detective", targetId: targets[0].id }, (res) => {
          if (!res.ok) fail("Vidente no pudo investigar: " + res.error);
        });
      }
    });

    // Bruja: cualquier objetivo sirve, solo hace falta que actúe para que la
    // noche se acorte. Carnicero: noche 1 silencia al Detective, noche 2 al
    // Médico — así se puede probar que el silencio de la noche 1 no dura
    // más de un Día.
    p.on("night:mafiaPower", ({ role, targets }) => {
      if (role === "bruja") {
        const target = targets.find((t) => t.id !== entry.socketId) || targets[0];
        p.emit("night:action", { role: "bruja", targetId: target.id }, (res) => {
          if (!res.ok) fail("Bruja no pudo revelar: " + res.error);
        });
        return;
      }
      if (role === "carnicero") {
        carniceroActionCount++;
        const victim = carniceroActionCount === 1 ? byRoleId("detective") : byRoleId("medico");
        console.log(`✅ [Noche ${nightNumber}] El Carnicero silencia a ${victim.name}`);
        p.emit("night:action", { role: "carnicero", targetId: victim.socketId }, (res) => {
          if (!res.ok) fail("Carnicero no pudo silenciar: " + res.error);
        });
      }
    });

    p.on("day:silenced", () => {
      silencedLog.push({ day: dayNumber, name: entry.name });
      // Defensa en profundidad: aunque el celular no debería ni intentarlo,
      // el servidor tiene que rechazar un day:vote de todos modos.
      p.emit("day:vote", { targetId: null }, (res) => {
        if (res.ok) {
          sawSilenceRejected = false;
          fail("El servidor dejó votar a alguien silenciado.");
        } else {
          sawSilenceRejected = true;
        }
      });
    });

    p.on("day:yourVote", () => {
      votedLog.push({ day: dayNumber, name: entry.name });
      p.emit("day:vote", { targetId: null }, (res) => {
        if (!res.ok) fail("No se pudo votar: " + res.error);
      });
    });

    p.on("day:yourVerdict", () => fail("No se esperaba un juicio en este test."));
  });
});

screen.on("night:begin", ({ number }) => {
  nightNumber = number;
  console.log(`\n✅ Empezó la noche #${number}`);
});

screen.on("night:resolved", () => {
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del amanecer: " + res.error);
  });
});

screen.on("day:discussion", ({ number }) => {
  dayNumber = number;
  console.log(`✅ Empezó el Día #${number}`);
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la discusión: " + res.error);
  });
});

screen.on("day:noAccusation", () => {
  console.log(`✅ Nadie fue acusado el Día #${dayNumber} (a propósito)`);
  if (dayNumber >= 2) {
    evaluate();
    return;
  }
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de 'nadie acusado': " + res.error);
  });
});

function evaluate() {
  const detectiveSilencedDay1 = silencedLog.some((s) => s.day === 1 && s.name === byRoleId("detective").name);
  const medicoSilencedDay2 = silencedLog.some((s) => s.day === 2 && s.name === byRoleId("medico").name);
  const detectiveVotedDay2 = votedLog.some((v) => v.day === 2 && v.name === byRoleId("detective").name);
  const medicoVotedDay1 = votedLog.some((v) => v.day === 1 && v.name === byRoleId("medico").name);

  console.log(`\nChequeo: Detective silenciado el Día 1: ${detectiveSilencedDay1 ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: Médico silenciado el Día 2: ${medicoSilencedDay2 ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: Detective pudo votar de nuevo el Día 2 (el silencio no dura 2 días): ${detectiveVotedDay2 ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: Médico pudo votar el Día 1 (todavía no lo habían silenciado): ${medicoVotedDay1 ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: un day:vote de un silenciado es rechazado por el servidor: ${sawSilenceRejected ? "OK" : "❌ MAL"}`);

  const allOk =
    detectiveSilencedDay1 && medicoSilencedDay2 && detectiveVotedDay2 && medicoVotedDay1 && sawSilenceRejected;
  console.log(allOk ? "\n🎉 Silencio del Carnicero funcionando de punta a punta." : "\n❌ Algo falló.");
  cleanup(allOk ? 0 : 1);
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 90000);
