const socket = io();

const params = new URLSearchParams(window.location.search);
const codeFromQr = params.get("code");
if (codeFromQr) {
  document.getElementById("codeInput").value = codeFromQr.toUpperCase();
}

const form = document.getElementById("joinForm");
const errorMsg = document.getElementById("errorMsg");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const code = document.getElementById("codeInput").value.trim().toUpperCase();
  const name = document.getElementById("nameInput").value.trim();

  socket.emit("player:join", { code, name }, (res) => {
    if (!res.ok) {
      errorMsg.textContent = res.error;
      return;
    }
    form.classList.add("hidden");
    document.getElementById("myName").textContent = res.name;
    document.getElementById("waitingRoom").classList.remove("hidden");

    // Guardamos la sesión para el futuro "rejoin" si se corta la conexión
    sessionStorage.setItem("lamafia:code", res.code);
    sessionStorage.setItem("lamafia:name", res.name);
  });
});

// Si el navegador reconecta el socket (ej. wifi que titiló), intenta
// reincorporarse a la misma sala en vez de arrancar de cero.
socket.on("connect", () => {
  const savedCode = sessionStorage.getItem("lamafia:code");
  const savedName = sessionStorage.getItem("lamafia:name");
  if (savedCode && savedName && form.classList.contains("hidden")) {
    socket.emit("player:rejoin", { code: savedCode, name: savedName });
  }
});

function teamLabel(team) {
  if (team === "mafia") return "🐺 Los Lobos";
  if (team === "ciudad") return "🏘️ La Aldea";
  return "🎭 Errante";
}

socket.on("role:assigned", (role) => {
  const waitingRoom = document.getElementById("waitingRoom");
  const accomplicesHtml =
    role.accomplices && role.accomplices.length
      ? `<p class="accomplices">Tus cómplices: <strong>${role.accomplices.join(", ")}</strong></p>`
      : "";

  waitingRoom.classList.remove("hidden");
  waitingRoom.innerHTML = `
    <div class="role-card team-${role.team}">
      <p class="role-team">${teamLabel(role.team)}</p>
      <h2>${role.narrativeName}</h2>
      <p class="role-desc">${role.description}</p>
      ${accomplicesHtml}
    </div>
  `;
});
