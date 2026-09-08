const { io } = require("socket.io-client");

// 7 jugadores (incluye Intendente, sin Bruja/Carnicero/Lycan a esa
// cantidad). Dos fases con salas separadas:
//  A) En la votación de acusación, el Intendente solo (voto = 2) empata con
//     otros dos jugadores votando juntos a otra persona (voto = 1 c/u) —
//     si el Intendente valiera 1 como cualquiera, NO habría empate. Ese
//     empate 2 a 2 dispara la regla de desempate (sorteo entre los
//     empatados, ver resolveVoting en server.js) en vez de "nadie acusado".
//  B) En el veredicto del juicio, el Intendente vota culpable junto a otras
//     2 personas (culpable = 2+1+1 = 4) contra 3 personas que votan
//     inocente (inocente = 3) — si el Intendente valiera 1, sería 3 vs 3 y
//     NO se ejecutaría; con su voto doble, sí se ejecuta.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale"];

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function setupCalmNight(players, byRoleId, fail) {
  // Patrón calmo reutilizado de otros tests: la Mafia ataca a alguien y el
  // Médico lo protege — nadie muere, el test se enfoca en el Día.
  let mafiaTarget = null;
  players.forEach((entry) => {
    const p = entry.socket;
    p.on("night:mafiaTurn", ({ isLeader, targets }) => {
      if (!isLeader || mafiaTarget) return;
      mafiaTarget = targets[0];
      p.emit("night:action", { role: "mafia", targetId: mafiaTarget.id }, (res) => {
        if (!res.ok) fail("Mafia no pudo elegir: " + res.error);
      });
      const medico = byRoleId("medico");
      if (medico?.pendingYourTurn) {
        medico.socket.emit("night:action", { role: "medico", targetId: mafiaTarget.id }, (res) => {
          if (!res.ok) fail("Médico no pudo proteger: " + res.error);
        });
      } else if (medico) {
        medico.pendingProtect = mafiaTarget.id;
      }
    });
    p.on("night:yourTurn", ({ role, targets }) => {
      entry.pendingYourTurn = true;
      if (role === "medico" && entry.pendingProtect) {
        p.emit("night:action", { role: "medico", targetId: entry.pendingProtect }, (res) => {
          if (!res.ok) fail("Médico no pudo proteger: " + res.error);
        });
      }
      if (role === "detective") {
        p.emit("night:action", { role: "detective", targetId: targets[0].id }, (res) => {
          if (!res.ok) fail("Vidente no pudo investigar: " + res.error);
        });
      }
    });
  });
}

function joinAndStart(screen, players, onAllAssigned) {
  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    let joinedCount = 0;
    let assignedCount = 0;
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
        if (assignedCount === NAMES.length) onAllAssigned();
      });
    });
  });
}

// --- Fase A: peso doble en la votación de acusación ---
function runPhaseA(onDone) {
  const screen = io("http://localhost:3000");
  const players = [];
  const byRoleId = (roleId) => players.find((p) => p.role?.roleId === roleId);

  function cleanup() {
    players.forEach((p) => p.socket.close());
    screen.close();
  }

  joinAndStart(screen, players, () => {
    console.log("✅ [Fase A] Roles repartidos.");
    setupCalmNight(players, byRoleId, fail);

    players.forEach((entry) => {
      entry.socket.on("day:yourVote", () => {
        const padrino = byRoleId("padrino");
        const mafioso = byRoleId("mafioso");
        const intendente = byRoleId("intendente");
        let targetId = null;
        if (entry.role.roleId === "detective" || entry.role.roleId === "medico") {
          targetId = padrino.socketId;
        } else if (entry.role.roleId === "intendente") {
          targetId = mafioso.socketId;
        }
        entry.socket.emit("day:vote", { targetId }, (res) => {
          if (!res.ok) fail("No se pudo votar: " + res.error);
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
  screen.on("day:noAccusation", () => fail("Se esperaba que el empate 2 a 2 sorteara a alguien, no 'nadie acusado'."));

  screen.on("day:defense", ({ accused, results }) => {
    const padrino = byRoleId("padrino");
    const mafioso = byRoleId("mafioso");
    const padrinoVotes = results.find((r) => r.id === padrino.socketId)?.votes || 0;
    const mafiosoVotes = results.find((r) => r.id === mafioso.socketId)?.votes || 0;
    const drawnAmongTied = accused.id === padrino.socketId || accused.id === mafioso.socketId;

    console.log(`\nChequeo: 2 votos normales suman 2 (Padrino): ${padrinoVotes === 2 ? "OK" : "❌ MAL (" + padrinoVotes + ")"}`);
    console.log(`Chequeo: el voto solo del Intendente vale 2 (Mafioso): ${mafiosoVotes === 2 ? "OK" : "❌ MAL (" + mafiosoVotes + ")"}`);
    console.log(`Chequeo: el empate 2 a 2 sorteó entre los empatados: ${drawnAmongTied ? "OK (" + accused.name + ")" : "❌ MAL (" + accused.name + ")"}`);

    const allOk = padrinoVotes === 2 && mafiosoVotes === 2 && drawnAmongTied;
    cleanup();
    if (!allOk) return fail("El peso del voto del Intendente o el sorteo del empate no se aplicaron como se esperaba.");
    console.log("\n🎉 Fase A (voto doble en acusación + sorteo en empate) OK.");
    onDone();
  });
}

// --- Fase B: peso doble en el veredicto del juicio ---
function runPhaseB() {
  const screen = io("http://localhost:3000");
  const players = [];
  const byRoleId = (roleId) => players.find((p) => p.role?.roleId === roleId);

  function cleanup(code) {
    players.forEach((p) => p.socket.close());
    screen.close();
    process.exit(code);
  }

  joinAndStart(screen, players, () => {
    console.log("\n✅ [Fase B] Roles repartidos.");
    setupCalmNight(players, byRoleId, fail);

    players.forEach((entry) => {
      // Todos acusan al Cazador para llegar rápido al juicio.
      entry.socket.on("day:yourVote", () => {
        const cazador = byRoleId("cazador");
        const isSelf = entry.role.roleId === "cazador";
        entry.socket.emit("day:vote", { targetId: isSelf ? null : cazador.socketId }, (res) => {
          if (!res.ok) fail("No se pudo votar: " + res.error);
        });
      });

      // Culpable: Intendente + Detective + Médico (2 + 1 + 1 = 4).
      // Inocente: Padrino + Mafioso + Bufón (1 + 1 + 1 = 3).
      entry.socket.on("day:yourVerdict", () => {
        const guiltySide = ["intendente", "detective", "medico"];
        const verdict = guiltySide.includes(entry.role.roleId) ? "guilty" : "innocent";
        entry.socket.emit("day:verdict", { verdict }, (res) => {
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
  screen.on("day:defense", ({ accused }) => {
    if (accused.name !== byRoleId("cazador").name) return fail("No se acusó al Cazador.");
    screen.emit("day:advance", null, (res) => {
      if (!res.ok) fail("No se pudo avanzar de la defensa: " + res.error);
    });
  });

  screen.on("day:resolved", ({ executed, guiltyCount, innocentCount }) => {
    console.log(`\n⚰️ Veredicto: ejecutado=${executed}, culpable=${guiltyCount}, inocente=${innocentCount}`);
    const guiltyOk = guiltyCount === 4; // Intendente(2) + Detective(1) + Médico(1)
    const innocentOk = innocentCount === 3; // Padrino(1) + Mafioso(1) + Bufón(1)
    const executedOk = executed === true;

    console.log(`Chequeo: culpable pesa 4 (Intendente cuenta doble): ${guiltyOk ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: inocente pesa 3: ${innocentOk ? "OK" : "❌ MAL"}`);
    console.log(`Chequeo: se ejecuta (4 > 3; con Intendente=1 sería 3 vs 3, no se ejecutaría): ${executedOk ? "OK" : "❌ MAL"}`);

    const allOk = guiltyOk && innocentOk && executedOk;
    console.log(allOk ? "\n🎉 Fase B (voto doble en el juicio) OK." : "\n❌ Algo falló.");
    cleanup(allOk ? 0 : 1);
  });
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 90000);

runPhaseA(runPhaseB);
