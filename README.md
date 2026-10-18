# Duelo de Cuchillos

> "¿Quién tiene razón? ¡Que se peleen a cuchillos!"

Juego web multijugador para hasta 8 personas. El grupo discute un tema y cada jugador defiende una
opción. Cada quien arma su personaje y su arma, y todos se agarran a cuchillazos en un ring
circular. Gana la opción que quede en pie. Es una alternativa a la ruleta online.

## Contenido

1. [Estructura](#estructura)
2. [Correr en local](#correr-en-local-powershell)
3. [Probar desde un celular en la misma WiFi](#probar-desde-un-celular-en-la-misma-wifi)
4. [Pruebas del servidor](#pruebas-del-servidor)
5. [Desplegar: GitHub, Render y Netlify](#desplegar-github-render-y-netlify)
6. [Variables de entorno](#variables-de-entorno)
7. [Cómo funciona](#cómo-funciona)
8. [Lista de verificación manual](#lista-de-verificación-manual)
9. [Problemas comunes](#problemas-comunes)

## Estructura

```
/client          Vite + JavaScript + Three.js (sitio estático → Netlify)
  netlify.toml
  src/screens/   inicio, crear sala, personaje, opción, lobby, pelea, resultados, demo
  src/three/     ring, personajes, armas, efectos, cámara e interpolación
  src/controls.js  teclado/mouse + joystick y botón táctil
/server          Node.js + Express + Socket.IO (Web Service → Render)
  src/room.js    salas, opciones, validaciones del lobby
  src/match.js   simulación autoritativa del combate
  src/game.js    bucle de ticks (máx. 30/s) y resultados
  test/          Vitest + socket.io-client contra un servidor real
/shared          catálogos (personajes, armas, colores), límites y utilidades de texto
render.yaml      Blueprint de Render
```

`/shared` son módulos ESM sin dependencias. El servidor y el cliente los importan por ruta
relativa (`../shared`), así que no hay que publicar ningún paquete. Por eso Render y Netlify
trabajan sobre el repositorio completo.

## Requisitos

- Node.js 18 o superior (probado con Node 24 en Windows; en Render y Netlify se usa Node 22).
- npm 9 o superior.

## Correr en local (PowerShell)

Desde la raíz del proyecto:

```powershell
npm run install:all
```

Terminal 1, el servidor (http://localhost:3000):

```powershell
npm run dev:server
```

Terminal 2, el cliente (http://localhost:5173):

```powershell
npm run dev:client
```

Abrí http://localhost:5173 en dos ventanas (o una normal y otra de incógnito). Creá una sala en
una y entrá con el código en la otra.

- Para ver solo el ring y los personajes, sin servidor: http://localhost:5173/?demo=1
- Para hacer un build de producción y previsualizarlo:

  ```powershell
  npm run build
  npm run preview --prefix client
  ```

  El preview corre en el puerto 4173. Para que el servidor lo acepte, arrancalo con el origen correcto:

  ```powershell
  $env:CLIENT_ORIGIN = "http://localhost:4173"; npm run dev:server
  ```

## Probar desde un celular en la misma WiFi

1. Buscá la IP local de tu compu:

   ```powershell
   ipconfig
   ```

   Usá la "Dirección IPv4" de tu adaptador WiFi, por ejemplo `192.168.1.50`.
2. Arrancá el servidor y el cliente como en la sección anterior. `npm run dev:client` ya usa
   `--host`, así que Vite muestra también la URL de red.
3. En el celular abrí `http://192.168.1.50:5173`.

No hay que configurar nada más:

- Si `VITE_SERVER_URL` no está definida, el cliente se conecta al mismo host en el puerto 3000
  (`http://192.168.1.50:3000`).
- Si `CLIENT_ORIGIN` no está definida, el servidor acepta `localhost:5173` y cualquier IP de red
  privada (192.168.x.x, 10.x.x.x, 172.16–31.x.x) en el puerto 5173.

Si no carga, revisá que el Firewall de Windows permita Node.js en redes privadas. La primera vez
que corrés Node, Windows pregunta. Si dijiste que no, podés abrir los puertos con PowerShell como
administrador:

```powershell
New-NetFirewallRule -DisplayName "Duelo dev" -Direction Inbound -Protocol TCP -LocalPort 3000,5173 -Action Allow -Profile Private
```

## Pruebas del servidor

```powershell
cd server
npm test
```

También funciona `npm test` desde la raíz. Las pruebas usan Vitest y socket.io-client contra un
servidor real que se levanta en un puerto libre. Cubren:

| Archivo | Qué prueba |
|---|---|
| `test/lobby.test.js` | crear sala (código, anfitrión, tema), unirse con código válido o inválido, sala llena (9.º rechazado), apodos repetidos, personajes válidos e inválidos, opciones nuevas, duplicadas (mayúsculas, acentos, espacios), límite de 8, cambio de opción visto por todos, suplantación, límite de mensajes, desconexión y reasignación de anfitrión, validaciones para iniciar |
| `test/combat.test.js` | cuenta regresiva, velocidad máxima, límites del ring, entradas inválidas, colisión entre enemigos y aliados, daño calculado en el servidor, cooldown, alcance y dirección, aliados sin daño, empuje, caída del ring, último en pie, misma opción, tiempo agotado, muerte súbita, empate, desconexiones en partida, revancha, tasa de ticks |
| `test/simulation.test.js` | 8 bots con 4 opciones juegan hasta el final y se revisan invariantes en cada tick |
| `test/auto.test.js` | modo automático: crear sala, solo el anfitrión pone respuestas, espectadores sin control, un luchador válido por respuesta, pelea sin límite hasta que queda uno, niveles cada N s (velocidad, daño, ritmo), revancha, el clásico sin niveles |
| `test/http.test.js` | `/health`, CORS y rechazo de WebSocket desde un origen no permitido |

## Desplegar: GitHub, Render y Netlify

### 1. Subir a GitHub

1. Creá un repositorio vacío en https://github.com/new, por ejemplo `duelo-de-cuchillos`, sin
   README ni .gitignore.
2. Desde la raíz del proyecto:

   ```powershell
   git init
   git add .
   git commit -m "Duelo de Cuchillos"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/duelo-de-cuchillos.git
   git push -u origin main
   ```

   `.gitignore` ya excluye `node_modules`, `dist` y `.env`.

### 2. Servidor en Render

1. Entrá a https://dashboard.render.com, hacé clic en **New +** y elegí **Blueprint**.
2. Conectá tu cuenta de GitHub y elegí el repositorio. Render lee `render.yaml`, que trae:
   - Build Command: `npm ci --prefix server --omit=dev`
   - Start Command: `node server/src/index.js`
   - Health Check: `/health`
3. Cuando pida `CLIENT_ORIGIN`, poné por ahora `https://placeholder.netlify.app`. La cambiás en
   el paso 4.
4. Hacé clic en **Apply**. Al terminar vas a tener una URL como
   `https://duelo-de-cuchillos-server.onrender.com`. Abrí `/health` y debe responder
   `{"ok":true,...}`.

Si preferís hacerlo sin Blueprint, usá **New + → Web Service** con Runtime **Node**, Root
Directory **vacío**, y los mismos Build y Start Command de arriba.

> En el plan gratis, Render duerme el servicio tras 15 minutos sin uso. La primera conexión puede
> tardar cerca de un minuto; el cliente muestra "Despertando el servidor...".

### 3. Cliente en Netlify

1. Entrá a https://app.netlify.com y elegí **Add new site → Import an existing project → GitHub**,
   y luego el repositorio.
2. Configuración del build:
   - **Base directory:** `client`
   - **Build command:** `npm run build` (ya viene en `client/netlify.toml`)
   - **Publish directory:** `client/dist` (Netlify lo muestra así; en el toml es `dist`)
3. En **Environment variables** agregá:
   - `VITE_SERVER_URL` = `https://duelo-de-cuchillos-server.onrender.com`, sin `/` al final.
4. Hacé clic en **Deploy**. Vas a tener una URL como `https://duelo-de-cuchillos.netlify.app`.

> `VITE_SERVER_URL` se incrusta en el build. Si la cambiás, hacé **Deploys → Trigger deploy**.

### 4. Conectar los dos

1. En Render, abrí el servicio y entrá a **Environment**. Ahí cambiá `CLIENT_ORIGIN` por la URL
   exacta de Netlify, por ejemplo `https://duelo-de-cuchillos.netlify.app`, sin `/` al final.
2. Guardá. Render redespliega solo.
3. Si también querés usar los deploy previews de Netlify, se pueden poner varios orígenes:
   `https://duelo-de-cuchillos.netlify.app,https://*--duelo-de-cuchillos.netlify.app`
4. Abrí el sitio de Netlify, creá una sala y compartí el enlace.

## Variables de entorno

| Dónde | Variable | Local | Producción | Descripción |
|---|---|---|---|---|
| Netlify (client) | `VITE_SERVER_URL` | sin definir: mismo host en `:3000` | `https://<servicio>.onrender.com` | URL del servidor Socket.IO |
| Render (server) | `CLIENT_ORIGIN` | sin definir: `localhost:5173` y la red local | `https://<sitio>.netlify.app` | Orígenes permitidos (CORS y WebSocket). Separados por coma, admite `*` |
| Render (server) | `PORT` | `3000` | la asigna Render (10000) | Puerto HTTP |
| Render y Netlify | `NODE_VERSION` | — | `22` | Ya viene en `render.yaml` y `netlify.toml` |

Hay ejemplos en `client/.env.example` y `server/.env.example`.

## Cómo funciona

### Flujo

1. **Inicio:** se pone el apodo (2 a 14 caracteres) y se elige entre "Crear sala" o entrar con
   un código. También se puede entrar con un enlace `?sala=CODIGO`.
2. **Crear sala:** se escribe el tema (hasta 80 caracteres) y, si se quiere, hasta 8 opciones
   iniciales. Quien crea la sala es el anfitrión. El código tiene 5 letras, sin 0, O, 1 ni I.
3. **Personaje:** tipo, variante, color, accesorio y arma, con vista previa 3D que se puede girar
   arrastrando.
4. **Opción:** se elige una del pool o se crea una nueva. Los duplicados se detectan ignorando
   mayúsculas, acentos y espacios; si escribís una que ya existe, te une a esa.
5. **Lobby:** código grande, enlace, botones de WhatsApp, Copiar y Compartir, y la lista de
   jugadores agrupados por opción ("Listo" o "Eligiendo..."). Solo el anfitrión puede empezar,
   con al menos 2 jugadores, todos listos y al menos 2 opciones.
6. **Pelea:** cuenta regresiva de 3 s y luego 90 s de pelea.
7. **Resultados:** podio por opción y ranking por jugador. El anfitrión pide la revancha y se
   conservan personajes y opciones.

### Modo automático

Al crear la sala, el anfitrión elige **Automático** en vez de **Clásico**.

- El anfitrión solo escribe las respuestas, mínimo 2 y máximo 8, en la creación o después en el
  lobby. Solo él puede agregarlas o quitarlas.
- Cada respuesta es un luchador con personaje y arma al azar, controlado por el servidor. Persigue
  a un enemigo, lo rodea, le pega y a veces se retira.
- Cada golpe empuja fuerte. Los luchadores buscan ponerse entre el rival y el centro para mandarlo
  hacia la orilla, así que muchas peleas se definen sacando al otro del ring.
- Los jugadores de la sala solo miran: no eligen personaje ni opción, y el anfitrión puede empezar
  aunque esté solo.
- No hay límite de 90 s ni muerte súbita. Pelean hasta que queda uno en pie.
- La pelea arranca lenta y suave, y cada 30 s sube un nivel. En pantalla aparece "¡Nivel N! Más
  rápido y con más filo". Los multiplicadores están en `shared/limits.js` (`AUTO`):

  | Nivel | Velocidad | Daño | Ritmo de ataque | Empuje |
  |---|---|---|---|---|
  | 1 (0–30 s) | ×0.60 | ×0.15 | ×0.60 | ×1.20 |
  | 2 (30–60 s) | ×0.75 | ×0.35 | ×0.72 | ×1.40 |
  | 3 (60–90 s) | ×0.90 | ×0.55 | ×0.84 | ×1.60 |
  | 4 (90–120 s) | ×1.05 | ×0.75 | ×0.96 | ×1.80 |
  | … | +0.15 (máx. ×2) | +0.20 (sin tope) | +0.12 (máx. ×1.8) | +0.20 (máx. ×2.4) |

  En simulación, una pelea dura en promedio entre 40 s y 57 s con 2 a 8 respuestas, y llega al
  nivel 2 o 3. Entre el 30 % y el 65 % de las eliminaciones son por caída del ring.
- En la revancha se conservan las respuestas, y los luchadores salen con personaje y arma nuevos.

### Reglas de combate (modo clásico)

Todo esto lo calcula el servidor:

- Todos empiezan con 100 de vida. Los de la misma opción no se dañan y se pueden atravesar.
- Cada arma tiene su alcance, ángulo, cooldown, daño (con variación aleatoria) y empuje:

  | Arma | Alcance | Cooldown | Daño | Empuje |
  |---|---|---|---|---|
  | Cuchillo | 1.6 | 450 ms | 8–12 | 0.9 |
  | Daga | 1.3 | 300 ms | 5–9 | 0.6 |
  | Navaja | 1.45 | 380 ms | 7–11 | 1.2 |
  | Espada corta | 2.1 | 700 ms | 12–18 | 1.6 |

- Caminando no te podés salir del ring, pero un empujón sí te puede sacar, y eso elimina.
- Gana el último en pie, o la opción cuyos sobrevivientes son todos del mismo bando.
- Al acabar los 90 s gana la opción con más vida sumada. Si hay empate, sigue una muerte súbita
  de 20 s donde cualquier golpe elimina. Si sigue el empate, gana la opción con más vivos, y si
  tampoco se decide, queda empate.
- Si alguien se desconecta en plena pelea, queda eliminado y el resto sigue.

### Protocolo (Socket.IO)

El cliente solo manda intenciones:

| Evento (cliente → servidor) | Datos | Respuesta |
|---|---|---|
| `room:create` | `{ nick, topic, options?, mode? }` (`'classic'` o `'auto'`) | `{ ok, code, playerId, room }` |
| `room:join` | `{ nick, code }` | `{ ok, code, playerId, room }` |
| `room:leave` | — | `{ ok }` |
| `player:character` | `{ character }` | `{ ok, character }` |
| `option:create` / `option:choose` / `option:remove` | `{ text }` / `{ optionId }` | `{ ok }` |
| `game:start` / `game:restart` | — (solo anfitrión) | `{ ok }` |
| `input` | `{ x, z }`, vector de movimiento (se normaliza) | sin respuesta |
| `attack` | `{ x, z }`, dirección del golpe | sin respuesta |
| `net:ping` | — | hora del servidor |

El servidor manda `room:state` (lobby), `game:start`, `game:tick` (hasta 30 por segundo, por
defecto 20, con posiciones, vida y eventos) y `game:over` (resultados).

Si algo falla, la respuesta trae `{ ok: false, code, error }`. El `error` viene en español para
mostrarlo tal cual.

### Sangre y sonido

- **Sangre de caricatura:** gotas y manchas rojas brillantes con brillo blanco, nada realista. Se
  apaga con el botón 🩸 de la pelea y queda solo confeti. La preferencia se guarda en el navegador
  (`duelo:gore`).
- **Sonido:** todo se sintetiza con Web Audio en `client/src/audio.js`, sin archivos. Usa paneo
  estéreo según dónde pasa cada cosa y un compresor para que no sature. Se silencia con 🔊; la
  preferencia se guarda como `duelo:muted`.

### Seguridad

- Los textos se recortan, se les quitan los caracteres de control y de dirección bidi, y se
  validan su longitud y los duplicados.
- El personaje y el arma solo aceptan IDs de `/shared/catalog.js`. Tipos, variantes o claves que
  sobren se rechazan.
- El servidor usa el id del socket. Ignora cualquier `playerId` que mande el cliente.
- Solo el anfitrión puede iniciar, reiniciar o quitar opciones.
- Cada socket puede mandar hasta 60 mensajes por segundo; lo que pase de ahí se descarta.
- Las acciones fuera de tiempo se ignoran: cooldown, cuenta regresiva, jugador eliminado o fuera
  de partida.
- El servidor valida el `Origin` también en WebSocket, no solo en CORS.

## Lista de verificación manual

Las pruebas automáticas cubren el servidor. Esto se revisa a mano en un navegador o celular real.

**Celular, en vertical**
- [ ] La pantalla de inicio se ve completa, sin scroll horizontal, y los botones se pueden tocar
      con facilidad.
- [ ] La vista previa 3D del personaje se ve y gira al arrastrar.
- [ ] El botón "Listo, ese soy yo" queda fijo abajo y no tapa contenido importante.
- [ ] En el lobby, el código se lee grande y los botones de compartir caben.
- [ ] En la pelea se ve el ring casi completo, la cámara sigue al jugador y los nombres se leen.
- [ ] El joystick aparece en la mitad izquierda y mueve al personaje en la dirección correcta.
- [ ] El botón "¡Cuchillazo!" ataca, apunta al enemigo cercano y, si se mantiene presionado,
      ataca seguido.
- [ ] El anillo de cooldown del botón se llena después de cada ataque.
- [ ] La barra de vida propia, el temporizador y los vivos por opción no tapan la acción.
- [ ] En iPhone con notch, nada queda debajo del notch ni de la barra de inicio (safe-area).

**Celular, en horizontal**
- [ ] Al girar en plena pelea, el ring se reacomoda sin recargar.
- [ ] El joystick y el botón de ataque se pueden alcanzar con los pulgares.
- [ ] La lista de vida y el registro de eventos no se encima con los controles.

**Compartir**
- [ ] "Compartir por WhatsApp" abre WhatsApp con el mensaje "¡Te reto a un Duelo de Cuchillos!
      Tema: ... Entra aquí: https://.../?sala=CODIGO".
- [ ] Ese enlace, abierto en otro celular, rellena el código y muestra "¡Te retaron!".
- [ ] "Copiar enlace" copia la URL, también en HTTP dentro de la red local.
- [ ] "Compartir" aparece solo donde existe `navigator.share` (Android Chrome, iOS Safari) y abre
      el menú nativo.

**Escritorio**
- [ ] WASD y las flechas mueven al personaje.
- [ ] El personaje mira hacia el cursor, y clic o espacio atacan en esa dirección.
- [ ] En una laptop táctil, los controles táctiles aparecen al tocar la pantalla y desaparecen
      al usar el mouse.

**Sangre de caricatura y sonido**
- [ ] Cada cuchillazo salpica gotas rojas en la dirección del golpe y deja una mancha en la arena,
      que se desvanece a los ~14 s. Si eliminan a alguien a cuchillazos, queda un charco.
- [ ] El botón 🩸 cambia a 🎉 (solo confeti), borra las manchas y se recuerda para la próxima.
- [ ] Se oyen el zumbido del arma, el golpe ("¡shlick!"), el choque de filos, el silbato al caer
      del ring, el trombón triste cuando te eliminan, los beeps de la cuenta regresiva, el sonido
      de "¡Nivel N!" y la fanfarria al final.
- [ ] En iPhone el sonido arranca después del primer toque. El botón 🔊/🔇 silencia y se recuerda.
- [ ] Con 8 luchadores pegando a la vez el audio no se satura ni se entrecorta.

**Efectos y sensación**
- [ ] Los golpes muestran chispas, confeti del color del bando, el número de daño y un destello
      rojo.
- [ ] Cada golpe deja una estela del arma, y al caminar se levanta polvo.
- [ ] La cámara tiembla al recibir o dar golpes y al eliminar a alguien.
- [ ] Caerse del ring muestra la caída y "¡Te caíste!".
- [ ] La muerte súbita muestra su banner, y el temporizador se pone en rojo en los últimos 10 s.
- [ ] El movimiento de los demás se ve suave, sin saltos.

**Rendimiento en un celular de gama media**
- [ ] La pelea con 8 jugadores va a 30 fps o más (en Chrome Android se puede ver con DevTools
      remoto y el panel Performance).
- [ ] El celular no se calienta demasiado en una partida de 90 s.
- [ ] El primer render de la pantalla de personaje tarda menos de 3 s con 4G.
- [ ] Si va lento, `?demo=1` permite probar la escena sin servidor.

**Modo automático**
- [ ] Crear en Automático con 1 sola respuesta muestra el aviso; con 2 o más, crea la sala.
- [ ] Quien entra por el enlace va directo al lobby como espectador, sin elegir personaje.
- [ ] Durante la pelea no aparecen el joystick ni el botón de ataque.
- [ ] El reloj cuenta hacia arriba, y a los 30 s aparece "¡Nivel 2!" y se nota más rápido.
- [ ] Al final, los resultados muestran cuánto duró y a qué nivel llegaron.

**Flujo completo con 3 o más personas**
- [ ] Crear sala, entrar por enlace, elegir personaje, opción, pelear, ver resultados y pedir
      revancha.
- [ ] Si el anfitrión cierra la pestaña en el lobby, otro pasa a ser anfitrión y puede empezar.
- [ ] Si alguien cierra la pestaña en plena pelea, aparece "X se fue corriendo" y la pelea sigue.

## Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| "No se puede conectar al servidor..." en Netlify | `VITE_SERVER_URL` mal escrita o sin redeploy | Corregila en Netlify y hacé "Trigger deploy" |
| Se conecta y se desconecta enseguida | `CLIENT_ORIGIN` no coincide con la URL de Netlify | Ponela exacta, con `https://` y sin `/` final |
| La primera conexión tarda mucho | Render (plan gratis) estaba dormido | Esperá unos segundos; el cliente reintenta solo |
| El celular no carga `192.168.x.x:5173` | Firewall de Windows | Ver [la sección del celular](#probar-desde-un-celular-en-la-misma-wifi) |
| Pantalla negra en la pelea | WebGL desactivado o no soportado | Activar la aceleración por hardware del navegador |
