# La Mafia

Versión jugable del proyecto, después del [GDD de La Mafia](docs/gdd/mafia.md): una pantalla compartida crea una sala, los celulares se unen escaneando un QR, se reparten los roles, y se juega un ciclo completo de Noche (Mafia/Vidente/Médico) y Día (discusión, votación, defensa, juicio) sincronizado en vivo por WebSockets, hasta que se declara un bando ganador.

## Documentación de diseño (GDD)

- [Plataforma / Hub](docs/gdd/plataforma.md)
- [La Mafia](docs/gdd/mafia.md)
- [Blind Shot](docs/gdd/blind-shot.md)

## Cómo correrlo

**Opción fácil (Windows): doble click en `iniciar.bat`**

Se encarga de todo automáticamente: revisa si falta Node.js (y te abre la página para instalarlo si hace falta), instala las dependencias la primera vez, prende el servidor, y te abre la pantalla en el navegador. Las próximas veces, con doble click alcanza.

**Opción manual (cualquier sistema):**

```bash
npm install
npm start
```

Con eso el servidor queda escuchando en `http://localhost:3000`. Abrí:

- **Hub:** `http://localhost:3000/` — selector de juego (hoy solo está La Mafia; a futuro, cada juego nuevo aparece acá solo).
- **Pantalla:** `http://localhost:3000/mafia/screen` (esto es lo que abrirías en la PC/TV) — o entrá desde el hub.
- **Celular:** escaneá el QR que aparece en la pantalla, o abrí `http://localhost:3000/mafia/player` a mano.

Para probarlo con tu celular de verdad (no solo en la misma compu), necesitás que el celular esté en la **misma red WiFi** que la compu, y usar la IP local de la compu en vez de `localhost` (ej. `http://192.168.0.15:3000/mafia/player`). Podés ver tu IP local con `ipconfig` (Windows) o `ifconfig`/`ip a` (Mac/Linux).

## Test automático

Hay scripts que simulan jugadores conectándose sin necesidad de abrir nada a mano:

```bash
npm start           # en una terminal, dejala corriendo

npm run test:flow    # prueba el lobby: pantalla crea sala + 1 celular se une
npm run test:roles   # prueba con 6 jugadores: arranca la partida y valida que
                      # los roles se repartan bien (incluye chequeo de que los
                      # mafiosos se vean entre sí como cómplices)
npm run test:night   # prueba con 10 jugadores: simula una noche completa
                      # (Mafia ataca, Vidente investiga al Padrino y lo ve
                      # inocente, Médico protege a otro jugador, y el Cazador
                      # muere y dispara su venganza)
npm run test:day      # prueba con 10 jugadores: pasa una noche sin víctimas y
                      # simula el ciclo Día completo (discusión, votación,
                      # defensa, juicio con ejecución) hasta que vuelve a
                      # caer la noche siguiente
npm run test:win-ciudad  # prueba con 6 jugadores: ejecuta a toda la Mafia
                      # de a uno por vez hasta que se declara "Gana la
                      # Ciudad" y confirma que el ciclo se frena ahí
npm run test:win-mafia   # prueba con 6 jugadores: la Mafia mata de noche sin
                      # oposición hasta superar en número a los buenos y se
                      # declara "Gana la Mafia"
```

Si ves "🎉 ..." al final de cada uno, está todo bien.

## Qué decisiones del GDD ya están reflejadas acá

- **Stack:** todo en JavaScript (Node + Socket.IO + HTML/CSS/JS plano), sin Godot — ver [sección 5 del GDD](docs/gdd/mafia.md#5-stack-tecnológico).
- **Sin instalar nada:** el celular se une por navegador escaneando un QR.
- **Reconexión "congelada":** si un jugador se desconecta, no se lo borra de la sala — queda marcado como desconectado y puede reincorporarse (`player:rejoin`). La lógica real de "recuperar su mismo rol" queda para cuando se sume el ciclo Noche/Día (está marcada con `TODO` en `server.js`).
- **Asignación de roles ([Fase 0 del GDD](docs/gdd/mafia.md#4-flujo-de-partida)):** al tocar "Empezar partida" en la pantalla (habilitado con 6-10 jugadores conectados), el servidor sortea el catálogo MVP (`roles.js`) y le manda a cada celular su rol en privado. Los mafiosos ven en su tarjeta a sus cómplices, tal como quedó definido.
  - ⚠️ **Ajuste al GDD:** se agregó un rol "Aldeano" (sin habilidad) que no estaba en el catálogo original — hacía falta para completar el bando Ciudad en partidas de 7+ jugadores, ya que el MVP solo tiene 3 roles Ciudad con habilidad. Ver [sección 6.1](docs/gdd/mafia.md#61-catálogo-de-roles-mvp).
  - ⚠️ **Ajuste a la tabla de escalado ([sección 6.2 del GDD](docs/gdd/mafia.md#62-escalado-por-cantidad-de-jugadores)):** la tabla original no reservaba un lugar para el Bufón/Independiente — quedó corregida en `roles.js` (ver comentarios ahí).
- **Ciclo Noche ([Fase 1 del GDD](docs/gdd/mafia.md#4-flujo-de-partida)):** la pantalla entra en modo "cae la noche" con un checklist en vivo y un cronómetro (60s) para que todos decidan. La Mafia elige víctima con **líder rotativo** (rota entre los mafiosos vivos noche a noche; el resto del equipo ve quién decide y espera), el Vidente investiga en privado a un jugador (el Padrino se ve como inocente, tal como define el GDD), y el Médico protege a alguien. Si matan al Cazador, dispara automáticamente contra otro jugador vivo al azar.
- **Ciclo Día ([Fases 2-6 del GDD](docs/gdd/mafia.md#4-flujo-de-partida)):** después del amanecer, la pantalla pasa a **Discusión** (los jugadores debaten en persona, con un cronómetro que la pantalla puede cortar antes con un botón), luego **Votación** (cada celular vota en privado a quién acusar, o se abstiene), **Defensa** (el más votado tiene la palabra, también cortable desde la pantalla) y **Juicio** (el resto vota culpable/inocente en privado; el acusado no vota su propio juicio). Si gana "culpable", se ejecuta. ⚠️ Empates en la votación de acusación **no** dejan el día sin juicio: se sortea entre los empatados, y quien sale sorteado sigue el mismo camino que cualquier acusado (defensa + juicio). Solo si nadie recibió ningún voto, no hay acusación ese día. Después, vuelve a caer la noche.
- **Nadie revela su rol al morir** (ni de noche ni por ejecución en el Juicio) — se descubre discutiendo, nunca lo anuncia el sistema. Es intencional que hoy no haya forma de cambiar esto desde la pantalla; a futuro debería ser una opción configurable por sala.
- **Narrativa cinemática al resolver Noche/Día:** en vez de una frase plana, la pantalla cuenta lo que pasó en varios pasos con pausas (niebla, la Mafia acechando, el ataque nombrando a la víctima si hubo muerte, etc.), y recién al final queda fija la pantalla de resultado. La propia pantalla le avisa al servidor (`day:advance`) cuando terminó de reproducirla, así nunca se pisa con la fase siguiente — los timers de respaldo (`NIGHT_RESULT_MS`/`DAY_RESULT_MS`) solo entran si la pantalla nunca avisa.
- **Ver tu rol en cualquier momento:** cada celular tiene un botón fijo (🎭, esquina superior) que abre tu tarjeta de rol en una ventana superpuesta sin interrumpir lo que estés haciendo — sigue disponible incluso después de que te eliminen.
- **Condición de victoria (binario Mafia/Ciudad):** después de cada muerte (de noche o por ejecución), el servidor chequea si ya ganó algún bando. Gana la Ciudad si no queda ningún mafioso vivo; gana la Mafia si su cantidad supera **estrictamente** a la de los buenos (los Independientes, como el Bufón, cuentan como "buenos" para este chequeo). El Bufón además tiene su propio objetivo, independiente de este chequeo binario: gana si el pueblo lo vota y lo ejecuta durante el Juicio. Si ambos bandos llegan a cero a la vez (venganza en cadena del Cazador), es un empate sin ganador declarado. Al terminar, la pantalla revela el rol de todos (vivos y muertos) y el juego se frena ahí — no cae otra noche. Ver [sección 2 del GDD](docs/gdd/mafia.md#2-objetivo-y-condición-de-victoria).

## Qué falta (próximos pasos, en orden)

1. ~~**Asignación de roles**~~ ✅ hecho — ver arriba.
2. ~~**Ciclo Noche**~~ ✅ hecho — ver arriba.
3. ~~**Ciclo Día**~~ ✅ hecho — ver arriba.
4. ~~**Condición de victoria (binario Mafia/Ciudad + objetivo propio del Bufón)**~~ ✅ hecho — ver arriba.
5. Recién ahí: pulir animaciones/arte con la ambientación de aldea de fantasía ([sección 3.1 del GDD](docs/gdd/mafia.md#31-ambientación)).

## Estructura

El proyecto se reorganizó en una capa de **plataforma** (genérica, sin saber
nada de Mafia — lobby, reconexión, kick, chat, historial, hub) y **La Mafia**
como el primer juego montado sobre ella (`games/mafia/`), para que sumar un
juego nuevo más adelante sea agregar una carpeta, no tocar `platform/`.

```
la-mafia-lobby/
├── server.js              # bootstrap: Express, estáticos, require('./games'), listen
├── run-tests.js            # spawnea el server y corre tests/platform/ + tests/mafia/
├── docs/gdd/                # GDD de la plataforma y de cada juego
├── platform/
│   ├── core/                # rooms.js, registry.js, connection.js (genérico)
│   └── routes/               # hub.js, game-pages.js
├── games/
│   ├── index.js               # registra cada juego (único archivo que crece)
│   ├── mafia/                 # plugin.js, logic.js, roles.js, rules.js
│   └── __test__/               # plugin trivial, solo bajo NODE_ENV=test
├── public/
│   ├── hub/                     # selector de juego
│   ├── platform/                 # window.Platform: roster/chat/history/rules/connect
│   └── games/mafia/               # screen.html/js, player.html/js, mafia.css
├── tests/
│   ├── platform/                   # lobby/reconexión/kick/chat, contra el plugin trivial
│   └── mafia/                       # los tests de juego completo (roles, noche, día, victorias)
└── package.json
```
