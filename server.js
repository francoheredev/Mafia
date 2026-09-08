// server.js
// Bootstrap del proceso: arma la app de Express, sirve los estáticos,
// registra los juegos (games/index.js) y levanta Socket.IO. No conoce
// reglas de ningún juego en particular — toda esa lógica vive en
// platform/core/ (genérico) y games/<id>/ (por juego); ver el plan de
// migración para el detalle de cómo se llegó a esta forma.

const express = require("express");
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");
const { listGames } = require("./platform/core/registry");
const { attachPluginEvents, attachConnectionHandlers } = require("./platform/core/connection");
const hubRoutes = require("./platform/routes/hub");
const { router: gamePagesRoutes, mountGameStatics } = require("./platform/routes/game-pages");

require("./games"); // se auto-registran vía registerGame(...) al cargar

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// La pantalla abre esta página como "localhost", pero el QR tiene que
// apuntar a una IP a la que los celulares (en la misma red Wi-Fi) puedan
// llegar. Se busca la primera IP LAN no interna de la máquina para armarlo.
app.get("/lan-ip", (req, res) => {
  const interfaces = os.networkInterfaces();
  let lanIp = null;
  for (const ifaceList of Object.values(interfaces)) {
    for (const iface of ifaceList || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        lanIp = iface.address;
        break;
      }
    }
    if (lanIp) break;
  }
  res.json({ lanIp });
});

// Monta las staticRoutes que declaró cada plugin registrado, bajo
// /${gameId}${path} — server.js no sabe qué devuelve cada ruta, solo dónde
// montarla (ver contrato de plugin).
listGames().forEach((plugin) => {
  (plugin.staticRoutes || []).forEach((route) => {
    app.get(`/${plugin.id}${route.path}`, route.handler);
  });
});

// Estáticos por juego (screen.js, *.css, etc.) bajo /games/<id>/.
mountGameStatics(app);

// Hub (GET /, GET /api/games) + páginas por juego (GET /:gameId/screen|player).
app.use(hubRoutes);
app.use(gamePagesRoutes);

io.on("connection", (socket) => {
  // Despacha los eventos custom del juego activo en la sala del socket
  // (game:start, night:action, day:vote, ...) a través del registry.
  attachPluginEvents(io, socket);
  // Lobby, reconexión, kick, chat, historial: 100% genéricos.
  attachConnectionHandlers(io, socket);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`La Mafia (esqueleto) escuchando en http://localhost:${PORT}`);
  console.log(`Hub:       http://localhost:${PORT}/`);
});
