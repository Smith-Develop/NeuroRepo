# Mi conocimiento (notas-ia)

App MERN para guardar lo aprendido en el trabajo. Interfaz tipo ChatGPT (barra lateral + chat centrado) +
una **red de conocimiento** visual tipo red neuronal, que se muestra u oculta desde la barra lateral (cada
app/escenario es una neurona central; sus casuísticas son neuronas satélite a su alrededor). Las casuísticas
se pueden **enlazar entre sí** cuando una depende de otra; el enlace se dibuja como una sinapsis. Una nota
puede tener además una **categoría** (agrupa casuísticas dentro de la app, p. ej. HCIS → Errores) y un
**procedimiento** opcional: un diagrama de flujo (inicio/paso/decisión/fin, con rama «No» en las decisiones)
que se dibuja solo a partir de una lista de pasos ordenados.

**Multiusuario con roles** (sesión por cookie, sin contraseña compartida):
- **admin**: único rol con permiso para crear/editar/borrar notas y apps. Usa la IA para clasificar
  (`classifyNote`) y crea usuarios normales desde «Usuarios».
- **user** (normal): solo puede **Buscar** (la IA responde en lenguaje natural) y **Aprendí algo**. Este
  segundo modo **no llama a la IA**: el texto tal cual se manda a «Sugerencias» para que el admin lo revise
  y decida si lo analiza (ahí sí entra la IA) y lo guarda. También puede **avisar de un cambio** sobre una
  nota existente desde su ficha (mismo mecanismo de Sugerencias, con `kind:"cambio"` y la nota enlazada).
  Nunca ve el borrador de la IA ni puede crear/editar/borrar notas directamente. Además, un usuario sin
  **grupo** asignado no puede consultar ninguna app: si pregunta (Buscar) algo cuya mejor coincidencia está
  en una app sin permiso, no se llama a la IA y recibe el mensaje que el admin configuró para esa app (o uno
  genérico). La red/mapa de ese usuario tampoco muestra esas apps.
Nada depende de APIs de pago.

## Stack
- `server/` Node 22 + Express 5 + Mongoose 9 (ESM, sin TypeScript). Zod 4 para validar la salida de la IA.
- `client/` React 19 + Vite, sin librerías de UI ni de gráficos. CSS plano en `src/index.css` (tema oscuro).
- IA: Ollama vía REST (`fetch`, sin SDK). Modelo por defecto `qwen2.5:3b` (`OLLAMA_MODEL`).
- MongoDB 7. Índice de texto en español sobre las notas (`server/src/models.js`).

## Archivos clave
- `server/src/ai.js` – llamadas a Ollama (`fetch`). `classifyNote` en **2 pasos**:
  1. Analiza la nota con JSON Schema (`format`) → título, resumen, keyPoints, tags, área propuesta. No ve los escenarios existentes, para no sesgarlo.
  2. `chooseScenario`: elige entre los escenarios existentes con un `enum` cerrado (+ `"NINGUNO"`); si es NINGUNO se usa el área propuesta. Devuelve `isNewScenario`.
  `answerQuestion(question, notes)` – responde en texto libre (sin JSON Schema) usando solo las notas que le pasa `routes.js` (máx. 6, recortadas a 1500 caracteres cada una); nunca ve notas que la búsqueda no encontró.
- `server/src/routes.js` – API bajo `/api`:
  - `POST /notes/draft {text}` (**admin**) → borrador de la IA, no guarda nada.
  - `POST /notes {raw,title,summary,keyPoints,tags,category,scenario,scenarioDescription,relatedNotes,steps}` (**admin**) → guarda lo revisado (`noteFields` valida y limita tamaños; `validateSteps` valida el procedimiento y remapea los índices de `noTarget` si se quitan pasos sin texto). La app se busca por nombre sin distinguir mayúsculas o se crea con un color libre. `relatedNotes: [{note,reason}]` se valida con `relations()` (deben existir, sin auto-referencia, máx. 30).
  - `GET /notes` (cualquier logueado; todas, para la red, **filtradas por `allowedScenarioIds` si no es admin**) · `GET /notes?q=` búsqueda `$text` + `rerank` (palabras distintas de la pregunta que aparecen, raíz de 5 letras sin tildes; también mira `category`), devuelve las notas tal cual (usado por `NoteForm`/`Builder` para enlazar). Ambas pueblan `relatedNotes.note` (solo `title`).
  - `POST /ask {question}` (cualquier logueado) → `searchNotes` **sin filtrar** (para detectar si hay respuesta aunque esté bloqueada); si no es admin y la app del mejor resultado no está permitida, responde con el `blockedMessage` de esa app (o uno genérico) **sin llamar a la IA**; si está permitida, filtra el resto de resultados a solo apps permitidas y sigue como siempre (`answerQuestion`). `answer: null` solo si la búsqueda no encontró nada en absoluto.
  - `PATCH /notes/:id`, `DELETE /notes/:id` (**admin**; borra también las referencias a esa nota en `relatedNotes` de otras). Las apps que se quedan sin notas se podan (`prune`).
  - `GET /scenarios` (cualquier logueado, filtradas igual que `/notes`), `PATCH /scenarios/:id` (**admin**; incluye `blockedMessage`).
- `server/src/models.js` – `Scenario {name, description, color, blockedMessage}`, `Note` (incluye `relatedNotes: [{note, reason}]`, `category`, `steps: [{type, text, noTarget?}]`), `User {username, passwordHash, role, group}`, `Session {_id: token, user, expiresAt}` (índice TTL), `Suggestion {text, kind: "nota"|"cambio", note?, author, status}`, `Group {name, apps: [Scenario]}`.
- `server/src/auth.js` – `hashPassword`/`verifyPassword` (`node:crypto` `scryptSync`, sin librerías), `attachUser` (lee la cookie `sid` a mano, sin `cookie-parser`; deja `req.user` con su `group.apps` ya poblado, o `null`), `requireAuth`/`requireAdmin`, `allowedScenarioIds(user)` (Set de apps permitidas; vacío si no tiene grupo), `bootstrapAdmin()`. La cookie se marca `secure` según `req.secure`/`X-Forwarded-Proto`, **no** según `NODE_ENV` (el contenedor también se usa en local sin TLS).
- `server/src/authRoutes.js` – `/login`, `/logout`, `/me`, `/users` (admin: crear/listar/borrar; `PATCH /users/:id {group}` reasigna grupo), `/groups` (admin: CRUD; al borrar un grupo, sus usuarios quedan sin grupo), `/suggestions` (crear: cualquiera logueado; listar/editar: admin).
- `server/src/index.js` – `attachUser` → `authRoutes` (sin proteger) → `requireAuth` + `routes` (resto de la API). `app.set("trust proxy", 1)` para que la cookie `secure` funcione tras el proxy de Coolify. Sirve `client/dist`, errores (`AIError` → 502).
- `client/src/Network.jsx` – SVG propio, red tipo neuronal: cada app es una neurona central (posición fija en un anillo); sus casuísticas son neuronas satélite colocadas con una simulación de fuerzas minimalista escrita a mano (repulsión + resorte hacia su app + resorte en cada enlace cruzado, sin librería). Los enlaces (`relatedNotes`) se dibujan como «sinapsis» discontinuas que pueden cruzar entre apps. La etiqueta de cada app se coloca en el lado contrario a sus casuísticas para no solaparse. `PALETTE` debe tener `PALETTE_SIZE` (8) colores, como en `routes.js`. Zoom/pan manual (rueda del ratón centrada en el cursor, arrastre y botones +/−/reset) con una `<g transform>` interna; `vx,vy,vw,vh` son el viewBox fijo, `cam` es la cámara interactiva.
- `client/src/Chat.jsx` – chat estilo ChatGPT, recibe `user` y cambia de comportamiento según `user.role`. Modos «Aprendí algo» / «Buscar» (pasa solo a Buscar si el texto empieza por «¿» o termina en «?»); «🧱 Construir» (abre `Builder.jsx`) solo para admin. Si no es admin, «Aprendí algo» llama a `api.createSuggestion` en vez de `api.draft` (sin borrador de IA). Mensajes tipo `text|loading|error|draft|saved|answer|builder`. En `answer`, `m.answer` es la respuesta en lenguaje natural de la IA (o `null`) y `m.results` son las notas usadas, plegadas en un `<details>`. El historial vive solo en memoria.
- `client/src/NoteForm.jsx` – formulario de revisión/edición (reutilizado en el chat, en `Suggestions.jsx` y en el panel de la nota): campo «Categoría» (datalist derivado en memoria de `notes` filtradas por la app elegida, sin endpoint nuevo), editor de «Depende de», y `StepsEditor` para el procedimiento. `client/src/StepsEditor.jsx` – editor del diagrama de flujo (pasos ordenados, subir/bajar/quitar, selector de destino «Si es No, ir a» para las decisiones), compartido con `Builder.jsx`. `client/src/Flowchart.jsx` – dibuja ese procedimiento en modo solo lectura (SVG, layout trivial por índice de fila, rama «No» como curva lateral con `foreignObject` para el texto de cada caja). `client/src/Builder.jsx` – constructor manual sin IA (piezas arrastrables, pointer events; incluye piezas de Categoría y Procedimiento). `NoteCard.jsx` – nota guardada (muestra «App · Categoría» y el `Flowchart` si tiene pasos), enlaces como botones que navegan a la otra nota.
- `client/src/Login.jsx` – formulario de acceso (`api.login`). `client/src/Sidebar.jsx` – nav tipo ChatGPT: «Chat»/«Mapa» para todos, «Sugerencias» (con contador de pendientes), «Usuarios» y «Grupos» solo si `user.role === "admin"`. `client/src/Suggestions.jsx` (admin) – bandeja de sugerencias: «Analizar con IA» llama a `api.draft` con el texto y abre `NoteForm`; al guardar, marca la sugerencia `resuelta` y la enlaza a la nota creada. «Descartar» → `status:"descartada"`. `client/src/Users.jsx` (admin) – crear/listar/borrar usuarios y asignarles un grupo (`<select>` por fila). `client/src/Groups.jsx` (admin) – arriba, el `blockedMessage` editable de cada app; abajo, crear/listar/borrar grupos (nombre + checkboxes de apps permitidas).
- `client/src/App.jsx` – al montar llama a `api.me()`; sin sesión muestra `Login`. Con sesión, shell de dos columnas (`Sidebar` + vista principal que **cambia de contenido** según `view`: chat/red/sugerencias/usuarios, no un split fijo). El modal de nota (`.modal-backdrop` + `.drawer`, centrado, se cierra pulsando fuera o con «×») muestra Editar/Borrar solo si admin, o «Avisar de un cambio» (crea una `Suggestion` con `kind:"cambio"`) si no. `showNote` siempre resuelve contra la lista completa de `notes` en memoria, aunque se le pase una nota parcial.

## Decisiones (no revertir sin motivo)
- Los prompts se probaron con qwen2.5:3b: con un solo paso, o pidiendo "reutilizar escenarios", el modelo mete todo en el primer escenario. El esquema de 2 pasos acertó 6/8 en las pruebas.
- No dar ejemplos de nombres de escenario en el prompt: el modelo 3B los copia literalmente.
- El orden de campos del esquema importa (primero entender la nota, al final el área).
- `answerQuestion` solo ve las notas que ya encontró la búsqueda de texto (nunca el total de la base): así no inventa sobre temas sin notas guardadas.
- `temperature: 0` para clasificar, `num_ctx: 8192`, timeout 300 s (en CPU tarda ~20-27 s por borrador y ~10-15 s por pregunta).
- En `NODE_ENV=production` la app no arranca sin `APP_PASSWORD` (hace falta para crear el primer admin). Ollama nunca publica su puerto.
- Solo existe el rol admin y user; el admin no puede crear más admins desde la UI (`POST /users` siempre crea `role:"user"`). Para un segundo admin, crearlo a mano en Mongo o por env var en otro arranque sin admins.
- Un usuario normal nunca dispara una llamada a la IA de clasificación/borrador (`classifyNote`); solo usa `answerQuestion` (Buscar). Esto es intencional: la IA para escribir en la base de conocimiento es cosa del admin.

## Ejecutar
- Docker local: `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build` → http://localhost:4000. `APP_PASSWORD` (+ `APP_USER`, por defecto `admin`) crea el primer admin la primera vez que arranca con la base vacía de usuarios; después esas variables ya no hacen falta (la contraseña vive hasheada en Mongo).
- Desarrollo: `ollama pull qwen2.5:3b`, MongoDB en marcha, `cd server && cp .env.example .env && npm run dev`, `cd client && npm run dev` → http://localhost:5173 (Vite hace proxy de `/api` a :4000). El login necesita que el backend real esté arriba (usa cookies, no hay forma de simular la sesión aparte).
- Comprobaciones rápidas: `node --check server/src/*.js`, `cd client && npm run build`. No hay tests automatizados todavía.
- Pendientes conocidos: paginar `GET /notes` si pasa de ~2000 hojas, guardar el historial del chat, no hay "recuperar contraseña" ni edición de usuarios (solo crear/borrar).

## Despliegue (Coolify)
- `docker-compose.yml` está preparado para Coolify (`SERVICE_FQDN_APP_4000`, sin puertos publicados).
- Requisitos del VPS: ~4 GB de RAM libre, 4 vCPU recomendados, ~8 GB de disco, CPU con AVX2. Comprobar con `free -h && nproc && df -h /` antes de desplegar.
- Pendiente: crear el recurso en Coolify y definir `APP_PASSWORD`.

## Estilo
- Código y comentarios en español en la UI/prompts; nombres de variables en inglés.
- Sin dependencias nuevas para cosas que cubre Node/Express (p. ej. la autenticación usa `node:crypto`).
