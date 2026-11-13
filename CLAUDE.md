# Biblioteca de documentos (NeuroRepo)

App MERN tipo gestor documental (parecido a Alfresco Community, con IA) para una carpeta de documentos
del trabajo. Interfaz tipo ChatGPT (barra lateral + chat centrado): en el chat se **busca** documentación
(por coincidencia de texto, no redactando respuestas) y se muestran los documentos encontrados con opción
de **verlos** (PDF/imágenes, en línea) o **descargarlos**. También hay un **explorador de carpetas**
(`Documentos` en la barra lateral) para navegar todo lo indexado como un árbol de archivos.

La documentación vive **fuera de la app**, en una carpeta del sistema de archivos del host, montada de
solo lectura en Docker. Mongo solo guarda el **índice** (metadatos + texto extraído de cada archivo),
nunca el archivo en sí. El admin elige qué subcarpeta de esa carpeta montada está activa con el botón
**«Vincular biblioteca»**, sin tocar Docker ni redesplegar.

**Multiusuario con roles** (sesión por cookie):
- **Usuarios normales**: se dan de alta con **nombre + DNI, sin contraseña**; entran escribiendo solo su
  DNI. Solo pueden **buscar/consultar** documentos de las carpetas que les permita su grupo; sin grupo
  asignado no pueden consultar ninguna carpeta (ni en el chat ni en el explorador). Si preguntan por algo
  de una carpeta sin permiso, no se llama a la IA: reciben el mensaje que el admin configuró para esa
  carpeta (o uno genérico).
- **admin**: único rol que mantiene **contraseña** (por ser la cuenta que gestiona usuarios, grupos y la
  biblioteca). Ve todas las carpetas sin restricción. Gestiona usuarios (crear/borrar/asignar grupo, o
  importar una lista por `.txt`), grupos (qué carpetas puede ver cada uno + el mensaje de carpeta
  bloqueada) y la biblioteca activa.
Nada depende de APIs de pago.

## Stack
- `server/` Node 22 + Express 5 + Mongoose 9 (ESM, sin TypeScript).
- `client/` React 19 + Vite, sin librerías de UI ni de gráficos. CSS plano en `src/index.css` (tema oscuro).
- Extracción de texto: `pdf-parse` (PDF), `mammoth` (`.docx`), `xlsx` (SheetJS — instalado desde
  `cdn.sheetjs.com`, no desde npm, porque la versión publicada en el registro de npm tiene vulnerabilidades
  sin parchear; la build de SheetJS sí las corrige). `.txt`/`.md`/`.csv` se leen directamente.
- IA: Ollama vía REST (`fetch`, sin SDK), usada **solo como respaldo** de la búsqueda (ver más abajo).
  Modelo por defecto `qwen2.5:3b` (`OLLAMA_MODEL`).
- MongoDB 7. Índice de texto en español sobre los documentos (`server/src/models.js`).

## Archivos clave
- `server/src/library.js` – `LIBRARY_ROOT` (ruta montada en Docker, de solo lectura) y la biblioteca
  **activa** (`AppConfig.libraryPath`, una subcarpeta relativa elegida con «Vincular biblioteca»).
  `safeResolve` evita salirse de la raíz montada (path traversal). `browseFolder` lista subcarpetas para
  el selector; `setActiveLibraryPath` cambia la carpeta activa (la siguiente pasada del indexador poda
  solo los documentos que ya no están bajo la nueva carpeta).
- `server/src/indexer.js` – `scanLibrary()` recorre la biblioteca activa (`fs.readdir` recursivo nativo,
  sin librería), extrae texto solo de lo nuevo/cambiado (compara `mtimeMs`/`size`) y borra de Mongo lo que
  ya no existe en disco. `scheduleIndexing()` lo lanza al arrancar y cada `SCAN_INTERVAL_MINUTES`.
- `server/src/search.js` – `searchDocuments(query)`: `$text` de Mongo + `rerank` (coincidencia de palabras
  distintas de la consulta, raíz de 5 letras sin tildes, igual criterio que el buscador anterior de notas).
  **Importante**: la puntuación (`score: {$meta:"textScore"}`) va en la MISMA llamada a `.find()`/proyección
  que el resto de campos — encadenar un `.select()` aparte la pisa y `score` llega `undefined` (bug real que
  apareció al construirlo; dejarlo documentado para no repetirlo).
- `server/src/ai.js` – `suggestKeywords(question)`: la IA solo convierte la pregunta en palabras clave
  para reintentar la búsqueda; nunca redacta una respuesta sobre el contenido de los documentos (evita
  alucinaciones y uso innecesario de IA).
- `server/src/routes.js` – API bajo `/api`:
  - `GET /documents?q=` (cualquier logueado) → sin `q`, lista ligera (para el árbol de carpetas) filtrada
    por carpetas permitidas; con `q`, búsqueda con `excerpt` por documento.
  - `POST /ask {question}` (cualquier logueado) → busca por texto; si la mejor coincidencia es de una
    carpeta sin permiso, devuelve el `blockedMessage` de esa carpeta **sin llamar a la IA**; si no hay nada
    razonable (`score` por debajo de `AI_FALLBACK_SCORE`, por defecto 0.3), pide a la IA mejores palabras
    clave y reintenta una vez.
  - `GET /documents/:id/view` (inline, PDF/imágenes) y `/download` (adjunto): resuelven `Document.path`
    contra la biblioteca activa con `safeResolve` y comprueban permiso por `topFolder`.
  - `GET /folders` / `PATCH /folders/:name` (admin) – carpetas de primer nivel existentes + su
    `blockedMessage`.
  - `GET /library`, `GET /library/browse?path=`, `POST /library/select`, `POST /library/reindex` (admin) –
    estado de la biblioteca y el selector «Vincular biblioteca».
- `server/src/models.js` – `Document {path, filename, ext, folder, topFolder, size, mtimeMs,
  extractedText, textOk}` (índice de texto en `filename`/`folder`/`extractedText`), `Group {name,
  folders: [String]}` (nombres de carpetas de primer nivel, no referencias), `FolderConfig {folder,
  blockedMessage}`, `AppConfig` (documento único con la biblioteca activa y el estado del último escaneo),
  `User {name, dni, passwordHash?, role, group}` (`passwordHash` solo lo tiene el admin), `Session`
  (índice TTL, igual que antes).
- `server/src/auth.js` – `allowedFolders(user)` (Set de carpetas permitidas; vacío si no tiene grupo).
  `bootstrapAdmin()` crea el admin a partir de `BOOTSTRAP_ADMIN_NAME/DNI/PASSWORD` si no existe ninguno.
- `server/src/authRoutes.js` – `POST /login {dni, password?}`: los usuarios normales entran solo con DNI;
  si el DNI es del admin y no se manda contraseña, responde `401 {needsPassword:true}` para que el cliente
  pida el segundo campo. `/users`, `/users/import` (texto `Nombre,DNI` por línea, upsert por DNI),
  `/groups` (CRUD con `folders: [String]`).
- `client/src/Chat.jsx` – un único modo (buscar); cada resultado es una `DocumentCard` con «Ver»/«Descargar».
- `client/src/Explorer.jsx` – árbol de carpetas construido en memoria a partir de `GET /documents` (filtro
  de texto en cliente, con `<details>` nativo para expandir/colapsar, sin JS de estado por nodo).
- `client/src/LibraryPicker.jsx` – modal «Vincular biblioteca»: navega subcarpetas de `LIBRARY_ROOT`,
  fija la activa, muestra el estado del índice y permite reindexar bajo demanda.
- `client/src/Login.jsx` – un único campo DNI; si el servidor responde `needsPassword`, aparece el segundo
  campo de contraseña (solo le pasa al admin).
- `client/src/Users.jsx` – alta nombre+DNI, botón «Importar .txt» (lee el archivo con `FileReader` en el
  navegador y manda el texto tal cual, sin subida multipart). `client/src/Groups.jsx` – carpetas en vez de
  apps (checkboxes dinámicos a partir de `GET /folders`) + `blockedMessage` por carpeta.

## Decisiones (no revertir sin motivo)
- **Por qué no es posible un botón que abra el Explorador de Windows real desde dentro de la app**: un
  navegador nunca puede devolverle al servidor una ruta absoluta del disco, y aunque pudiera, el
  contenedor no vería esa ruta sin montarla antes en Docker. Por eso «Vincular biblioteca» es un
  explorador propio dentro de la app, limitado a lo que ya está montado en `LIBRARY_ROOT`.
- La carpeta base (`LIBRARY_ROOT`, vía `DOCS_HOST_PATH` en el host) se monta **una sola vez** al desplegar;
  la subcarpeta activa dentro de ella se cambia en caliente con «Vincular biblioteca», sin tocar Docker.
- Búsqueda primero por coincidencia de texto (barata, instantánea); la IA es siempre un respaldo, nunca el
  camino por defecto, y solo reformula la pregunta en palabras clave — nunca redacta una respuesta sobre
  el contenido (evita alucinaciones y uso innecesario de IA).
- DNI sin contraseña para usuarios normales es una decisión consciente del cliente: un DNI no es secreto,
  así que quien lo conozca puede entrar como esa persona. El admin sí mantiene contraseña por gestionar
  usuarios/permisos/biblioteca.
- El módulo anterior de notas/escenarios/procedimientos/red neuronal (`Note`, `Scenario`, `Suggestion`,
  `Network.jsx`, `Builder.jsx`, `Flowchart*.jsx`, `NoteForm.jsx`, etc.) se eliminó por completo al pivotar
  a gestor documental; su backup (60 notas reales) queda en `scripts/data/aplicaciones.json` (no en git).
- `xlsx` se instala desde `cdn.sheetjs.com`, no desde npm: la versión publicada en el registro de npm
  tiene vulnerabilidades (prototype pollution, ReDoS) que SheetJS solo corrigió en su propia build.
- Al extraer `.xlsx`, usar `XLSX.read(fs.readFileSync(path))`, no `XLSX.readFile(path)`: esta última falla
  dentro del contenedor con «Cannot access file» aunque Node sí puede leer el archivo.
- En `NODE_ENV=production` la app no arranca sin `BOOTSTRAP_ADMIN_DNI`/`BOOTSTRAP_ADMIN_PASSWORD` (hace
  falta para crear el primer admin). Ollama nunca publica su puerto.
- Solo existe el rol admin y user; el admin no puede crear más admins desde la UI. Para un segundo admin,
  crearlo a mano en Mongo o por env var en otro arranque sin admins.

## Ejecutar
- Docker local: crea `DOCS_HOST_PATH` (carpeta del host con documentos de prueba) y
  `BOOTSTRAP_ADMIN_DNI`/`BOOTSTRAP_ADMIN_PASSWORD` en `.env`, luego
  `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build` → http://localhost:4000.
- Desarrollo: `ollama pull qwen2.5:3b`, MongoDB en marcha, `cd server && cp .env.example .env && npm run dev`
  (ajusta `LIBRARY_ROOT` a una carpeta local de prueba), `cd client && npm run dev` → http://localhost:5173
  (Vite hace proxy de `/api` a :4000).
- Comprobaciones rápidas: `node --check server/src/*.js`, `cd client && npm run build`. No hay tests
  automatizados todavía.
- Pendientes conocidos: sin vista previa en línea de Word/Excel (solo descarga); sin recuperación de
  contraseña del admin; `GET /documents` sin paginar si la biblioteca pasa de ~5000 archivos.

## Despliegue (Coolify)
- `docker-compose.yml` está preparado para Coolify (`SERVICE_FQDN_APP_4000`, sin puertos publicados).
  Necesita `BOOTSTRAP_ADMIN_DNI`/`BOOTSTRAP_ADMIN_PASSWORD` como variables de entorno.
- **La carpeta de documentos NO se declara en `docker-compose.yml`** (ese archivo no lleva ningún bind
  mount para `/app/library`): Coolify prohíbe `${...}` en el origen de un volumen («Invalid volume
  source: contains forbidden character '${'»), así que no se puede parametrizar la ruta del host ahí.
  En Coolify, el bind mount se añade desde la pestaña **Storages** del servicio `app`: «Source Path» = la
  carpeta del VPS con los documentos reales (fuera del repo, p. ej. `/data/documentos`), «Destination
  Path» = `/app/library`, de solo lectura. Eso sí se puede cambiar desde el propio panel de Coolify sin
  tocar código ni redesplegar. En local, `docker-compose.local.yml` sí declara el mount con
  `DOCS_HOST_PATH` (ahí no aplica la restricción de Coolify).
- Requisitos del VPS: ~4 GB de RAM libre, 4 vCPU recomendados, ~8 GB de disco, CPU con AVX2.
- Desplegado en Coolify: proyecto «NeuroRepo», app `neurorepo` (uuid `b11eclxarnaji4ewyx6ter6y`) →
  https://neurorepo.coolify.kaizencode.me. Redesplegar: `GET /api/v1/deploy?uuid=b11eclxarnaji4ewyx6ter6y`.
  **Pendiente**: el pivote a gestor documental todavía no se ha desplegado ahí (solo probado en local); al
  hacerlo, hay que crear el Storage de `/app/library` en Coolify antes del primer arranque.

## Estilo
- Código y comentarios en español en la UI/prompts; nombres de variables en inglés.
- Sin dependencias nuevas para cosas que cubre Node/Express — salvo que, como aquí, sea inevitable para
  leer formatos de archivo reales (PDF/Word/Excel) sin pasar por un servicio externo de pago.
