# QRmania: La Mafia
## Game Design Document — Preentrega

| | |
|---|---|
| **Autor** | [NOMBRE Y APELLIDO] (proyecto individual) |
| **Materia** | Desarrollo Tecnológico 2 — UNRaf |
| **Versión** | 0.9 — Preentrega |
| **Fecha** | 23/10/2026 |
| **Juego publicado** | https://mafia-tau-three.vercel.app |
| **Repositorio** | https://github.com/francoheredev/Mafia |

---

## 1. Ficha del juego

| | |
|---|---|
| **Género** | Party game de deducción social (roles ocultos) |
| **Plataforma** | Navegador web: una pantalla compartida (PC, notebook o TV) y un celular por jugador |
| **Jugadores** | 6 a 10, en el mismo lugar físico |
| **Duración de una partida** | 10 a 15 minutos |
| **Edad sugerida** | +13 años |
| **Instalación** | Ninguna: se entra escaneando un código QR |
| **Idioma** | Español |

## 2. Concepto

### 2.1 Pitch
*QRmania: La Mafia* es el clásico juego de Mafia / Hombres Lobo para jugar en una juntada, pero **sin narrador humano**. La pantalla compartida narra la noche y el día, y cada jugador recibe su rol secreto en el celular. De noche, la Mafia elige en secreto a quién eliminar mientras los roles especiales actúan desde el teléfono; de día, todos discuten cara a cara, acusan y votan a quién juzgar. Gana la Ciudad si descubre a todos los mafiosos; gana la Mafia si logra superar en número al pueblo.

### 2.2 Origen de la idea
La idea nace de las juntadas con amigos jugando Mafia y Hombres Lobo. En esas partidas siempre había alguien que tenía que hacer de narrador: repartía los roles, despertaba a cada uno por turno y llevaba la cuenta de quién moría. Esa persona **no jugaba**, y muchas veces terminaba aburrida o queriendo pasar el rol a otro. *La Mafia* reemplaza a ese narrador por la pantalla y los celulares, para que **todos en la mesa sean jugadores**.

### 2.3 Pilares de diseño
1. **Desconfianza y tensión.** Nadie sabe con certeza en quién confiar, y cada voto puede eliminar a un inocente.
2. **Charla cara a cara.** La pantalla guía, pero el juego sucede en la mesa: mirarse, acusar, defenderse. El celular sirve para las acciones secretas, no para reemplazar la conversación.
3. **Entrar en 10 segundos.** Escanear un QR y jugar: sin instalar aplicaciones, sin crear cuentas.
4. **Momentos de revelación.** La partida está pensada para generar giros: el Lycan que se pasa a la Mafia, el Bufón que gana si lo ejecutan, la narración del amanecer que revela quién murió.

## 3. Público objetivo y referentes

### 3.1 Público objetivo
Está pensado para **familias y grupos mixtos**, de **13 años en adelante**: gente que se junta en persona y no necesariamente juega videojuegos. Basta con que cada uno tenga un celular con navegador; no hace falta saber usar un joystick ni conocer el género, porque la pantalla explica las reglas y cada celular muestra qué puede hacer su rol.

### 3.2 Referentes
| Referente | Qué tomé | En qué se diferencia *La Mafia* |
|---|---|---|
| **Mafia** (juego de cartas) y **Los Hombres Lobo de Castronegro** | Las reglas base de deducción social: noche, día, votación y bandos ocultos | No necesita cartas ni narrador: el reparto y la narración son automáticos |
| **Werewolf de Plato** (app de celular) | Jugar Hombres Lobo con el celular | En Plato cada uno juega desde su teléfono y a distancia; acá se juega **en persona**, con una pantalla común y charla cara a cara |
| **Among Us** | La tensión de las votaciones y la idea de un impostor entre nosotros | Sin acción ni mapa: todo se resuelve hablando |

### 3.3 Diferencial
- **Nadie queda afuera haciendo de narrador.**
- **Se juega en persona**, combinando la pantalla compartida con el celular de cada uno.
- **Cero fricción de entrada:** un QR y listo.

## 4. Mecánicas y reglas

### 4.1 Core loop
La partida es un ciclo **Noche → Día** que se repite hasta que un bando gana:

1. **Noche (secreta, en el celular):** la Mafia elige a quién eliminar y los roles especiales usan su poder.
2. **Amanecer (pantalla):** la pantalla narra qué pasó y quién murió, si murió alguien.
3. **Día (en voz alta):** el pueblo discute, vota a un acusado, lo escucha defenderse y decide si lo ejecuta.
4. **Chequeo de victoria** después de cada muerte. Si nadie ganó, vuelve a caer la noche.

### 4.2 Fases y tiempos
| Fase | Qué pasa | Dónde | Tiempo |
|---|---|---|---|
| 0. Reparto de roles | Cada jugador recibe su rol secreto; los mafiosos ven a sus cómplices | Celular | — |
| 1. Noche | La Mafia elige víctima (con un líder que rota cada noche); el Vidente investiga; el Curandero protege; Bruja y Carnicero usan su poder | Celular | hasta 60 s (se acorta si todos ya actuaron) |
| 2. Amanecer | Narración de la noche y resultado | Pantalla | — |
| 3. Discusión | Debate libre cara a cara | Mesa + pantalla | 60 s (se puede cortar antes) |
| 4. Votación | Cada uno vota en secreto a quién acusar o se abstiene; un empate se sortea entre los empatados | Celular | 30 s |
| 5. Defensa | El acusado tiene la palabra | Mesa | 30 s (se puede cortar antes) |
| 6. Juicio | El resto vota culpable o inocente; si gana culpable, se ejecuta | Celular | 30 s |

**Regla clave:** nadie revela su rol al morir. El sistema nunca lo anuncia, y se descubre discutiendo.

### 4.3 Roles
Hay 12 roles en tres bandos. Cada uno tiene un nombre técnico, un nombre narrativo (por la ambientación de hombres lobo) y un ícono.

| Rol | Nombre narrativo | Bando | Habilidad |
|---|---|---|---|
| Padrino 🐺 | Lobo Alfa | Mafia | Lidera a la Mafia; el Vidente lo ve como inocente |
| Mafioso 🐾 | Hombre Lobo | Mafia | Participa en la elección de la víctima |
| Bruja 🧙‍♀️ | Bruja | Mafia | Revela a la Mafia el rol exacto de un jugador |
| Carnicero 🔪 | Carnicero | Mafia | Silencia a un jugador: no puede votar al día siguiente |
| Detective 🔮 | Vidente | Ciudad | Investiga si un jugador es de la Mafia |
| Médico 💊 | Curandero/a | Ciudad | Protege a alguien de un ataque |
| Cazador 🏹 | Cazador | Ciudad | Si lo matan, dispara a otro jugador al azar |
| Intendente 🎖️ | Intendente | Ciudad | Su voto vale doble |
| Lycan 🐕 | Lycan | Ciudad → Mafia | Sobrevive al primer ataque y pasa a jugar para la Mafia |
| Amante 💞 ×2 | Amante | Ciudad | Sabe en secreto quién es el otro Amante |
| Aldeano 🌾 | Aldeano | Ciudad | Solo su voto y su palabra |
| Bufón 🃏 | Bufón | Independiente | Gana solo si el pueblo lo ejecuta en el Juicio |

**Por qué roles especiales:** para la **rejugabilidad**. Con solo Mafia, Aldeano, Detective y Médico, las partidas se parecen mucho entre sí. Con roles que se reparten al azar y cambian según la cantidad de jugadores, ninguna partida se juega igual.

**Mi rol favorito: el Bufón.** Da vuelta la lógica de la votación: mientras todos intentan ejecutar al culpable, el Bufón quiere que lo ejecuten a él. Eso obliga al pueblo a dudar incluso del sospechoso más obvio.

### 4.4 Controles
- **Pantalla compartida:** se maneja con el mouse. Sirve para crear la sala, mostrar el QR, empezar la partida, cortar la discusión o la defensa, y reiniciar o volver al menú.
- **Celular:** se maneja con toques. Sirve para unirse (nombre y código de sala), ver el propio rol en cualquier momento (🎭), elegir objetivos de noche, votar, usar el chat general (y el de la Mafia) y consultar las reglas.

## 5. Dinámicas y estética (MDA)
| Mecánica | Dinámica que genera | Estética (lo que siente el jugador) |
|---|---|---|
| Roles ocultos | Mentir, sospechar, armar alianzas | Desconfianza y tensión |
| Discusión con tiempo limitado | Acusaciones rápidas, defensas improvisadas | Presión y expectativa |
| Votación secreta + juicio | Traiciones y votos sorpresa | Drama social |
| Muerte sin revelar el rol | Especular sobre quién era cada muerto | Misterio |
| Bufón, Lycan, Amantes | Giros inesperados a mitad de partida | Sorpresa y momentos de revelación |
| Narración en la pantalla | Pausas dramáticas antes de cada resultado | Inmersión |

## 6. Estructura de nivel: un único nivel justificado

### 6.1 Por qué un solo nivel
*La Mafia* tiene **un único nivel: la partida completa**. En la deducción social el desafío no viene de un mapa ni de enemigos programados, sino de **las otras personas**. La dificultad la ponen los jugadores, que mienten, sospechan y votan. Dividir el juego en niveles separados no agregaría desafío; lo que agrega variedad es que cada partida tenga gente distinta y roles distintos.

### 6.2 Extensión
- Una partida dura entre **10 y 15 minutos**, en ciclos de noche y día.
- **En cada ciclo normalmente muere alguien**: la víctima de la noche (salvo que el Curandero la proteja) y el ejecutado del día (si el juicio lo declara culpable). El pueblo se achica ronda a ronda, así que la partida siempre llega a una condición de fin.
- Con 6 jugadores la partida suele resolverse en 2 o 3 ciclos. Con 10, en 4 o 5. *(Es una estimación según las reglas, todavía no medida en playtesting.)*

### 6.3 Dificultad
La dificultad **escala según la cantidad de jugadores**. Con más gente entran más roles especiales y la deducción se vuelve más compleja:

| Jugadores | Mafia | Ciudad | Indep. | Roles que se suman |
|---|---|---|---|---|
| 6 | 2 | 3 | 1 | Base: Padrino, Mafioso, Vidente, Curandero, Cazador, Bufón |
| 7 | 2 | 4 | 1 | + Intendente (voto doble) |
| 8 | 2 | 5 | 1 | + Lycan (cambio de bando) · 50 % de chance de Amantes en lugar de Intendente y Lycan |
| 9 | 3 | 5 | 1 | + Bruja (la Mafia gana información) |
| 10 | 3 | 6 | 1 | + Carnicero (silencia votos) y Aldeano |

El reparto mantiene el **equilibrio entre bandos**: se reemplazan roles de relleno por roles con poder, sin inflar a ninguno de los dos.

### 6.4 Progresión dentro de la partida
La tensión crece a medida que la partida avanza:
1. **Cada muerte achica el margen.** Al principio un voto equivocado se puede absorber; cerca del final, ejecutar a un inocente puede darle la victoria a la Mafia en la noche siguiente.
2. **Los timers presionan.** La discusión, la votación, la defensa y el juicio tienen tiempos cortos, así que hay que decidir rápido y con información incompleta.
3. **La información se acumula.** Las muertes, los votos de cada jugador y lo que dijo cada uno en su defensa van armando el rompecabezas para las rondas finales.

La **progresión entre partidas** es del jugador: aprende a leer a los demás, a mentir mejor y a usar el poder de cada rol.

## 7. Condiciones de fin y flujo de juego

### 7.1 Victoria y derrota
Se evalúa después de cada muerte:
- **Gana la Ciudad** (y pierde la Mafia) cuando no queda ningún mafioso vivo.
- **Gana la Mafia** (y pierde la Ciudad) cuando los mafiosos superan en número al resto.
- **Gana el Bufón** si el pueblo lo ejecuta en el Juicio.
- **Empate:** ambos bandos quedan en cero a la vez, algo posible por el disparo del Cazador.

Al terminar, la pantalla anuncia al ganador y revela el rol de todos.

### 7.2 Flujo completo
1. **Menú principal** → elegir *La Mafia* → **Abrir pantalla**: se crea la sala y se muestra el QR.
2. **Lobby:** los jugadores escanean el QR y entran desde el celular (de 6 a 10).
3. **Empezar partida** → reparto de roles secretos.
4. **Ciclo de juego:** Noche → Amanecer → Discusión → Votación → Defensa → Juicio. Si nadie ganó, el ciclo se repite.
5. **Fin de partida:** se anuncia al ganador y se revelan todos los roles.
6. Desde ahí: **Reiniciar partida** (vuelve al lobby con la misma sala) o **Volver al menú principal**.

## 8. Narrativa y ambientación

### 8.1 Ambientación
El juego viste la Mafia como **una aldea de fantasía acechada por hombres lobo**. Es un **homenaje a *Los Hombres Lobo de Castronegro***, la versión que jugaba con amigos. La Mafia es una manada (el Padrino es el *Lobo Alfa* y el Mafioso es un *Hombre Lobo*), el Detective es una *Vidente* y el Médico un *Curandero*. Cada rol tiene su nombre técnico y su nombre narrativo.

La ambientación explica sola el ciclo del juego: **de noche los lobos cazan y el pueblo duerme; de día el pueblo se reúne a buscar culpables.**

### 8.2 Narrativa emergente
*La Mafia* no tiene una historia escrita de principio a fin. La historia **la construyen los jugadores** en cada partida: quién mintió, quién traicionó, quién se defendió y salvó su vida, quién cayó siendo inocente. La pantalla aporta el marco y el ritmo, y la mesa aporta la trama.

### 8.3 Tono de la narración
El tono mezcla **humor y drama**. La pantalla narra cada noche y cada amanecer en varios pasos con pausas (la niebla, la manada que acecha y, recién al final, el nombre de la víctima) de forma teatral y exagerada. Busca hacer reír y poner tensión al mismo tiempo, como un buen narrador humano en una juntada.

## 9. Dirección de arte y sonido

### 9.1 Estado actual (preentrega)
- **Visual:** interfaz con tema oscuro nocturno y acentos dorados. Íconos con emojis para cada rol, y colores que distinguen a cada bando en las tarjetas.
- **Sonido:** música ambiente y efectos ("stingers") generados por código en la pantalla compartida: uno **ominoso** cuando gana la Mafia, uno de **victoria** cuando gana la Ciudad o el Bufón, y uno **neutral** en el empate. Solo suena la pantalla compartida, para que los celulares no se pisen entre sí. La voz narradora sintetizada está implementada, pero **desactivada** hasta mejorar cómo suena.

### 9.2 Dirección para la versión final
- **Arte: ilustración de cuento.** Cartas de rol ilustradas, con estilo de libro de cuentos oscuro: la aldea, el bosque y cada personaje con su retrato. Los emojis actuales son marcadores de posición.
- **Sonido: suspenso.** Ambiente nocturno, aullidos y golpes de tensión en cada revelación, para acompañar el tono de humor y drama de los textos.

## 10. Interfaz (UI/UX)

### 10.1 Pantallas
| Pantalla | Dispositivo | Contenido |
|---|---|---|
| Menú principal | PC / TV | Lista de juegos con "Abrir pantalla" y "Unirme desde acá" |
| Lobby | PC / TV | Código de sala, QR para unirse y lista de jugadores conectados; botón "Empezar partida" (se habilita con 6 a 10) |
| Unirse | Celular | Nombre y código de sala (que viene completo desde el QR) |
| Tarjeta de rol | Celular | Rol, ícono, bando, habilidad y consejo; los mafiosos ven a sus cómplices |
| Noche | PC / TV + celular | La pantalla muestra "cae la noche" y un cronómetro; el celular, las acciones del rol |
| Día: discusión, votación, defensa y juicio | PC / TV + celular | La pantalla muestra el cronómetro, el acusado y los resultados; el celular, los botones de voto |
| Fin de partida | PC / TV + celular | Ganador, roles de todos, "Reiniciar partida" y "Volver al menú principal" |

### 10.2 Ayudas siempre disponibles
- **🎭 Ver mi rol:** en el celular, en cualquier momento, incluso después de morir.
- **📖 Reglas:** un modal con el objetivo y las fases, en la pantalla y en el celular.
- **💬 Chat:** un canal general y un canal privado para la Mafia.
- **Historial:** registro de lo que pasó en la partida.
- **Reconexión:** si un celular se desconecta, el jugador vuelve con su mismo rol y en la fase en que estaba la partida.

## 11. Arquitectura técnica
- **Cliente:** HTML, CSS y JavaScript sin frameworks, publicado en **Vercel**.
- **Servidor:** Node.js + Express + **Socket.IO** para la comunicación en tiempo real, publicado en **Render**.
- **Plataforma QRmania:** un núcleo reutilizable (salas, lobby, reconexión, chat, timers) sobre el que cada juego se monta como un *plugin*. *La Mafia* es el primero.
- **Pruebas:** 26 tests automáticos del servidor que cubren el reparto de roles, la noche, la victoria de cada bando, el Bufón, el Lycan, la reconexión y el reinicio.

## 12. Alcance

### 12.1 Qué incluye esta preentrega
- Menú principal desde el que se inicia el juego.
- Partida completa jugable de 6 a 10 jugadores, con 12 roles y el ciclo noche/día completo.
- Condiciones de victoria, derrota y empate, con pantalla de fin.
- Flujo cerrado: menú → partida → fin → reiniciar o volver al menú.
- Ayudas de reglas, chat, historial y reconexión.

### 12.2 Para la entrega final
- **Tutorial / partida guiada** para quien nunca jugó Mafia: es la prioridad, porque en el playtesting las reglas costaron al principio (ver sección 14).
- Arte ilustrado estilo cuento y sonido de suspenso (sección 9.2), si da el tiempo.

## 13. Cómo probar esta versión
**Enlace:** https://mafia-tau-three.vercel.app

1. **Abrí el enlace un minuto antes.** El servidor gratuito se "duerme" cuando no se usa, y el primer ingreso puede tardar hasta un minuto. Mientras tanto se muestra un cartel de "Conectando…".
2. En el menú principal, en **Mafia**, tocá **🖥️ Abrir pantalla**. Aparece la sala con su QR.
3. **Hacen falta 6 jugadores.** Hay dos formas:
   - **Con celulares:** cada persona escanea el QR.
   - **Solo, en una PC:** abrí 6 pestañas o ventanas con **📱 Unirme desde acá** (o con el link del QR) y uní a cada una con un nombre distinto. Cada pestaña cuenta como un jugador independiente.
4. En la pantalla, tocá **Empezar partida** y jugá cada fase desde las pestañas de los jugadores.
5. Al terminar, la pantalla muestra el ganador y deja **reiniciar** o **volver al menú principal**.

## 14. Playtesting y balance

### 14.1 Prueba con amigos
Lo probé en una juntada con **6 o 7 jugadores**.

**Lo que más les gustó:**
- **Que todos jugaban.** Nadie tuvo que quedarse afuera haciendo de narrador, que era justamente el problema que quería resolver.
- **Entrar por QR.** Se sumaron enseguida, sin instalar nada.
- **Los giros de los roles especiales**, que generaron los momentos más comentados de la partida.

### 14.2 Problemas encontrados y cambios
| Problema | Cambio |
|---|---|
| Al principio las reglas confundían: no se entendía qué hacía cada rol | Se agregaron el modal de reglas, el botón "ver mi rol" con descripción y consejo, y la lista de roles en juego en la pantalla. Queda pendiente un tutorial guiado (sección 12.2). |
| La voz narradora sintetizada sonaba rara | Se desactivó; la narración queda en texto y efectos de sonido hasta mejorarla |
| Los tiempos no se ajustaban a cada grupo | Se agregaron botones para cortar antes la discusión y la defensa, y la noche se acorta sola cuando todos ya actuaron |
| Se desconectaban celulares en medio de la partida | Se implementó la reconexión: el jugador vuelve con su mismo rol y en la misma fase |

## Anexo: la plataforma QRmania
*La Mafia* corre sobre **QRmania**, una plataforma propia de juegos de fiesta con pantalla compartida y celulares. Para comprobar que la plataforma sirve para más de un juego, se montó un segundo juego, **Blind Shot** (un battle royale "a ciegas" para 2 o más jugadores: todos mueven y disparan en secreto, y al final de cada ronda se revela qué pasó), que reutiliza el mismo sistema de salas, QR y reconexión. Aparece en el menú principal, pero **el foco de esta entrega es *La Mafia***.
