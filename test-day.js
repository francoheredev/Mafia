const { io } = require("socket.io-client");

// 10 jugadores (incluye Bruja/Carnicero/Intendente/Lycan): se arma la
// partida, se pasa una noche sin muertes (a propósito, para simplificar
// quién vota en el Día) y se prueba el ciclo Día completo: discusión ->
// votación -> defensa -> juicio -> ejecución.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno", "Sol", "Nico"];

const screen = io("http://localhost:3000");
let roomCode = null;
const players = []; // { name, socket, role, socketId, mafiaTurn, yourTurn }
let joinedCount = 0;
let assignedCount = 0;
let actedMafia = false;
let actedDetective = false;
let actedMedico = false;
let accusedEntry = null;
const actedMafiaPower = new Set();

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
      if (assignedCount === NAMES.length) console.log("✅ Todos los jugadores tienen su rol.");
    });

    // --- Noche 1: que no muera nadie (Médico protege al blanco de la Mafia) ---
    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader || actedMafia) return;
      actedMafia = true;
      const victim = targets[0];
      console.log(`✅ Líder de la Mafia (${entry.name}) ataca a ${victim.name}`);
      p.emit("night:action", { role: "mafia", targetId: victim.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });

      // El Médico lo protege apenas sepamos el blanco (puede llegar antes o
      // después de que el Médico ya esté esperando su turno).
      const medico = byRoleId("medico");
      if (medico?.yourTurn) {
        medico.socket.emit("night:action", { role: "medico", targetId: victim.id }, (res) => {
          if (!res.ok) fail("Médico no pudo proteger: " + res.error);
        });
        actedMedico = true;
      } else if (medico) {
        medico.pendingProtect = victim.id;
      }
    });

    p.on("night:yourTurn", ({ role, targets }) => {
      entry.yourTurn = { role, targets };

      if (role === "medico" && !actedMedico && entry.pendingProtect) {
        actedMedico = true;
        p.emit("night:action", { role: "medico", targetId: entry.pendingProtect }, (res) => {
          if (!res.ok) fail("Médico no pudo proteger: " + res.error);
        });
      }

      if (role === "detective" && !actedDetective) {
        actedDetective = true;
        const someone = targets[0];
        console.log(`✅ El Vidente (${entry.name}) investiga a ${someone.name}`);
        p.emit("night:action", { role: "detective", targetId: someone.id }, (res) => {
          if (!res.ok) fail("Vidente no pudo investigar: " + res.error);
        });
      }
    });

    // Bruja/Carnicero: poder personal además del voto colectivo — hay que
    // usarlo para que la noche se acorte (ver NIGHT_EARLY_RESOLVE_MS en
    // server.js), si no el test espera el NIGHT_TIMEOUT_MS completo.
    p.on("night:mafiaPower", ({ role, targets }) => {
      if (actedMafiaPower.has(entry.socketId)) return;
      actedMafiaPower.add(entry.socketId);
      const target = targets.find((t) => t.id !== entry.socketId) || targets[0];
      p.emit("night:action", { role, targetId: target.id }, (res) => {
        if (!res.ok) fail(`${role} no pudo usar su poder: ` + res.error);
      });
    });

    // --- Día: votan todos por el mismo Aldeano para forzar una acusación
    //     (el propio Aldeano se abstiene, ya que no puede votarse a sí
    //     mismo — así los 10 votos quedan emitidos y resuelve al instante) ---
    p.on("day:yourVote", () => {
      const target = accusedEntry || players.find((x) => x.role?.roleId === "aldeano");
      accusedEntry = target;
      const isSelf = entry.name === target.name;
      p.emit("day:vote", { targetId: isSelf ? null : target.socketId }, (res) => {
        if (!res.ok) fail("No se pudo votar: " + res.error);
      });
    });

    // --- Juicio: todos votan culpable para forzar la ejecución ---
    p.on("day:yourVerdict", () => {
      p.emit("day:verdict", { verdict: "guilty" }, (res) => {
        if (!res.ok) fail("No se pudo votar el veredicto: " + res.error);
      });
    });
  });
});

screen.on("night:begin", ({ number }) => {
  console.log(`✅ Empezó la noche #${number}`);
});

screen.on("night:resolved", ({ deaths, saved }) => {
  console.log(
    `✅ Amaneció sin víctimas (saved=${saved}, muertes=${deaths.length}) — arranca el Día`
  );
  // Simula que la pantalla ya terminó de reproducir su cinemática.
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del amanecer: " + res.error);
  });
});

screen.on("day:discussion", ({ number }) => {
  console.log(`✅ Empezó la discusión del Día #${number} — la pantalla la corta ya mismo`);
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la discusión: " + res.error);
  });
});

screen.on("day:voting", () => {
  console.log("✅ Empezó la votación de acusación");
});

screen.on("day:noAccusation", () => {
  fail("Nadie fue acusado — el test esperaba que todos votaran al mismo Aldeano.");
});

screen.on("day:defense", ({ accused }) => {
  console.log(`✅ Acusado/a: ${accused.name} — la pantalla corta la defensa ya mismo`);
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar de la defensa: " + res.error);
  });
});

screen.on("day:trial", ({ accused }) => {
  console.log(`✅ Empezó el juicio de ${accused.name}`);
});

let sawSecondNight = false;
screen.on("day:resolved", ({ executed, guiltyCount, innocentCount, deaths }) => {
  console.log(`\n⚰️ Veredicto: ejecutado=${executed}, culpable=${guiltyCount}, inocente=${innocentCount}`);

  const executedOk = executed && deaths.length === 1 && deaths[0].name === accusedEntry.name;
  // A propósito, la ejecución YA NO revela el rol (igual que las muertes de
  // noche) — se chequea que ninguno de esos campos venga en el payload.
  const roleHiddenOk =
    executed && !deaths[0]?.narrativeName && !deaths[0]?.roleName && !deaths[0]?.team;

  console.log(`Chequeo: se ejecutó al acusado correcto: ${executedOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: la ejecución NO revela el rol: ${roleHiddenOk ? "OK" : "❌ MAL"}`);

  if (!executedOk || !roleHiddenOk) {
    fail("El resultado del juicio no fue el esperado.");
    return;
  }

  screen.once("night:begin", ({ number }) => {
    sawSecondNight = true;
    console.log(`\n✅ El ciclo volvió a cerrar: arrancó la noche #${number}`);
    console.log("\n🎉 Ciclo de Día funcionando de punta a punta.");
    cleanup(0);
  });

  // Simula que la pantalla ya terminó de reproducir la narrativa del veredicto.
  screen.emit("day:advance", null, (res) => {
    if (!res.ok) fail("No se pudo avanzar del veredicto: " + res.error);
  });
});

// La noche 1 se resuelve apenas actúan todos (ver NIGHT_EARLY_RESOLVE_MS en
// server.js), más los 22s de ROLE_REVEAL_MS antes de que arranque — el resto
// del ciclo Día se corta al instante con day:advance, así que este timeout
// es solo una red de seguridad generosa.
setTimeout(() => {
  if (!sawSecondNight) {
    console.error("❌ Timeout: algo no terminó a tiempo.");
    cleanup(1);
  }
}, 100000);
