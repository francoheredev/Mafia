# Blind Shot (GDD)

> Segundo juego de la plataforma — sin GDD previo, así que la numeración de
> este documento es libre (a diferencia de [mafia.md](mafia.md), que
> respeta secciones ya citadas en el código). Ver también el
> [GDD de la plataforma](plataforma.md).

## 1. Concepto / Pitch

Battle royale simultáneo y **"a ciegas"**: en cada ronda, todos los
jugadores vivos mueven y apuntan en privado desde su celular, sin ver a los
demás — recién al cerrar la ronda se revelan juntas todas las posiciones y
los disparos. Una zona rectangular que se va achicando ronda a ronda fuerza
el enfrentamiento. Gana el último en pie.

## 2. Objetivo y condición de victoria

- **Gana** el único jugador que sigue vivo al resolverse una ronda.
- **Empate** si una cadena de eliminaciones deja a 0 jugadores vivos en la
  misma ronda (`checkWinner` en `logic.js`, mismo criterio que la venganza
  del Cazador en Mafia).
- Mínimo 2 y máximo 16 jugadores por partida (`MIN_PLAYERS`/`MAX_PLAYERS`).

## 3. Loop de ronda

1. **Movimiento a ciegas** (20s reales; 800ms en tests): cada celular es un
   `<canvas>` con Pointer Events como control dual-touch — el primer dedo
   es un joystick flotante para moverse dentro de la zona vigente, el
   segundo dedo apunta libremente (se ve un láser con el ángulo actual).
   Soltar el dedo de puntería no borra el ángulo: queda "vivo" para la
   próxima ronda. Nadie ve al resto de los jugadores durante esta fase — ni
   siquiera la pantalla dibuja sus posiciones.
2. **Disparo obligatorio:** todo jugador vivo dispara en cada ronda, tenga
   o no una puntería explícita esta vez. Si nunca tocó el segundo dedo, el
   ángulo se resuelve con una cadena de respaldo (`resolveAim`): (a) ángulo
   explícito si mandó uno, (b) dirección de movimiento si se movió más de
   un umbral mínimo, (c) el último ángulo conocido (0 en su primera ronda).
3. **Resolución** (`resolveRoundWithOrder`): se sortea un orden aleatorio
   entre los jugadores vivos al empezar la ronda. En ese orden, cada
   disparo se resuelve como un rayo con un **corredor de ancho fijo**
   (40 unidades a cada lado de la línea de puntería, no una tolerancia
   angular — una tolerancia angular sería trivial a rango largo e
   imposible de cerca): entre los objetivos dentro del corredor, impacta al
   más cercano en la línea de tiro. Si a un jugador lo matan antes de que
   le toque disparar en este orden, su disparo no sale (muertes
   encadenadas posibles en la misma ronda).
4. **Revelación** (8s reales; 300ms en tests): se muestran primero todas las
   posiciones finales a la vez, y después los disparos se reproducen en
   secuencia.
5. **Achique de zona:** si no hay ganador todavía, la zona se achica un
   factor fijo (0.85×) en ambos ejes por igual (con un piso mínimo por eje
   que respeta la misma proporción, así nunca se deforma), y cualquier
   sobreviviente que haya quedado afuera del nuevo rectángulo es empujado
   hacia adentro. Vuelve a la fase 1.

La pantalla puede cortar antes de tiempo la espera de la revelación
(`round:advance`) y pasar ya a la próxima ronda; a diferencia de Mafia, el
movimiento nunca se corta antes de tiempo aunque todos ya hayan mandado su
jugada — el diseño es que dura siempre los 20s completos.

## 4. La zona

Es un **rectángulo**, no un círculo — decisión tomada después de probarlo,
a pedido explícito del usuario, para que ocupe toda la pantalla del
celular en vertical. Mantiene siempre la proporción 9:16 (`ZONE_ASPECT`) de
una pantalla de celular, tanto en el tamaño inicial del arena como en cada
achique y en su piso mínimo.

## 5. Controles / input

- **Primer dedo (mover):** joystick flotante que aparece donde se apoya el
  dedo, limitado a la zona vigente.
- **Segundo dedo (apuntar):** ángulo libre en 360°, mostrado con un láser
  rojo (`#ff3b3b`) siempre visible mientras se sostiene.
- El servidor nunca confía en el clamp del cliente: siempre re-clampea la
  posición recibida a la zona vigente antes de guardarla
  (`round:submit` en `plugin.js`).

## 6. Presentación en pantalla

- **Marcadores:** cada jugador se dibuja con el ícono que eligió al unirse
  (no un punto genérico), tanto en el mini-mapa del celular como en la
  arena de la pantalla compartida.
- **Coreografía de la revelación:** primero se muestran todas las
  posiciones finales a la vez (pausa de 1.6s — "así quedaron parados", a
  pedido del usuario), y recién después los disparos se reproducen uno por
  uno (cadencia de 1.1s) con un flash en el ícono del tirador, la línea del
  láser hasta el punto exacto de impacto, y los objetivos eliminados
  pasando a 30% de opacidad.
- **Partículas** (sistema propio, sin librería): ráfaga de fogonazo (cono
  angosto en torno al ángulo de puntería, tonos naranja/amarillo) en el
  tirador, y ráfaga de impacto (omnidireccional, roja) en el punto de
  impacto — con fricción/desvanecimiento frame a frame.
- **Sonido de disparo sintetizado** (Web Audio, sin archivos de audio): un
  "crack" de ruido filtrado (pasabanda ~1800Hz) junto con un "thump" de
  onda senoidal descendente (140Hz → 40Hz) — misma filosofía de síntesis
  que los stingers narrativos de Mafia.
- **Zona:** se dibuja el contorno completo del arena (tenue) y el
  rectángulo de la zona vigente resaltado en dorado, achicándose ronda a
  ronda.

## 7. UI/UX

- **Chat:** un único canal "general", abierto a todos los conectados en
  todo momento — a diferencia de Mafia, acá no hay bandos secretos: un
  jugador eliminado pasa a ser espectador de la misma conversación.
- **Espectadores:** al reconectar, un jugador ya eliminado recibe
  `round:spectator` en vez de estado de juego.
- **Tutorial in-app:** modal de reglas con 5 secciones cortas (movimiento a
  ciegas, joystick, puntería, disparo obligatorio, zona que se achica).

## 8. Stack técnico

Mismo stack que el resto de la plataforma (ver
[GDD de la plataforma, sección 4](plataforma.md#4-stack-tecnológico)): Node
+ Socket.IO en el servidor, canvas + Pointer Events en el cliente, sin
librerías extra más allá del `QRCode` heredado del hub. Toda la simulación
de ronda (`resolveRoundWithOrder`) es pura (no toca `io` ni sockets), lo
que permite testearla con fixtures armados a mano en
`tests/blind-shot/test-round-resolve.js`.

## 9. Roadmap

No hay todavía una lista de pendientes documentada para este juego (a
diferencia de Mafia). Completar esta sección a medida que surjan próximos
pasos.
