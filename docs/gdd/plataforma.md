# La Mafia — Plataforma (GDD)

> GDD general del sitio/hub. Para el diseño de cada juego, ver
> [mafia.md](mafia.md) y [blind-shot.md](blind-shot.md).

## 1. Concepto / Pitch

Un hub de **juegos de fiesta para jugar en persona, en red local**: una
pantalla compartida (PC/TV) hace de tablero, y cada jugador usa su propio
celular como control, sin instalar nada — se une escaneando un QR desde el
navegador. La pantalla y los celulares quedan sincronizados en vivo por
WebSockets. La plataforma no es un juego en sí: es el "esqueleto" (lobby,
reconexión, chat, hub) sobre el que se montan los juegos concretos.

## 2. Arquitectura

El proyecto separa una capa de **plataforma genérica** (no sabe nada de
ningún juego puntual) de los **juegos**, montados como plugins sobre ella:

```
la-mafia-lobby/
├── server.js              # bootstrap: Express, estáticos, require('./games'), listen
├── platform/
│   ├── core/                # rooms.js, registry.js, connection.js, timer.js — genérico
│   └── routes/               # hub.js (GET /, GET /api/games), game-pages.js
├── games/
│   ├── index.js               # único archivo que crece: un require() por juego nuevo
│   ├── mafia/                  # plugin.js, logic.js, roles.js, rules.js
│   └── blind-shot/              # plugin.js, logic.js
└── public/
    ├── hub/                       # selector de juego
    ├── platform/                   # window.Platform: connect/roster/chat/history/rules
    └── games/<juego>/                # screen.html/js, player.html/js, <juego>.css
```

Cada juego se registra con `registerGame({ id, createGameState,
socketHandlers, onReconnect, remapPlayerId, onKick, chatChannels,
staticRoutes, publicDir })` (ver `platform/core/registry.js`). Sumar un
juego nuevo es: una carpeta en `games/<id>/`, una carpeta en
`public/games/<id>/`, y una línea `require("./games/<id>/plugin")` en
`games/index.js` — `platform/` no necesita tocarse.

## 3. Flujo de usuario

1. El anfitrión abre el **hub** (`/`) en la PC/TV y elige un juego.
2. Abre la **pantalla** de ese juego (`/<juego>/screen`), que crea una sala
   y muestra un QR.
3. Cada jugador escanea el QR con su celular (o entra a
   `/<juego>/player` a mano) y se une a la sala con su nombre e ícono.
4. Cuando hay suficientes jugadores conectados, la pantalla arranca la
   partida.
5. Si un jugador se desconecta a mitad de partida, no se lo borra de la
   sala: queda marcado como desconectado y puede reincorporarse
   (`player:rejoin`) — "reconexión congelada".

## 4. Stack tecnológico

- **Backend:** Node.js + Express 4 (routing/estáticos) + Socket.IO 4
  (tiempo real). Sin base de datos: todo el estado vive en memoria por sala
  (`platform/core/rooms.js`).
- **Frontend:** JavaScript vanilla, sin framework y sin build step — HTML/
  CSS/JS servidos como archivos estáticos.
- **Cliente:** la única librería de terceros visible es `QRCode` (para los
  QR de unión); todo lo demás (audio, partículas, canvas) es hecho a mano
  con APIs nativas del navegador (Web Audio API, Canvas 2D, Pointer Events,
  `navigator.vibrate`).
- **Testing:** scripts propios en Node (`tests/`, orquestados por
  `run-tests.js`) que levantan el servidor real y simulan clientes de
  Socket.IO — sin framework de test.
- Todo el código, comentarios y la interfaz están en **español**.

## 5. Catálogo de juegos

| Juego | Género | GDD |
| --- | --- | --- |
| La Mafia | Deducción social (tipo Mafia/Hombres Lobo), Noche/Día por turnos | [mafia.md](mafia.md) |
| Blind Shot | Battle royale simultáneo y "a ciegas", con zona que se achica | [blind-shot.md](blind-shot.md) |

## 6. Convenciones compartidas

- **`window.Platform`** (`public/platform/`): toolkit de cliente compartido
  por todos los juegos — conexión, roster de jugadores, chat, historial de
  eventos de la sala, y el modal de reglas.
- **Audio sintetizado:** ningún juego usa archivos de sonido — todo se
  genera en vivo con Web Audio API (ver, por ejemplo, el disparo de Blind
  Shot o los stingers narrativos de Mafia).
- **Paleta visual:** tema oscuro compartido vía variables CSS de
  `platform.css` (fondo oscuro, acento dorado, rojo para peligro/alertas),
  con iconografía basada en emoji en vez de arte/sprites propios.
- **Identificación de sala:** cada jugador se identifica por su
  `socket.id`, que cambia al reconectar — por eso todo juego implementa el
  hook `remapPlayerId` para "mudar" ese id en su propio estado.

## 7. Roadmap

- Sumar más juegos al hub (cada uno con su propio GDD en esta misma
  carpeta).
- El hub hoy solo muestra el id del juego "prettificado" (`prettifyId` en
  `public/hub/hub.js`) — no hay descripción ni miniatura por juego; se
  podría sumar un título/ícono/descripción propios por juego al registry
  para una tarjeta más rica en el hub.
