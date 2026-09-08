// platform/core/timer.js
// Cronómetro genérico emitido solo a la pantalla compartida (el celular
// nunca tiene cronómetro, a propósito — ver games/mafia/logic.js y
// games/blind-shot/logic.js). 100% agnóstico de juego: solo usa
// room.screenSocketId, así que cualquier plugin que necesite una cuenta
// regresiva visible en pantalla puede reusarlo tal cual. Promovido acá desde
// games/mafia/logic.js (donde vivía originalmente) cuando Blind Shot lo
// necesitó también — ver plan de migración.

// Reemplaza a un setTimeout simple en las fases que la pantalla muestra con
// cuenta regresiva: además de disparar `onExpire` en el mismo momento que
// un setTimeout de `durationMs` habría disparado, manda un tick por segundo
// con el tiempo restante — solo a la pantalla, que es la única que lo
// muestra. Devuelve un handle de setInterval que se guarda y cancela
// exactamente igual que los setTimeout de siempre (en Node, clearTimeout
// funciona igual sobre un handle de setInterval).
function startTimer(io, roomCode, room, durationMs, onExpire) {
  const deadline = Date.now() + durationMs;
  const tick = () => {
    const secondsLeft = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    io.to(room.screenSocketId).emit("timer:tick", { secondsLeft });
    if (secondsLeft <= 0) {
      clearInterval(handle);
      onExpire();
    }
  };
  const handle = setInterval(tick, 1000);
  tick(); // primer tick inmediato, no esperar 1s a que aparezca el número
  return handle;
}

module.exports = { startTimer };
