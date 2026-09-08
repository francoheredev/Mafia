// Unit tests puros sobre resolveRoundWithOrder — sin sockets, sin server,
// con fixtures armados a mano (mismo criterio que test-roles.js de Mafia:
// sin seed, se aseguran invariantes sobre el resultado real). Corre solo
// contra funciones puras de games/blind-shot/logic.js, así que ni siquiera
// necesita el server arriba (run-tests.js igual lo deja levantado para el
// resto de la carpeta).

const {
  resolveRoundWithOrder,
  checkWinner,
  ZONE_ASPECT,
  ZONE_MIN_HALF_WIDTH,
  ZONE_MIN_HALF_HEIGHT,
  HIT_CORRIDOR_HALF_WIDTH,
} = (() => {
  const logic = require("../../games/blind-shot/logic");
  // HIT_CORRIDOR_HALF_WIDTH no se exporta de logic.js (detalle interno de
  // la fórmula de impacto) — se re-declara acá el mismo valor solo para
  // armar el fixture del "borde exacto del corridor" sin acoplar el test a
  // un export extra que ningún otro consumidor necesita.
  return { ...logic, HIT_CORRIDOR_HALF_WIDTH: 40 };
})();

let failures = 0;
function check(label, ok) {
  console.log(`Chequeo: ${label}: ${ok ? "OK" : "❌ MAL"}`);
  if (!ok) failures++;
}

// Por defecto, un cuadrado bien grande (no la proporción 9:16 real) — a la
// mayoría de estos tests no les importa el aspecto, solo el clamp por eje;
// los que sí dependen de la proporción real (achique + piso) pasan su
// propio `zone`.
function makeRoom(playersSpec, zone = { halfWidth: 1000, halfHeight: 1000 }) {
  const room = { players: {}, gameState: { zone, roundNumber: 1, round: null, players: {} } };
  Object.entries(playersSpec).forEach(([id, spec]) => {
    room.players[id] = { name: spec.name || id, alive: spec.alive !== false, connected: true, icon: "🦊" };
    room.gameState.players[id] = {
      x: spec.x ?? 0,
      y: spec.y ?? 0,
      aim: spec.aim ?? 0,
      submission: spec.submission ?? null,
    };
  });
  return room;
}

// --- 1. Impacto directo elimina ---
(function testDirectHit() {
  const room = makeRoom({
    A: { x: 0, y: 0, submission: { x: 0, y: 0, angle: 0 } }, // apunta a +x, directo a B
    B: { x: 100, y: 0, submission: { x: 100, y: 0, angle: Math.PI } }, // apunta lejos de A
  });
  const { events, winner } = resolveRoundWithOrder(room, ["A", "B"]);
  const aEvent = events.find((e) => e.shooterId === "A");
  check("impacto directo elimina al objetivo", aEvent.fired && aEvent.hitId === "B");
  check("el objetivo eliminado queda alive:false", room.players.B.alive === false);
  check("con 1 solo sobreviviente, gana ese id", winner === "A");
})();

// --- 2. Tiro claramente errado no elimina ---
(function testClearMiss() {
  const room = makeRoom({
    // A y B están sobre el mismo eje X, pero ambos apuntan derecho hacia
    // +y (perpendicular a la línea que los une) — así el perp de cualquier
    // disparo contra el otro queda igual a la separación en X (100),
    // bien por encima del medio-ancho del corridor, sin importar el rango.
    A: { x: 0, y: 0, submission: { x: 0, y: 0, angle: Math.PI / 2 } },
    B: { x: 100, y: 0, submission: { x: 100, y: 0, angle: Math.PI / 2 } },
  });
  const { events, winner } = resolveRoundWithOrder(room, ["A", "B"]);
  const aEvent = events.find((e) => e.shooterId === "A");
  check("tiro errado no pega (hitId null)", aEvent.fired && aEvent.hitId === null);
  check("nadie muere, sigue el juego (winner null)", winner === null);
  check("ambos siguen vivos", room.players.A.alive && room.players.B.alive);
})();

// --- 3. Borde exacto del corridor (perp === HIT_CORRIDOR_HALF_WIDTH) ---
(function testCorridorEdge() {
  const room = makeRoom({
    A: { x: 0, y: 0, submission: { x: 0, y: 0, angle: 0 } }, // apunta a +x
    B: { x: 100, y: HIT_CORRIDOR_HALF_WIDTH, submission: { x: 100, y: HIT_CORRIDOR_HALF_WIDTH, angle: Math.PI } },
  });
  const { events } = resolveRoundWithOrder(room, ["A", "B"]);
  const aEvent = events.find((e) => e.shooterId === "A");
  check("perp exactamente igual al medio-ancho del corridor SÍ impacta (<=)", aEvent.fired && aEvent.hitId === "B");
})();

// --- 4. "Orden importa": A mata a B antes de que le toque a B: el disparo
//        de B (que hubiera alcanzado a C) no sale, y C sobrevive. ---
(function testOrderMatters() {
  const room = makeRoom({
    A: { x: 0, y: 0, submission: { x: 0, y: 0, angle: 0 } }, // apunta a B, directo
    B: {
      x: 100,
      y: 0,
      // Si este disparo saliera, pegaría de lleno en C (misma línea recta,
      // perp 0) — pero B va a estar muerto antes de que le toque tirar.
      submission: { x: 100, y: 0, angle: Math.atan2(200, 200) },
    },
    C: { x: 300, y: 200, submission: { x: 300, y: 200, angle: Math.PI } }, // apunta lejos, no le pega a nadie
  });
  const { events } = resolveRoundWithOrder(room, ["A", "B", "C"]);
  const bEvent = events.find((e) => e.shooterId === "B");
  check("B murió antes de su turno (lo mató A)", room.players.B.alive === false);
  check("el disparo de B (ya muerto) no sale", bEvent.fired === false && bEvent.hitId === null);
  check("C sobrevive pese a estar en la línea de tiro de B", room.players.C.alive === true);
  check("A también sigue vivo (nadie le disparó de vuelta)", room.players.A.alive === true);
})();

// --- 5. Cadena de eliminaciones: A mata a B, y el último en la fila (C,
//        invulnerable por diseño una vez que le toca tirar sin que nadie
//        actúe después) mata a A — quedan 2 muertes en la misma ronda y
//        gana el único sobreviviente. ---
(function testEliminationChainToSoleSurvivor() {
  const room = makeRoom({
    A: { x: 0, y: 0, submission: { x: 0, y: 0, angle: 0 } }, // mata a B
    B: { x: 100, y: 0, submission: { x: 100, y: 0, angle: Math.PI } }, // muere antes de tirar
    C: { x: -100, y: 0, submission: { x: -100, y: 0, angle: 0 } }, // apunta a A (en 0,0), directo
  });
  const { winner } = resolveRoundWithOrder(room, ["A", "B", "C"]);
  check("B murió (disparo de A)", room.players.B.alive === false);
  check("A murió (disparo de C, que tiró último)", room.players.A.alive === false);
  check("C es el único sobreviviente y gana", room.players.C.alive === true && winner === "C");
})();

// --- 6. checkWinner: "draw" cuando no queda nadie en pie. Se prueba
//        directo sobre checkWinner/resolveRoundWithOrder con un fixture ya
//        en 0 vivos (equivalente a "justo se terminó de procesar la
//        cadena de eliminaciones de esta ronda y no sobrevivió nadie") —
//        por diseño, la resolución de UNA sola ronda siempre deja como
//        mínimo un sobreviviente (quien tira último en el orden nunca
//        puede morir en esa misma ronda, porque nadie actúa después), así
//        que el camino real hacia 0 vivos es a través de kicks/rondas
//        sucesivas, no de un único resolveRoundWithOrder — acá se verifica
//        el caso límite de la función en sí. ---
(function testDrawWhenNobodyAlive() {
  const room = makeRoom({ A: { alive: false }, B: { alive: false } });
  check("checkWinner devuelve 'draw' con 0 vivos", checkWinner(room) === "draw");
  const { winner } = resolveRoundWithOrder(room, []);
  check("resolveRoundWithOrder con order vacío también devuelve 'draw'", winner === "draw");
})();

// --- 7. Fórmula de achique + piso: si el achique cae por debajo del piso
//        en cualquiera de los dos ejes, la fórmula sola satura ahí (sin
//        caso especial) — y como ambos ejes achican con el mismo factor y
//        ambos pisos respetan ZONE_ASPECT, los dos saturan en la misma
//        ronda. ---
(function testShrinkFloor() {
  const startZone = { halfHeight: 141, halfWidth: 141 * ZONE_ASPECT }; // 141*0.85=119.85, bajo el piso de 120
  const room = makeRoom(
    {
      A: { x: 0, y: 0, submission: { x: 0, y: 0, angle: Math.PI } },
      B: { x: 50, y: 50, submission: { x: 50, y: 50, angle: Math.PI } },
    },
    startZone
  );
  const { zoneBefore, zoneAfter, winner } = resolveRoundWithOrder(room, ["A", "B"]);
  check("nadie murió esta ronda (ambos apuntan lejos)", winner === null);
  check("zoneBefore es la zona con la que arrancó la ronda", zoneBefore === startZone);
  check("zoneAfter.halfHeight satura en ZONE_MIN_HALF_HEIGHT (120)", zoneAfter.halfHeight === ZONE_MIN_HALF_HEIGHT);
  check("zoneAfter.halfWidth satura en ZONE_MIN_HALF_WIDTH (67.5)", zoneAfter.halfWidth === ZONE_MIN_HALF_WIDTH);
  check("room.gameState.zone quedó actualizado", room.gameState.zone === zoneAfter);
})();

// --- 8. Clamp de un sobreviviente que queda afuera del rectángulo nuevo
//        tras el achique — se lo empuja hasta el borde nuevo, eje por eje
//        (no radialmente: la zona es un rectángulo, no un círculo). ---
(function testSurvivorClamp() {
  const room = makeRoom({
    // Mismo truco que testClearMiss: ambos sobre el eje X, apuntando
    // derecho a +y — así ninguno entra en el corridor del otro sin
    // importar la distancia real que los separa (1800).
    A: { x: 900, y: 0, submission: { x: 900, y: 0, angle: Math.PI / 2 } },
    B: { x: -900, y: 0, submission: { x: -900, y: 0, angle: Math.PI / 2 } },
  }, { halfWidth: 1000, halfHeight: 1000 });
  // halfWidth 1000 -> 850 tras el achique (1000 * 0.85). A quedaba a 900
  // del centro en X, afuera del nuevo halfWidth de 850 — debería
  // clampearse en X; su Y (0) ya estaba adentro, no se toca.
  const { zoneAfter } = resolveRoundWithOrder(room, ["A", "B"]);
  check("el achique da halfWidth 850 (1000 * 0.85)", zoneAfter.halfWidth === 850);
  check("A quedó exactamente en el borde nuevo de X", room.gameState.players.A.x === 850);
  check("A mantuvo su Y (el clamp es por eje, no radial)", room.gameState.players.A.y === 0);
})();

console.log(failures === 0 ? "\n🎉 resolveRoundWithOrder: todas las invariantes OK." : `\n❌ ${failures} chequeo(s) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
