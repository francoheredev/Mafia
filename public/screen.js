const socket = io();

socket.on("connect", () => {
  socket.emit("screen:create");
});

socket.on("screen:created", ({ code }) => {
  document.getElementById("roomCode").textContent = code;

  // El QR lleva directo a la página del celular con el código precargado
  const joinUrl = `${window.location.origin}/player.html?code=${code}`;
  new QRCode(document.getElementById("qrcode"), {
    text: joinUrl,
    width: 220,
    height: 220,
  });
});

socket.on("lobby:update", ({ players }) => {
  const list = document.getElementById("playerList");
  const count = document.getElementById("playerCount");

  list.innerHTML = "";
  const connectedPlayers = players.filter((p) => p.connected);
  count.textContent = connectedPlayers.length;

  players.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name + (p.connected ? "" : " (desconectado)");
    li.className = p.connected ? "player online" : "player offline";
    list.appendChild(li);
  });

  const startBtn = document.getElementById("startBtn");
  startBtn.disabled = connectedPlayers.length < 6 || connectedPlayers.length > 10;
});

document.getElementById("startBtn").addEventListener("click", () => {
  const startError = document.getElementById("startError");
  startError.textContent = "";
  socket.emit("game:start", null, (res) => {
    if (!res.ok) startError.textContent = res.error;
  });
});

socket.on("game:started", ({ playerCount }) => {
  document.querySelector(".lobby-screen").innerHTML = `
    <h1>🎭 Roles repartidos</h1>
    <p class="subtitle">${playerCount} jugadores ya tienen su rol en el celular.</p>
    <p class="hint">(Próximo paso a programar: ciclo Noche — Fase 1 del GDD)</p>
  `;
});
