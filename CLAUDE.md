# Biblioteca de documentos (NeuroRepo)

App MERN tipo gestor documental (parecido a Alfresco Community, con IA) para una carpeta de documentos
del trabajo. Interfaz tipo ChatGPT (barra lateral + chat centrado): en el chat se **busca** documentación
(por coincidencia de texto, no redactando respuestas) y se muestran los documentos encontrados con opción
de **verlos** (PDF/imágenes, en línea) o **descargarlos**. También hay un **explorador de carpetas**
(`Documentos` en la barra lateral) para navegar todo lo indexado como un árbol de archivos.

La documentación vive **fuera de la app**, en una carpeta del sistema de archivos del host, montada de
lectura/escritura en Docker. Mongo solo guarda el **índice** (metadatos + texto extraído de cada archivo),
nunca el archivo en sí. Desde «Vincular biblioteca» el admin elige qué subcarpeta de esa carpeta montada
está activa, y también puede **crear/renombrar/borrar carpetas y subir archivos** directamente ahí, todo
sin tocar Docker ni redesplegar.

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
- `server/src/library.js` – `LIBRARY_ROOT` (ruta montada en Docker, de lectura/escritura) y la biblioteca
  **activa** (`AppConfig.libraryPath`, una subcarpeta relativa elegida con «Vincular biblioteca»).
  `safeResolve` evita salirse de la raíz montada (path traversal). `browseFolder` lista subcarpetas para
  el selector; `setActiveLibraryPath` cambia la carpeta activa (la siguiente pasada del indexador poda
  solo los documentos que ya no están bajo la nueva carpeta). Todas las rutas que manda el admin pasan
  por `resolveVisible`: dentro de `LIBRARY_ROOT`, sin ningún tramo que empiece por «.» (protege
  `.versiones`/`.papelera`) y, donde toca, nunca la raíz — comparando la ruta **ya resuelta**, para que
  `x/..` no se cuele (antes `deleteFolder("x/..")` habría borrado la raíz entera).
  `saveUploadedFile`/`restoreVersion` escriben vía `replaceFile`: temporal oculto junto al destino →
  aparta la versión actual a `.versiones/<carpeta>/<fecha>__<nombre>` → renombrado atómico.
  `moveToTrash` mueve a `.papelera/<fecha>/<ruta original>` (ya no hay borrado directo desde la app);
  `restoreFromTrash` falla si en la ruta original ya hay algo. `.versiones`/`.papelera` viven en la raíz de
  `LIBRARY_ROOT` y quedan ocultas porque el indexador y el selector se saltan lo que empieza por «.».
- `server/src/history.js` – une lo anterior con Mongo (`FileVersion`, `TrashItem`): `recordVersion`
  conserva las `VERSIONS_MAX` (10) últimas por archivo, `trash`, `purgeExpiredTrash` (pasados
  `TRASH_RETENTION_DAYS`, 30; lo lanza `scheduleIndexing`), `renameVersionPaths` (al renombrar una
  carpeta el historial sigue a la ruta nueva). Las rutas guardadas son relativas a `LIBRARY_ROOT`, no a la
  biblioteca activa. Límite: lo que se edite directamente en el disco del host no deja versión.
- `server/src/indexer.js` – `scanLibrary()` recorre la biblioteca activa (`fs.readdir` recursivo nativo,
  sin librería), extrae texto solo de lo nuevo/cambiado (compara `mtimeMs`/`size`) y borra de Mongo lo que
  ya no existe en disco. `scheduleIndexing()` lo lanza al arrancar y cada `SCAN_INTERVAL_MINUTES`.
  Imágenes (`OCR_IMAGE_EXTS`) y PDF con menos de 50 caracteres por página (escaneos) quedan con
  `ocrStatus: "pending"`; tras cada escaneo, `processOcrQueue()` los procesa de uno en uno (lo último
  indexado primero) y solo guarda el texto si el archivo no cambió entretanto. Los documentos indexados
  antes del OCR se marcan una vez con `markLegacyForOcr()`. Un PDF mixto (unas páginas con texto y otras
  escaneadas) no pasa por OCR.
- `server/src/ocr.js` – OCR con `tesseract` (`-l spa`, un hilo con `OMP_THREAD_LIMIT=1`) y `pdftoppm`
  (como mucho `OCR_MAX_PAGES`=30 páginas a 200 ppp), llamados con `execFile`: sin paquete npm. Se
  instalan en el `Dockerfile` (`apk add`, con reintentos porque el DNS de Docker Desktop falla a veces).
  Si no están (desarrollo) o `OCR_ENABLED=false`, el OCR queda desactivado y lo dice en el log.
  `GET /library` devuelve `ocr`, `ocrPending` y `ocrFailed`, que se muestran en «Vincular biblioteca».
- `server/src/search.js` – `searchDocuments(query)`: `$text` de Mongo + `rerank` (coincidencia de palabras
  distintas de la consulta, raíz de 5 letras sin tildes, igual criterio que el buscador anterior de notas).
  **Importante**: la puntuación (`score: {$meta:"textScore"}`) va en la MISMA llamada a `.find()`/proyección
  que el resto de campos — encadenar un `.select()` aparte la pisa y `score` llega `undefined` (bug real que
  apareció al construirlo; dejarlo documentado para no repetirlo).
- `server/src/ai.js` – `suggestKeywords(question)`: la IA solo convierte la pregunta en palabras clave
  para reintentar la búsqueda; nunca redacta una respuesta sobre el contenido de los documentos (evita
  alucinaciones y uso innecesario de IA).
- `server/src/routes.js` – API bajo `/api`:
  - `GET /documents?q=` (cualquier logueado) → búsqueda con `excerpt` por documento; `?name=&type=`
    (pdf/doc/xls/other) → filtro por nombre o carpeta (regex escapada) y tipo, como mucho 200
    (`{items, truncated}`); sin ninguno de los dos, 400. Ya no hay «lista completa»:
  - `GET /documents/summary` → `{total, topFolders}` visibles (contador de la barra lateral y ámbito del
    chat). `GET /documents/children?folder=` → un nivel del árbol: `{folders:[{name, path, count}],
    files, truncated}` (como mucho 2000 archivos por carpeta). Todo filtrado con `folderFilter`.
  - `POST /ask {question}` (cualquier logueado) → busca por texto; si la mejor coincidencia es de una
    carpeta sin permiso, devuelve el `blockedMessage` de esa carpeta **sin llamar a la IA**; si no hay nada
    razonable (`score` por debajo de `AI_FALLBACK_SCORE`, por defecto 0.3), pide a la IA mejores palabras
    clave y reintenta una vez.
  - `GET /documents/:id/view` (inline: pdf, imagen, texto, vídeo, audio — vía `res.sendFile`, que ya
    soporta `Range` para que los reproductores de vídeo/audio puedan avanzar sin descargar todo) y
    `/download` (adjunto): resuelven `Document.path` contra la biblioteca activa con `safeResolve` y
    comprueban permiso con `canSeeFolder(user, doc.folder)`.
  - `GET /documents/:id/preview` (`.docx`/`.xlsx`/`.xls`/`.csv`) → `{kind, sheets:[{name, html}], truncated}`:
    Word con `mammoth.convertToHtml`, hojas con `XLSX.utils.sheet_to_html` (recortadas a 2000 filas × 50
    columnas, sin los atributos `data-*`/`id` por celda). Rechaza archivos > 30 MB o HTML > 8 MB. El
    `.doc` antiguo no tiene vista previa (no hay conversor sin LibreOffice).
  - `GET /folders` / `PATCH /folders/:name` (admin) – todas las carpetas con documentos y sus padres, a
    cualquier profundidad (`{folder, count, blockedMessage}`); `:name` es la ruta codificada (`a%2Fb`).
    El mensaje que ve un usuario bloqueado es el de la carpeta más concreta que lo tenga
    (`blockedMessageFor`: la propia o la más cercana hacia arriba).
  - `GET /library`, `GET /library/browse?path=`, `POST /library/select`, `POST /library/reindex` (admin) –
    estado de la biblioteca y el selector «Vincular biblioteca».
  - `POST /library/folders {path,name}`, `PATCH /library/folders {path,newName}`,
    `DELETE /library/folders?path=` (admin) – crear/renombrar/mover a la papelera carpetas dentro de
    `LIBRARY_ROOT`; cada operación relanza `scanLibrary()` para que el índice refleje el cambio al instante.
  - `POST /library/upload` (admin, `multipart/form-data` con `multer`, campo `files` + `path`) – sube uno
    o varios archivos a una carpeta y reindexa; si sustituye a uno existente, el anterior queda como versión.
  - Historial (admin): `DELETE /documents/:id` (archivo a la papelera), `GET /documents/:id/versions`,
    `GET /versions/:id/download` (necesita `dotfiles: "allow"` porque `.versiones` empieza por punto),
    `POST /versions/:id/restore`, `GET /trash`, `POST /trash/:id/restore` (409 si la ruta está ocupada),
    `DELETE /trash/:id` (definitivo).
- `server/src/models.js` – `Document {path, filename, ext, folder, topFolder, size, mtimeMs,
  extractedText, textOk}` (índice de texto en `filename`/`folder`/`extractedText`), `Group {name,
  folders: [String]}` (rutas de carpeta de cualquier profundidad, relativas a la biblioteca activa; no
  referencias), `FolderConfig {folder,
  blockedMessage}`, `AppConfig` (documento único con la biblioteca activa y el estado del último escaneo),
  `User {name, dni, passwordHash?, role, group}` (`passwordHash` solo lo tiene el admin), `Session`
  (índice TTL, igual que antes).
- `server/src/auth.js` – permisos por ruta: cada ruta del grupo incluye sus subcarpetas
  (`canSeeFolder`: igual a la ruta o empieza por `ruta + "/"`, así «Cal» no da acceso a «Calidad»);
  `folderFilter` es lo mismo como filtro de Mongo (regex escapada). Sin grupo, nada; el admin, todo; los
  archivos sueltos en la raíz solo los ve el admin. Los nombres de primer nivel de antes valen tal cual.
  Al renombrar una carpeta, `renameFolderPermissions` (routes.js) actualiza grupos y mensajes.
  `bootstrapAdmin()` crea el admin a partir de `BOOTSTRAP_ADMIN_NAME/DNI/PASSWORD` si no existe ninguno.
- `server/src/authRoutes.js` – `POST /login {dni, password?}`: los usuarios normales entran solo con DNI;
  si el DNI es del admin y no se manda contraseña, responde `401 {needsPassword:true}` para que el cliente
  pida el segundo campo. `/users`, `/users/import` (texto `Nombre,DNI` por línea, upsert por DNI),
  `/groups` (CRUD con `folders: [String]`). `POST /me/password {current, next}` (admin): cambia su propia
  contraseña y cierra sus otras sesiones (botón de llave junto a «Cerrar sesión» en `Sidebar.jsx`).
- `server/src/resetAdmin.js` – recuperación de contraseña sin email: `docker compose exec app node
  src/resetAdmin.js <DNI>` (sin DNI lista los admins). Pide la nueva contraseña sin eco, cierra sus
  sesiones y lo deja en el Registro. En Windows, `Restablecer-admin.bat` (raíz del repo) lanza lo mismo.
- `client/src/Chat.jsx` – un único modo (buscar). Sin mensajes todavía muestra una pantalla de bienvenida
  (`chat-landing`: Docu grande, saludo con el nombre del usuario, input centrado y sugerencias); en cuanto
  se manda el primer mensaje pasa al transcript normal, con burbujas estilo Telegram (usuario a la derecha,
  Docu a la izquierda) y cada resultado como una `DocumentCard`. Mientras se busca, el mensaje `loading`
  muestra a Docu en modo "buscando" (`<Docu mode="loading">`, ver más abajo) en vez del texto plano.
- `client/src/Docu.jsx` – la mascota: SVG + CSS puro (sin librerías), con dos modos por `animated`/`mode`:
  idle (flota, respira, parpadea) y `mode="loading"` (un meneo más juguetón, ojos mirando a los lados y
  una lupa que rebota) para la espera de una búsqueda. Respeta `prefers-reduced-motion`. Se reutiliza en
  `Login.jsx` y en la marca de `Sidebar.jsx` para que la identidad sea consistente en toda la app.
- `client/src/DocumentCard.jsx` – exporta los conjuntos de extensiones (`IMAGE_EXT`, `TEXT_EXT`,
  `VIDEO_EXT`, `AUDIO_EXT`, `OFFICE_EXT`, `PREVIEWABLE` = pdf/imagen/texto/Word/Excel) e `iconFor`/`formatSize`. El nombre del
  archivo es clickable (abre `DocumentModal`) si es `PREVIEWABLE`; vídeo y audio se reproducen **en la
  propia tarjeta** (`<video>`/`<audio controls>`, sin modal) tal como pidió el cliente ("se puedan
  reproducir desde el chat").
- `client/src/DocumentModal.jsx` – modal de vista previa (pdf en `<iframe>`; Word/Excel con el HTML de
  `/preview` en un `<iframe sandbox="" srcDoc>` con CSP `default-src 'none'` — el HTML sale del propio
  documento, así que nunca se pinta en la página de la app —, con pestañas por hoja; imagen en `<img>`, texto
  leído aparte con `fetch` y mostrado en un `<pre>` con el tema oscuro de la app — así no se ve la página
  en blanco nativa del navegador). Lo usan tanto `DocumentCard` como el `FileTile` de `Explorer.jsx`, para
  que el comportamiento sea el mismo en el chat y en el explorador de carpetas.
- `client/src/Explorer.jsx` – árbol perezoso: `useFolderChildren` pide cada carpeta a
  `/documents/children` la primera vez que se abre (lista o tarjetas) y la guarda por ruta; cuando
  `App.jsx` sube `docsVersion` (tras subir, borrar, restaurar o cerrar «Vincular biblioteca») se vuelven a
  pedir las ya cargadas sin cerrar nada. Con filtro de nombre/tipo pasa a los resultados del servidor
  (≤200), pintados como árbol en memoria todo desplegado. `App.jsx` ya no carga la lista entera: solo
  `GET /documents/summary`. En la vista de tarjetas, `FileTile` abre el mismo `DocumentModal` que
  `DocumentCard`.
- `client/src/LibraryPicker.jsx` – modal «Vincular biblioteca»: navega subcarpetas de `LIBRARY_ROOT`,
  fija la activa, crea/renombra/borra carpetas (renombrar y borrar usan `prompt()`/`confirm()` nativos —
  en pruebas automatizadas sin interacción real esos diálogos se cancelan solos, es una limitación del
  navegador de pruebas, no un bug), sube archivos (`<input type="file" multiple>` + `FormData`), y muestra
  el estado del índice con reindexado bajo demanda. El botón «Papelera» cambia el cuerpo a `TrashList`
  (recuperar / borrar definitivamente).
- `client/src/appContext.js` – `AppContext {user, reloadDocuments}` (lo provee `App.jsx`): lo usan
  `DocumentModal` (pestaña «Versiones», solo admin) y las filas de `Explorer` (botón de papelera, solo
  admin; el admin puede abrir el modal de cualquier archivo, tenga vista previa o no).
- `client/src/Login.jsx` – un único campo DNI; si el servidor responde `needsPassword`, aparece el segundo
  campo de contraseña (solo le pasa al admin).
- `client/src/Users.jsx` – alta nombre+DNI, botón «Importar .txt» (lee el archivo con `FileReader` en el
  navegador y manda el texto tal cual, sin subida multipart). `client/src/Groups.jsx` – `FolderTree`
  plegable (solo pinta los hijos de lo abierto: hay cientos de carpetas a varios niveles). En el diálogo
  del grupo, marcar una carpeta marca —deshabilitadas— sus subcarpetas y quita las que ya estuvieran
  marcadas por debajo; al editar se abren las ramas de lo marcado. El panel de mensajes usa el mismo árbol
  para elegir carpeta, marca las que tienen mensaje propio e indica de cuál hereda una subcarpeta.

## Decisiones (no revertir sin motivo)
- **Por qué no es posible un botón que abra el Explorador de Windows real desde dentro de la app**: un
  navegador nunca puede devolverle al servidor una ruta absoluta del disco, y aunque pudiera, el
  contenedor no vería esa ruta sin montarla antes en Docker. Por eso «Vincular biblioteca» es un
  explorador propio dentro de la app, limitado a lo que ya está montado en `LIBRARY_ROOT`.
- La carpeta base (`LIBRARY_ROOT`, vía `DOCS_HOST_PATH` en el host) se monta **una sola vez** al desplegar,
  de lectura/escritura; la subcarpeta activa, y las carpetas/archivos dentro de ella, se gestionan en
  caliente desde «Vincular biblioteca», sin tocar Docker.
- Subida de archivos con `multer` (`memoryStorage`, hasta 100 MB/archivo y 20 archivos por subida): es la
  única dependencia nueva para esto que Express 5 no cubre por sí solo (no hay parser multipart nativo).
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
- Solo existen los roles admin y user. Puede haber varios admins (se crean o se ascienden desde Usuarios,
  cada uno con su contraseña); el servidor impide quitar o borrar al último admin.

## Ejecutar
- Docker local: crea `DOCS_HOST_PATH` (carpeta del host con documentos de prueba) y
  `BOOTSTRAP_ADMIN_DNI`/`BOOTSTRAP_ADMIN_PASSWORD` en `.env`, luego
  `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build` → http://localhost:4000.
- Desarrollo: `ollama pull qwen2.5:3b`, MongoDB en marcha, `cd server && cp .env.example .env && npm run dev`
  (ajusta `LIBRARY_ROOT` a una carpeta local de prueba), `cd client && npm run dev` → http://localhost:5173
  (Vite hace proxy de `/api` a :4000).
- Comprobaciones rápidas: `node --check server/src/*.js`, `cd client && npm run build`,
  `cd server && npm test` (`node:test`, sin dependencias: de momento solo `test/permissions.test.js`).
- Pendientes conocidos: el filtro por nombre (`?name=`) usa una regex sin ancla, que no aprovecha
  índice (bien hasta decenas de miles de documentos); cada operación del admin espera a reindexar toda la
  biblioteca antes de responder (unos segundos con ~2400 archivos); LDAP/SSO, si algún día sale de una
  oficina.

## Instalador para Windows (`instalar.ps1` / `Instalar.bat`)
Pensado para pasárselo a alguien sin conocimientos técnicos (p. ej. para usarlo en la red interna de
una oficina, sin VPS), **sin que haga falta tener ya el proyecto descargado**: basta con guardar los
dos archivos (`Instalar.bat` + `instalar.ps1`, sueltos, descargados por separado) en cualquier carpeta
y hacer doble clic en `Instalar.bat` (lanza `instalar.ps1`, que se autoeleva a administrador si hace
falta).
- `Descargar-Proyecto` (primer paso, antes de nada de Docker): si `$PSScriptRoot` no contiene ya
  `docker-compose.yml` (es decir, el script se ejecutó suelto, no desde dentro del repo), pregunta en
  qué carpeta instalarlo (por defecto `%USERPROFILE%\NeuroRepo`) y descarga el proyecto completo desde
  GitHub (`git clone --depth 1` si hay `git` en el PATH; si no, el `.zip` de la rama `main` vía
  `Invoke-WebRequest` + `Expand-Archive`). Si el script YA vive dentro de una carpeta con
  `docker-compose.yml` (lo clonaste entero, o es la copia recién descargada), no descarga nada y la
  reutiliza. Tras descargar, el script se relanza a sí mismo desde la copia ya instalada (para que la
  tarea programada de reanudación, más abajo, apunte siempre a esa ruta estable y no a donde se haya
  descargado el `.ps1` suelto) y el proceso original termina.
- Si no encuentra `docker` en el PATH: lo descarga e instala en silencio (`Docker Desktop
  Installer.exe install --quiet --accept-license`), programa con `schtasks` (`/SC ONLOGON /RL
  HIGHEST`) que el propio script se vuelva a lanzar solo al iniciar sesión, y reinicia el equipo
  (Docker lo exige para terminar de activar WSL2/virtualización). Tras el reinicio, la tarea
  programada relanza el script, que retoma donde lo dejó; la tarea se borra en cuanto Docker
  responde (`docker info`), para no relanzarse en cada inicio de sesión futuro.
- Si Docker ya está instalado pero el servicio no está arriba, arranca `Docker Desktop.exe` y
  espera (hasta ~5 min) a que `docker info` responda.
- Pide por consola (`Read-Host`) todo lo que antes iba a mano en `.env`: nombre y DNI del admin, su
  contraseña (oculta, vía `-AsSecureString`), la ruta de la carpeta de documentos (la crea si no
  existe), el modelo de Ollama y el intervalo de reindexado; si ya hay un `.env`, pregunta si se
  quiere reconfigurar o reutilizar el que esté.
- Abre el puerto 4000 en el Firewall de Windows (`New-NetFirewallRule`) para que se pueda compartir
  en la red local, y al final levanta el stack con `docker compose -f docker-compose.yml -f
  docker-compose.local.yml up -d --build` y muestra la IP de la máquina para pasarle la URL a los
  compañeros (`http://<ip-lan>:4000`).
- No sustituye a Docker Compose ni cambia nada de la arquitectura: es solo una capa de conveniencia
  sobre el mismo `docker-compose.yml`/`docker-compose.local.yml` que ya se usa en local y en Coolify.

## Despliegue (Coolify)
- `docker-compose.yml` está preparado para Coolify (`SERVICE_FQDN_APP_4000`, sin puertos publicados).
  Necesita `BOOTSTRAP_ADMIN_DNI`/`BOOTSTRAP_ADMIN_PASSWORD` como variables de entorno.
- **La carpeta de documentos NO se declara en `docker-compose.yml`** (ese archivo no lleva ningún bind
  mount para `/app/library`): Coolify prohíbe `${...}` en el origen de un volumen («Invalid volume
  source: contains forbidden character '${'»), así que no se puede parametrizar la ruta del host ahí.
  En Coolify, el bind mount se añade desde la pestaña **Storages** del servicio `app`: «Source Path» = la
  carpeta del VPS con los documentos reales (fuera del repo, p. ej. `/data/documentos`), «Destination
  Path» = `/app/library`, **de lectura/escritura** (la app necesita poder crear carpetas y subir archivos
  ahí desde «Vincular biblioteca»). Eso sí se puede cambiar desde el propio panel de Coolify sin tocar
  código ni redesplegar. En local, `docker-compose.local.yml` sí declara el mount con `DOCS_HOST_PATH`
  (ahí no aplica la restricción de Coolify).
- Requisitos del VPS: ~4 GB de RAM libre, 4 vCPU recomendados, ~8 GB de disco, CPU con AVX2. El OCR
  añade ~95 MB a la imagen y unos 1–5 s de CPU por página; la primera pasada sobre una biblioteca con
  muchas imágenes o escaneos puede tardar horas (va en segundo plano y la búsqueda sigue funcionando).
- Desplegado en Coolify: proyecto «NeuroRepo», app `neurorepo` (uuid `b11eclxarnaji4ewyx6ter6y`) →
  https://neurorepo.coolify.kaizencode.me. Redesplegar: `GET /api/v1/deploy?uuid=b11eclxarnaji4ewyx6ter6y`.
  **Pendiente**: el pivote a gestor documental todavía no se ha desplegado ahí (solo probado en local); al
  hacerlo, hay que crear el Storage de `/app/library` en Coolify antes del primer arranque.

## Estilo
- Código y comentarios en español en la UI/prompts; nombres de variables en inglés.
- Sin dependencias nuevas para cosas que cubre Node/Express — salvo que, como aquí, sea inevitable para
  leer formatos de archivo reales (PDF/Word/Excel) sin pasar por un servicio externo de pago.
