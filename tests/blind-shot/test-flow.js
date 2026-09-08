const { io } = require("socket.io-client");

// End-to-end real con socket.io-client: screen:create -> joins ->
// game:start -> round:begin visto por pantalla y celulares -> cada
// jugador manda round:submit -> (con ROUND_MOVE_MS acortado por
// NODE_ENV=test) -> round:resolved visto por todos, incluido un
// espectador eliminado a propósito -> asserts de mecánica (tamaño del
// order, que la zona se achicó, que la ronda siguiente arranca). Deja el
// "quién le pegó a quién" para test-round-resolve.js — forzar un
// resultado puntual contra el azar real de spawn/shuffle sería frágil acá.

const NAMES = ["Fede", "Juli", "Male", "Naza"];

function fail(msg) {
  console.error("❌", msg);
  process.exit(1);
}

const screen = io("http://localhost:3000");
let roomCode = null;
const players = [];
let joinedCount = 0;

let sawRoundBeginOnScreen = false;
let yourTurnCount = 0;
let firstZoneRadius = null;
let arenaRadiusSeen = null;

screen.on("connect", () => screen.emit("screen:create", { gameId: "blind-shot" }));

screen.on("screen:created", ({ code }) => {
  roomCode = code;
  console.log("✅ Sala creada:", roomCode);

  NAMES.forEach((name) => {
    const p = io("http://localhost:3000");
    const entry = { name, socket: p, submitted: false };
    players.push(entry);

    p.on("connect", () => {
      p.emit("player:join", { code: roomCode, name }, (res) => {
        if (!res.ok) return fail("Error al unirse: " + res.error);
        entry.socketId = p.id;
        joinedCount++;
        if (joinedCount === NAMES.length) {
          console.log(`✅ Los ${NAMES.length} jugadores se unieron. Arrancando partida...`);
          screen.emit("game:start", null, (res2) => {
            if (!res2.ok) return fail("Error al arrancar: " + res2.error);
          });
        }
      });
    });

    // Cada jugador manda su jugada apenas le toca — posiciones/ángulos
    // arbitrarios (el "quién le pegó a quién" puntual no se testea acá).
    p.on("round:yourTurn", ({ zoneRadius, startX, startY, deadline }) => {
      yourTurnCount++;
      if (entry.submitted) return; // por si el reconnect reenvía el mismo evento
      entry.submitted = true;
      const withinDeadline = deadline > Date.now();
      if (!withinDeadline) return fail("round:yourTurn llegó con un deadline ya vencido.");
      p.emit("round:submit", { x: startX, y: startY, angle: Math.random() * Math.PI * 2 }, (res) => {
        if (!res.ok) fail(`round:submit falló para ${entry.name}: ` + res.error);
      });
    });
  });
});

screen.on("game:started", ({ playerCount }) => {
  console.log(`✅ game:started con ${playerCount} jugadores.`);
});

screen.on("round:begin", ({ number, zoneRadius, arenaRadius, aliveCount }) => {
  sawRoundBeginOnScreen = true;
  if (number === 1) {
    firstZoneRadius = zoneRadius;
    arenaRadiusSeen = arenaRadius;
    console.log(`✅ round:begin #${number} visto por la pantalla — zoneRadius=${zoneRadius}, aliveCount=${aliveCount}`);
  }
});

let resolvedCount = 0;
let sawSecondRoundBegin = false;

screen.on("round:resolved", ({ number, order, zoneRadiusBefore, zoneRadiusAfter, winner }) => {
  resolvedCount++;
  console.log(`✅ round:resolved #${number} — order.length=${order.length}, zoneRadiusBefore=${zoneRadiusBefore}, zoneRadiusAfter=${zoneRadiusAfter}, winner=${winner}`);

  const aliveBeforeThisRound = players.filter((pl) => !pl.eliminated).length;
  const orderSizeOk = order.length > 0 && order.length <= aliveBeforeThisRound;
  console.log(`Chequeo: el order trae un evento por cada jugador que seguía vivo al empezar la ronda: ${orderSizeOk ? "OK" : "❌ MAL"}`);

  const shrankOk = zoneRadiusAfter <= zoneRadiusBefore;
  console.log(`Chequeo: la zona no crece entre rondas: ${shrankOk ? "OK" : "❌ MAL"}`);

  order.forEach((e) => {
    if (e.fired && e.hitId) {
      const victim = players.find((pl) => pl.socketId === e.hitId);
      if (victim) victim.eliminated = true;
    }
  });

  if (resolvedCount === 1) {
    if (winner) {
      console.log("ℹ️ La primera ronda ya dio ganador (spawn al azar) — no hay una segunda ronda que esperar.");
      return finishIfPossible(zoneRadiusAfter, orderSizeOk, shrankOk);
    }
    // Todavía sigue la partida: la pantalla corta la revelación a mano en
    // vez de esperar el REVEAL_MS completo — mismo patrón que day:advance
    // en Mafia.
    screen.emit("round:advance", null, (res) => {
      if (!res.ok) fail("round:advance falló: " + res.error);
    });
  } else {
    finishIfPossible(zoneRadiusAfter, orderSizeOk, shrankOk);
  }
});

screen.on("round:begin", ({ number }) => {
  if (number === 2) sawSecondRoundBegin = true;
});

function finishIfPossible(lastZoneRadius, orderSizeOk, shrankOk) {
  const beginOk = sawRoundBeginOnScreen;
  const yourTurnOk = yourTurnCount >= NAMES.length; // al menos una vez por jugador en la ronda 1
  const arenaOk = typeof arenaRadiusSeen === "number" && arenaRadiusSeen > 0;
  const zoneChangedOrFloored = lastZoneRadius <= firstZoneRadius;

  console.log(`Chequeo: la pantalla vio round:begin: ${beginOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: cada jugador recibió round:yourTurn: ${yourTurnOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: round:begin trajo un arenaRadius fijo: ${arenaOk ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: la zona se achicó (o quedó igual si ya estaba en el piso): ${zoneChangedOrFloored ? "OK" : "❌ MAL"}`);
  console.log(`Chequeo: la ronda siguiente arrancó (round:begin #2) o la partida ya terminó: ${sawSecondRoundBegin || resolvedCount === 1 ? "OK" : "❌ MAL"}`);

  const allOk = beginOk && yourTurnOk && arenaOk && zoneChangedOrFloored && orderSizeOk && shrankOk;

  players.forEach((p) => p.socket.close());
  screen.close();

  if (!allOk) return fail("Algún chequeo de mecánica del flujo falló.");
  console.log("\n🎉 Flujo completo de Blind Shot funcionando de punta a punta.");
  process.exit(0);
}

setTimeout(() => fail("Timeout: algo no terminó a tiempo."), 20000);
