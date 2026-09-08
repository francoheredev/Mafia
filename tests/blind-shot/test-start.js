const { io } = require("socket.io-client");
const { spawnPositions, MIN_PLAYERS, MAX_PLAYERS, ARENA_RADIUS, SPAWN_MARGIN } = (() => {
  const logic = require("../../games/blind-shot/logic");
  // SPAWN_MARGIN no se exporta de logic.js (queda como detalle interno) —
  // se re-declara acá el mismo valor solo para poder chequear el límite
  // superior del spawn sin acoplar el test a un export extra que ningún
  // otro consumidor necesita.
  return { ...logic, SPAWN_MARGIN: 0.9 };
})();

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

// --- Parte A: spawnPositions(count) como función pura, sin sockets ---
function runSpawnUnitTest() {
  const maxR = ARENA_RADIUS * SPAWN_MARGIN;
  const positions = spawnPositions(12);

  const countOk = positions.length === 12;
  console.log(`Chequeo: spawnPositions devuelve la cantidad pedida: ${countOk ? "OK" : "❌ MAL"}`);

  const withinBounds = positions.every((p) => Math.hypot(p.x, p.y) <= maxR + 1e-6);
  console.log(`Chequeo: todas las posiciones caen dentro de ARENA_RADIUS * SPAWN_MARGIN: ${withinBounds ? "OK" : "❌ MAL"}`);

  // No deberían ser todas idénticas (spawn al azar, no todos apilados en el
  // mismo punto) — con 12 puntos al azar, la chance de que coincidan todos
  // es prácticamente nula.
  const allSame = positions.every((p) => p.x === positions[0].x && p.y === positions[0].y);
  console.log(`Chequeo: las posiciones no quedan todas apiladas en el mismo punto: ${!allSame ? "OK" : "❌ MAL"}`);

  if (!countOk || !withinBounds || allSame) fail("spawnPositions no cumple las invariantes esperadas.");
  console.log("✅ [Unit] spawnPositions OK.\n");
}

// --- Parte B: game:start valida cantidad de jugadores conectados ---
function runStartValidationTest(onDone) {
  const screen = io("http://localhost:3000");
  let roomCode = null;

  screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));

  screen.on("screen:created", ({ code }) => {
    roomCode = code;
    console.log("✅ Sala creada:", roomCode);

    // Un solo jugador: menos que MIN_PLAYERS, tiene que rechazar.
    const p1 = io("http://localhost:3000");
    p1.on("connect", () => {
      p1.emit("player:join", { code: roomCode, name: "Fede" }, (res) => {
        if (!res.ok) return fail("Error al unirse: " + res.error);
        screen.emit("game:start", null, (startRes) => {
          const rejected = startRes.ok === false;
          console.log(`Chequeo: game:start rechaza con menos de ${MIN_PLAYERS} jugadores: ${rejected ? "OK" : "❌ MAL"}`);
          p1.close();
          if (!rejected) return fail("game:start no validó el mínimo de jugadores.");
          runEnoughPlayers();
        });
      });
    });
  });

  function runEnoughPlayers() {
    const p2 = io("http://localhost:3000");
    const p3 = io("http://localhost:3000");
    let joined = 0;

    function join(p, name) {
      p.on("connect", () => {
        p.emit("player:join", { code: roomCode, name }, (res) => {
          if (!res.ok) return fail("Error al unirse: " + res.error);
          joined++;
          if (joined === 2) {
            screen.emit("game:start", null, (startRes) => {
              console.log(`Chequeo: game:start acepta con ${MIN_PLAYERS}+ jugadores: ${startRes.ok ? "OK" : "❌ MAL"}`);
              p2.close();
              p3.close();
              screen.close();
              if (!startRes.ok) return fail("game:start rechazó con jugadores suficientes: " + startRes.error);
              console.log("\n🎉 Validación de game:start OK.");
              onDone();
            });
          }
        });
      });
    }
    join(p2, "Juli");
    join(p3, "Male");
  }
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 10000);

runSpawnUnitTest();
runStartValidationTest(() => process.exit(0));
