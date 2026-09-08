const { io } = require("socket.io-client");

// 8 jugadores (arriba de LOVERS_MIN_PLAYERS). Amante ahora es un rol propio
// que compite por el mismo lugar que Intendente + Lycan (ver
// maybeApplyLovers en roles.js) — sale con una chance del 50%, no siempre.
// Reintenta salas hasta que salga, y entonces valida que: sean exactamente 2
// con roleId "amante", que Intendente/Lycan NO estén esa partida (confirma
// que Amante los reemplazó, no que se sumó), y que ambos se vean mutuamente
// vía role:loverInfo.
const NAMES = ["Fede", "Juli", "Male", "Naza", "Caro", "Tomi", "Vale", "Bruno"];
const MAX_ATTEMPTS = 15;

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

function runAttempt(attempt, onNoLovers, onDone) {
  const screen = io("http://localhost:3000");
  const players = [];
  let joinedCount = 0;
  let assignedCount = 0;
  const loverInfoReceived = []; // { name, socketId, partnerId }

  function cleanup() {
    players.forEach((p) => p.socket.close());
    screen.close();
  }

  screen.on("connect", () => screen.emit("screen:create"));
  screen.on("screen:created", ({ code }) => {
    console.log(`\n✅ [Intento ${attempt}] Sala creada:`, code);
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
        if (assignedCount === NAMES.length) evaluate();
      });

      p.on("role:loverInfo", ({ partner }) => {
        loverInfoReceived.push({ name: entry.name, socketId: entry.socketId, partnerId: partner.id });
      });
    });
  });

  function evaluate() {
    const amanteEntries = players.filter((p) => p.role.roleId === "amante");
    if (amanteEntries.length === 0) {
      console.log(`[Intento ${attempt}] No salió Amante esta vez (50% de chance) — reintentando...`);
      cleanup();
      return onNoLovers();
    }

    // Da un instante a que lleguen los role:loverInfo antes de evaluar.
    setTimeout(() => {
      const exactlyTwo = amanteEntries.length === 2;
      const noIntendenteNiLycan = !players.some((p) => p.role.roleId === "intendente" || p.role.roleId === "lycan");
      const gotLoverInfo = loverInfoReceived.length === 2;
      const mutual =
        gotLoverInfo &&
        loverInfoReceived[0].partnerId === loverInfoReceived[1].socketId &&
        loverInfoReceived[1].partnerId === loverInfoReceived[0].socketId;

      console.log("Amantes (roleId):", amanteEntries.map((p) => p.name));
      console.log(`Chequeo: exactamente 2 jugadores con roleId "amante": ${exactlyTwo ? "OK" : "❌ MAL"}`);
      console.log(`Chequeo: Intendente y Lycan no salieron esta partida (Amante los reemplazó): ${noIntendenteNiLycan ? "OK" : "❌ MAL"}`);
      console.log(`Chequeo: los 2 recibieron role:loverInfo: ${gotLoverInfo ? "OK" : "❌ MAL"}`);
      console.log(`Chequeo: cada uno apunta correctamente al otro: ${mutual ? "OK" : "❌ MAL"}`);

      const allOk = exactlyTwo && noIntendenteNiLycan && gotLoverInfo && mutual;
      cleanup();
      if (!allOk) return fail("Amante como rol propio no se comportó como se esperaba.");
      console.log("\n🎉 Amante como rol propio funcionando de punta a punta.");
      onDone();
    }, 500);
  }
}

function attempt(n) {
  if (n > MAX_ATTEMPTS) return fail(`No salió Amante en ${MAX_ATTEMPTS} intentos (¿LOVERS_CHANCE roto?).`);
  runAttempt(
    n,
    () => attempt(n + 1),
    () => process.exit(0)
  );
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 120000);

attempt(1);
