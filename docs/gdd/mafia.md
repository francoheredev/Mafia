# La Mafia (GDD)

> Numeración de secciones alineada a las referencias que ya existen en el
> código (`roles.js`, `logic.js`, `plugin.js`, README) — por ejemplo
> "sección 6 del GDD" o "Fase 1 del GDD" apuntan a las secciones de acá.
> Ver también el [GDD de la plataforma](plataforma.md).

## 1. Concepto / Pitch

Juego de deducción social tipo Mafia/Hombres Lobo, jugado en persona: una
pantalla compartida hace de narrador/tablero y cada jugador tiene un rol
secreto que gestiona desde su celular. De noche, la Mafia elige en secreto a
quién eliminar mientras el resto de roles con poder actúa en privado; de
día, todo el pueblo discute en voz alta, acusa y juzga. Nadie sabe con
certeza quién es quién — se descubre (o no) discutiendo.

## 2. Objetivo y condición de victoria

Chequeo binario Mafia/Ciudad, evaluado después de cada muerte (de noche o
por ejecución):

- **Gana la Ciudad** si ya no queda ningún mafioso vivo.
- **Gana la Mafia** si su cantidad supera **estrictamente** a la del resto
  (los Independientes, como el Bufón, cuentan como "buenos" para este
  chequeo).
- **Empate** si ambos bandos llegan a cero jugadores a la vez (posible por
  la venganza en cadena del Cazador).
- Al terminar, la pantalla revela el rol de todos (vivos y muertos).

El **Bufón** además tiene su propia forma de ganar, independiente del
chequeo binario: **gana solo si el pueblo lo vota y lo ejecuta durante el
Juicio** (`resolveTrial` en `logic.js`) — no importa qué bando iba ganando
en ese momento.

## 3. Ambientación y narrativa

### 3.1 Ambientación

Reskin narrativo de aldea de fantasía: la Mafia se presenta como una manada
de **Hombres Lobo** (Padrino → "Lobo Alfa" 🐺, Mafioso → "Hombre Lobo" 🐾),
y el resto de los roles tiene su propio nombre narrativo además del
técnico (ver tabla de roles, sección 6.1). La pantalla narra cada
resolución de Noche/Día en varios pasos con pausas — niebla, la mafia
acechando, el nombre de la víctima si hubo muerte — en vez de un resultado
plano, antes de dejar fija la pantalla de resultado.

Pendiente: pulir animaciones/arte específicos de esta ambientación (ver
sección 8, Roadmap).

## 4. Flujo de partida

Ciclo Noche → Día que se repite hasta que se declara un bando ganador:

- **Fase 0 — Asignación de roles:** al tocar "Empezar partida" en la
  pantalla (habilitado con 6-10 jugadores conectados), el servidor sortea
  el catálogo de roles (sección 6) y le manda a cada celular su rol en
  privado. Los mafiosos ven en su tarjeta a sus cómplices.
- **Fase 1 — Noche:** la pantalla entra en modo "cae la noche" con
  cronómetro (60s). La Mafia elige víctima con **líder rotativo** (rota
  entre los mafiosos vivos noche a noche — el resto del equipo ve quién
  decide y puede sugerir, pero no es vinculante); el Detective/Vidente
  investiga en privado a un jugador (el Padrino se ve como inocente); el
  Médico protege a alguien. Si la Mafia tiene Bruja o Carnicero, actúan
  además con su poder propio (ver sección 6.1). Si matan al Cazador,
  dispara automáticamente contra otro jugador vivo al azar. Una vez que
  actuaron todos los que tenían algo para hacer, la noche se acorta a un
  margen corto en vez de esperar el timeout completo.
- **Fase 2 — Amanecer:** se resuelve la noche (muerte o "nadie murió"/
  "el Médico llegó a tiempo") y se chequea la condición de victoria antes
  de seguir.
- **Fase 3 — Discusión:** el pueblo debate en voz alta mirando la pantalla
  compartida, con un cronómetro (60s por defecto) que la pantalla puede
  cortar antes con un botón.
- **Fase 4 — Votación:** cada celular vota en privado a quién acusar, o se
  abstiene (30s). Si hay empate entre los más votados, **se sortea entre
  los empatados** — el sorteado sigue el mismo camino que cualquier
  acusado (no hay eliminación directa por empate). Solo si nadie recibió
  ningún voto, no hay acusación ese día.
- **Fase 5 — Defensa:** el acusado (por votos o por sorteo) tiene la
  palabra frente a toda la sala; también cortable desde la pantalla (30s
  por defecto).
- **Fase 6 — Juicio:** el resto vota culpable/inocente en privado (30s);
  el acusado no vota su propio juicio. Si "culpable" supera a "inocente",
  se ejecuta. **Nadie revela su rol al morir** (ni de noche ni por
  ejecución) — el sistema nunca lo anuncia, se descubre discutiendo. Si no
  hay ganador todavía, vuelve a caer la noche (Fase 1).

La pantalla le avisa al servidor (`day:advance`) apenas termina de mostrar
su narrativa, así nunca se pisa con la fase siguiente — hay timers de
respaldo (`NIGHT_RESULT_MS`/`DAY_RESULT_MS`) que solo entran si la pantalla
nunca avisa.

## 5. Stack tecnológico

Todo en JavaScript: Node + Socket.IO en el servidor, HTML/CSS/JS plano en
el cliente — sin motor de juego (Godot u otro) ni build step. Ver el
detalle completo del stack, compartido con toda la plataforma, en el
[GDD de la plataforma, sección 4](plataforma.md#4-stack-tecnológico).

## 6. Roles

### 6.1 Catálogo de roles (MVP)

10 roles, cada uno con nombre técnico, nombre narrativo (sección 3.1) e
ícono. Los mafiosos se conocen entre sí desde la Fase 0.

| Rol | Narrativo | Ícono | Equipo | Habilidad |
| --- | --- | --- | --- | --- |
| Padrino | Lobo Alfa | 🐺 | Mafia | Líder de la mafia; el Detective lo ve como inocente si lo investiga. |
| Mafioso | Hombre Lobo | 🐾 | Mafia | Participa en la elección nocturna de la víctima. |
| Bruja | Bruja | 🧙‍♀️ | Mafia | Además del voto colectivo, de noche puede revelar a toda la Mafia el rol exacto de un jugador. |
| Carnicero | Carnicero | 🔪 | Mafia | Además del voto colectivo, de noche puede silenciar a un jugador (no puede votar en la acusación del Día siguiente). |
| Detective | Vidente | 🔮 | Ciudad | De noche, investiga en privado a un jugador para saber si es de la Mafia. |
| Médico | Curandero/a | 💊 | Ciudad | De noche, protege a alguien de un ataque. |
| Cazador | Cazador | 🏹 | Ciudad | Sin acción nocturna propia; si lo matan, dispara automáticamente a otro jugador vivo al azar. |
| Aldeano | Aldeano | 🌾 | Ciudad | Sin habilidad especial — solo su voto y su palabra. |
| Intendente | Intendente | 🎖️ | Ciudad | Sin habilidad nocturna, pero su voto vale doble (acusación y juicio). |
| Lycan | Lycan | 🐕 | Ciudad\* | Sin habilidad nocturna; la primera vez que intentan matarlo, sobrevive y pasa a jugar para la Mafia. |
| Bufón | Bufón | 🃏 | Independiente | Gana solo si el pueblo lo vota y lo ejecuta durante el Juicio (sección 2). |
| Amante ×2 | Amante | 💞 | Ciudad | Sin habilidad especial, pero conoce en secreto la identidad de su Amante (el otro jugador con este rol). |

\* El Lycan cuenta como Ciudad hasta que sobrevive a un intento de
asesinato — desde ese momento pasa a jugar para la Mafia (se suma a
`mafiaOrder` y a la lista de cómplices del resto de la Mafia).

⚠️ **Ajuste sobre el catálogo original:** el Aldeano se agregó porque el
MVP original solo tenía 3 roles Ciudad con habilidad (Detective, Médico,
Cazador) y hacía falta completar el bando Ciudad en partidas de 7+
jugadores.

### 6.2 Escalado por cantidad de jugadores

⚠️ **Ajuste a la tabla original:** la tabla no reservaba un lugar fijo para
el Bufón como Independiente — quedó corregida acá para que cada tramo
reparta el mismo total de Mafia/Ciudad/Independiente que la tabla original
tenía a esa cantidad de jugadores, "reskineando" solo roles de relleno
(aldeanos extra, el 2º mafioso) en roles nuevos a medida que crece el
grupo, sin inflar el poder de ningún bando.

| Jugadores | Mafia | Ciudad | Independiente | Roles Mafia | Roles Ciudad |
| --- | --- | --- | --- | --- | --- |
| 6 | 2 | 3 | 1 | Padrino, Mafioso | Detective, Médico, Cazador | 
| 7 | 2 | 4 | 1 | Padrino, Mafioso | Detective, Médico, Cazador, Intendente |
| 8 | 2 | 5 | 1 | Padrino, Mafioso | Detective, Médico, Cazador, Intendente, Lycan |
| 9 | 3 | 5 | 1 | Padrino, Mafioso, Bruja | Detective, Médico, Cazador, Intendente, Lycan |
| 10 | 3 | 6 | 1 | Padrino, Bruja, Carnicero | Detective, Médico, Cazador, Intendente, Lycan, Aldeano |

A partir de 8 jugadores, cada partida tiene además un 50% de chance
(`LOVERS_CHANCE`) de reemplazar los lugares de Intendente y Lycan por 2
Amantes (mismo total de Ciudad, sin tocar el resto de la tabla) — así esos
dos roles no desaparecen del juego para siempre en las salas de 8+.

## 7. UI/UX

- **Ver tu rol en cualquier momento:** botón fijo (🎭) en el celular que
  abre la tarjeta de rol en una ventana superpuesta, incluso después de
  morir.
- **Chat:** la sala tiene un canal general, más un canal privado solo para
  los mafiosos vivos.
- **Reconexión:** si un jugador se desconecta, queda "congelado" (sigue
  `alive`, marcado `connected:false`) y puede reincorporarse; al reconectar
  recibe de nuevo su rol y el estado exacto de la fase en la que está la
  sala (`mafiaOnReconnect` en `logic.js`).
- **Tutorial in-app:** `games/mafia/rules.js` (`GENERAL_RULES`) contiene el
  contenido del modal de reglas (objetivo, noche, discusión, votación/
  juicio, el secreto de la muerte), disponible desde el celular y la
  pantalla en cualquier momento.

## 8. Roadmap / Qué falta

- Pulir animaciones/arte con la ambientación de aldea de fantasía (sección
  3.1) — es intencionalmente lo último de la lista, después de tener el
  ciclo completo de juego funcionando.
- Hacer configurable por sala si se revela o no el rol al morir (hoy nunca
  se revela, por diseño — sección 4, Fase 6).
