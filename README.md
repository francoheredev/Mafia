# La Mafia — Esqueleto técnico (lobby)

Primer paso de código del proyecto, después del GDD. **Todavía no tiene juego** (roles, Día/Noche, votos) — solo valida que la arquitectura de base funcione de punta a punta: una pantalla compartida crea una sala, los celulares se unen escaneando un QR, y todo se sincroniza en vivo.

Es intencional dejarlo así de acotado primero: es mucho más barato descubrir un problema de conexión/arquitectura ahora que una vez que ya haya roles y lógica de juego encima.

## Cómo correrlo

**Opción fácil (Windows): doble click en `iniciar.bat`**

Se encarga de todo automáticamente: revisa si falta Node.js (y te abre la página para instalarlo si hace falta), instala las dependencias la primera vez, prende el servidor, y te abre la pantalla en el navegador. Las próximas veces, con doble click alcanza.

**Opción manual (cualquier sistema):**

```bash
npm install
npm start
```

Con eso el servidor queda escuchando en `http://localhost:3000`. Abrí:

- **Pantalla:** `http://localhost:3000/screen.html` (esto es lo que abrirías en la PC/TV)
- **Celular:** escaneá el QR que aparece en la pantalla, o abrí `http://localhost:3000/player.html` a mano.

Para probarlo con tu celular de verdad (no solo en la misma compu), necesitás que el celular esté en la **misma red WiFi** que la compu, y usar la IP local de la compu en vez de `localhost` (ej. `http://192.168.0.15:3000/player.html`). Podés ver tu IP local con `ipconfig` (Windows) o `ifconfig`/`ip a` (Mac/Linux).

## Test automático

Hay scripts que simulan jugadores conectándose sin necesidad de abrir nada a mano:

```bash
npm start           # en una terminal, dejala corriendo

npm run test:flow    # prueba el lobby: pantalla crea sala + 1 celular se une
npm run test:roles   # prueba con 6 jugadores: arranca la partida y valida que
                      # los roles se repartan bien (incluye chequeo de que los
                      # mafiosos se vean entre sí como cómplices)
```

Si ves "🎉 ..." al final de cada uno, está todo bien.

## Qué decisiones del GDD ya están reflejadas acá

- **Stack:** todo en JavaScript (Node + Socket.IO + HTML/CSS/JS plano), sin Godot — ver sección 5 del GDD.
- **Sin instalar nada:** el celular se une por navegador escaneando un QR.
- **Reconexión "congelada":** si un jugador se desconecta, no se lo borra de la sala — queda marcado como desconectado y puede reincorporarse (`player:rejoin`). La lógica real de "recuperar su mismo rol" queda para cuando se sume el ciclo Noche/Día (está marcada con `TODO` en `server.js`).
- **Asignación de roles (Fase 0 del GDD):** al tocar "Empezar partida" en la pantalla (habilitado con 6-10 jugadores conectados), el servidor sortea el catálogo MVP (`roles.js`) y le manda a cada celular su rol en privado. Los mafiosos ven en su tarjeta a sus cómplices, tal como quedó definido.
  - ⚠️ **Ajuste al GDD:** se agregó un rol "Aldeano" (sin habilidad) que no estaba en el catálogo original — hacía falta para completar el bando Ciudad en partidas de 7+ jugadores, ya que el MVP solo tiene 3 roles Ciudad con habilidad.
  - ⚠️ **Ajuste a la tabla de escalado (sección 6 del GDD):** la tabla original no reservaba un lugar para el Bufón/Independiente — quedó corregida en `roles.js` (ver comentarios ahí).

## Qué falta (próximos pasos, en orden)

1. ~~**Asignación de roles**~~ ✅ hecho — ver arriba.
2. **Ciclo Noche** (Fase 1 del GDD): pantalla en modo "cae la noche", acciones privadas por celular (Mafia con líder rotativo, Vidente, Médico).
3. **Ciclo Día** (Fases 2-6): amanecer, discusión, votación, defensa, juicio.
4. **Condición de victoria**: chequeo de objetivos de Independientes + binario Mafia/Ciudad (ver sección 6 del GDD).
5. Recién ahí: pulir animaciones/arte con la ambientación de aldea de fantasía (sección 3.1 del GDD).

## Estructura

```
la-mafia-lobby/
├── server.js          # servidor Node + Socket.IO (toda la lógica de sala)
├── test-flow.js        # test automático del flujo pantalla+celular
├── package.json
└── public/
    ├── screen.html/js  # pantalla compartida
    ├── player.html/js  # celular del jugador
    └── style.css       # estilos compartidos
```
