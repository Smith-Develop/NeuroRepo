# Biblioteca de documentos (DocuPaz)

App MERN tipo gestor documental (parecido a Alfresco Community, con IA) para una carpeta de documentos
del trabajo. Interfaz tipo ChatGPT (barra lateral + chat centrado) con dos modos: **simple** (busca documentación por
coincidencia de texto y muestra los documentos encontrados) y **avanzada** (además, la IA lee fragmentos
de esos documentos y responde a la pregunta citándolos). Cada resultado se puede **ver** (PDF/imágenes,
en línea), **descargar** o marcar como **favorito** (vista «Favoritos»). El historial de conversaciones
se guarda en el `localStorage` del navegador de cada usuario (sección «Historial» de la barra lateral). También hay un **explorador de carpetas**
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
- `client/` React 19 + Vite, sin librerías de UI ni de gráficos. CSS plano en `src/index.css`: los tokens de `:root` son los del
  oscuro y `:root[data-theme="light"]` los redefine para el claro, que es el **de por defecto** (el
  `<script>` de `index.html` pone `data-theme="light"` salvo que el usuario haya elegido el oscuro). Ningún color va fijo en
  las reglas: todo lo que depende del tema es una variable (`--folder`, `--glass`, `--overlay`…). El
  toggle está al pie de `Sidebar.jsx`; `src/theme.js` guarda la preferencia en `localStorage` y un
  `<script>` en `index.html` la aplica antes de pintar (sin parpadeo). El HTML de la vista previa de
  Word/Excel lee los tokens en el momento de abrirse, así que también sale en el tema activo.
- Extracción de texto (`server/src/extract.js`): `pdf-parse` (PDF), `mammoth` (`.docx/.docm/.dotx`),
  `word-extractor` (`.doc` antiguo, MIT, JS puro), `xlsx` (SheetJS: `.xlsx/.xlsm/.xlsb/.xls/.ods` —
  instalado desde `cdn.sheetjs.com`, no desde npm, porque la versión publicada en el registro de npm
  tiene vulnerabilidades sin parchear; la build de SheetJS sí las corrige), `jszip` (ya venía con
  mammoth; `.pptx` y `.odt/.odp`), RTF a mano, y texto plano (scripts `.bat/.ps1`, `.log`, `.ini`,
  `.json`, `.xml`, `.sql`, código…) más cualquier otro archivo que «parezca texto» (sin bytes nulos),
  decodificado según su BOM: UTF-8, UTF-16 (PowerShell) o, si no es UTF-8 válido, Windows-1252. Sin
  soporte: `.ppt` binario y `.msg` de Outlook.
- IA: Ollama vía REST (`fetch`, sin SDK): respaldo de la búsqueda simple y respuestas del modo avanzado
  (ver más abajo). Modelo por defecto `qwen2.5:1.5b` (`OLLAMA_MODEL`).
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
  sin librería), extrae texto (`extract.js`) solo de lo nuevo/cambiado (compara `mtimeMs`/`size`) y borra
  de Mongo lo que ya no existe en disco. Guarda `hasText` y `extractorVersion`: un archivo sin cambios
  pero que se quedó sin texto con un `EXTRACTOR_VERSION` anterior se vuelve a leer (así entraron los
  `.doc`). `markLegacyHasText()` calcula `hasText` de lo antiguo **antes** del recorrido (si no, todo
  parecería sin texto y se releería, OCR incluido); usa un update con pipeline, que en Mongoose 9 exige
  `{ updatePipeline: true }`. `scheduleIndexing()` lo lanza al arrancar y cada `SCAN_INTERVAL_MINUTES`.
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
- `server/src/search.js` – `searchDocuments(query, limit, lexicon)`: `$text` de Mongo + `rerank`. La
  pregunta se convierte en **conceptos** (`queryConcepts`): cada palabra con contenido (raíz de 5 letras
  sin tildes; las de 3 letras —VPN, SMS— solo como palabra entera, `SHORT_STOP` quita «que», «con»…) con
  sus alternativas: los **sinónimos** (`parseSynonyms`, un grupo por línea separado por comas) y las
  **erratas** corregidas (`editDistance` ≤1, ≤2 si la palabra tiene 8 letras o más, contra el vocabulario
  de `lexicon.js`; solo palabras que no están en él, y si su raíz ya es conocida solo se completa la
  palabra para `$text`). Un concepto cuenta si aparece cualquiera de sus alternativas; las palabras
  completas añadidas (`expand`) se suman a la consulta `$text`. `rerank` cuenta conceptos y los del
  nombre/carpeta pesan el doble. `excerpt` = `bestSnippet`: el párrafo (o frase) con más conceptos,
  ampliado hasta ~300 caracteres, que el cliente muestra con las palabras resaltadas (`highlightTerms`).
  Las palabras de relleno («todo», «documento», «desde»…) van en `STOP`: si contaran, «Necesito todo lo
  de Servolab» ponía primero un documento que solo decía «todos los talleres» (pasó con datos reales).
  **Importante**: la puntuación (`score: {$meta:"textScore"}`) va en la MISMA llamada a `.find()`/proyección
  que el resto de campos — encadenar un `.select()` aparte la pisa y `score` llega `undefined` (bug real que
  apareció al construirlo; dejarlo documentado para no repetirlo).
- `server/src/lexicon.js` – `getLexicon()` → `{synonyms, vocab}`: los sinónimos (`SearchSettings`
  singleton, los editan admins y editores de la guía) y el vocabulario para corregir erratas (palabras de
  la guía, de los nombres de archivo y carpetas y de los sinónimos; NO del texto de los documentos, que
  sería mucho). Caché de 10 min, invalidada al guardar fichas o sinónimos.
- `server/src/ai.js` – `chat()` común contra `/api/chat` (temperatura 0). `suggestKeywords(question)`:
  convierte la pregunta en palabras clave para reintentar la búsqueda (modo simple).
  `answerFromDocuments(question, sources)` (modo avanzado): responde SOLO con los fragmentos dados,
  numerados `[n]`, citándolos, y dice «No lo encuentro en los documentos» si no está ahí
  (`num_ctx` 8192, `num_predict` 500), conversacional: recibe los turnos anteriores (`history`) como
  mensajes previos y responde al grano (1–4 frases o pasos). Los fragmentos salen de `bestPassages`
  (`search.js`): trozos de 600 caracteres con más raíces de la pregunta, hasta 3500 del primer documento
  y 1200 del segundo (antes eran 4 documentos de 1500: el modelo pequeño los mezclaba y citaba mal). Con el modelo de 1,5B las
  respuestas son rápidas (~5 s en CPU) pero a veces imprecisas: la UI avisa de comprobarlas.
- `server/src/guide.js` – **Guía rápida** en **fichas** (`GuideEntry {type, category, title, keywords,
  content, fields, adminOnly, version, createdBy, updatedBy}`), que el chat consulta ANTES que la
  biblioteca, en los dos modos. Vive en Mongo, no en la biblioteca (no sale en «Documentos»). Tipos:
  `nota` (texto libre), `aplicacion` (acceso permitido a, dirección, cómo se tramita el alta, cómo se
  pide, quién lo solicita, grupos del directorio activo, observaciones), `procedimiento` (introducción +
  pasos), `contacto` (nombre, extensión/móvil, correo) y `acceso` (credenciales: **siempre** solo admin).
  Antes era un único texto (`Guide`): `migrateLegacyGuide` lo trocea en fichas una vez (marca
  `migratedAt`; el texto se queda como copia). El mismo formato sirve para **importar/exportar .txt**
  (`parseGuideText`/`exportText`, ida y vuelta sin pérdidas, comprobado con la guía real de 91 fichas):
  bloques separados por líneas de guiones/«=»; primera línea «Categoría · Título»; `[solo admin]` delante;
  «Palabras clave: …»; las líneas «Etiqueta: valor» conocidas (`FIELD_LABELS`, con alias) pasan a los
  campos; pasos numerados al final → procedimiento. `renderBody` da el texto de la ficha (chat, búsqueda,
  exportación). Duplicados: misma categoría+título (`titleKey`) se rechaza con 409; `checkDuplicates`
  avisa de títulos parecidos y de grupos AD o direcciones ya usados en otras fichas. Historial por ficha
  (`GuideEntryHistory`, las 20 últimas versiones y los borrados, que se pueden recuperar).
  `searchGuide` usa los conceptos de `search.js`: aciertos ×2, los de título/categoría/palabras clave ×2
  más, palabras enteras +1; exige la mitad de los conceptos y la 2.ª ficha debe sacar ≥75 % de la 1.ª.
  Caché en memoria, invalidada en cada cambio. Tests en `server/test/guide.test.js`.
- `server/src/routes.js` – API bajo `/api`:
  - `GET /documents?q=` (cualquier logueado) → búsqueda con `excerpt` por documento; `?name=&type=`
    (pdf/doc/xls/other) → filtro por nombre o carpeta (regex escapada) y tipo, como mucho 200
    (`{items, truncated}`); sin ninguno de los dos, 400. Ya no hay «lista completa»:
  - `GET /documents/summary` → `{total, topFolders}` visibles (contador de la barra lateral y ámbito del
    chat). `GET /documents/children?folder=` → un nivel del árbol: `{folders:[{name, path, count}],
    files, truncated}` (como mucho 2000 archivos por carpeta). Todo filtrado con `folderFilter`.
  - `POST /ask {question, mode, scope}` (cualquier logueado) → primero la **guía rápida**
    (`guide: [{title, body, adminOnly}]`, sin IA); si responde, una carpeta bloqueada no tapa la
    respuesta. En modo **simple** el respaldo de IA solo entra si no hay guía, la biblioteca no da
    nada razonable y la pregunta es «compleja» (`COMPLEX_MIN_WORDS`, 4 raíces). En **avanzada**, la
    guía va a la IA como fuente prioritaria «[Guía]» con un solo documento de apoyo; una cita `[n]`
    sin documento n se reescribe a `[Guía]`. Después busca por texto; si la mejor coincidencia
    es de una carpeta sin permiso, devuelve el `blockedMessage` de esa carpeta **sin llamar a la IA**; si
    no hay nada razonable (`score` por debajo de `AI_FALLBACK_SCORE`, por defecto 0.3), pide a la IA
    mejores palabras clave y reintenta una vez. `scope` (carpeta de primer nivel) se filtra en el
    servidor. Con `mode: "advanced"`, los `ANSWER_SOURCES` (2) primeros resultados **ya filtrados por
    permisos** van a `answerFromDocuments` → `{results, answer, sourceCount}` (`[1]` = `results[0]`); si
    la IA falla, `{results, aiError}` (los documentos se muestran igual). `history: [{q, a}]` (los 3
    últimos turnos): si la pregunta sola no encuentra nada razonable, se busca junto con la anterior
    («¿y si falla?»).
  - `GET /documents/:id/text` → `{text}`: el texto extraído, para la vista previa de lo que no tiene
    visor propio (`.doc`, `.rtf`, `.pptx`, `.odt`, scripts, logs…).
  - Guía (`requireGuideEditor`: admin o `User.canEditGuide`; los que no son admin no ven ni tocan
    fichas «solo admin»/acceso): `GET /guide/entries` → `{entries, categories, types}`;
    `POST /guide/entries {entry}`; `PUT /guide/entries/:id {entry, version}` (409 si otro la cambió o si
    duplica otra); `DELETE /guide/entries/:id`; `GET /guide/entries/:id/history`; `GET /guide/deleted`,
    `POST /guide/deleted/:hid/restore`; `POST /guide/check {entry, id}` (avisos de duplicados, no
    guarda); `POST /guide/import {text}` (crea las que no existan) y `GET /guide/export` (texto);
    `GET/PUT /guide/synonyms`. `/ask` devuelve además `highlight` (términos a resaltar).
  - `GET /favorites`, `PUT /favorites/:id`, `DELETE /favorites/:id` (cualquier logueado) → favoritos del
    propio usuario (`User.favorites`, como mucho 300). Añadir comprueba permiso (`findAccessibleDoc`) y
    el listado vuelve a filtrar con `canSeeFolder` (por si el grupo cambió); el más reciente, primero.
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
  `User {name, dni, passwordHash?, role, group, favorites: [Document], canEditGuide}` (`passwordHash` solo lo tiene el admin), `Session`
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
- `client/src/Chat.jsx` – en avanzada manda `conversationHistory(messages)`. En los dos modos solo enseña
  el documento que más coincide (en avanzada, más los que cite la respuesta, `visibleResults`); el resto, tras el botón «¿Quieres
  ver N archivos relacionados más?» (`expanded` en el mensaje). Conmutador «Simple / Avanzada» (`.seg` en la barra del compositor; se
  recuerda en `localStorage` `neurorepo.chatMode`). En avanzada pinta la respuesta (`AnswerText`, citas
  `[n]` resaltadas) y numera las tarjetas citadas (`DocumentCard cite`). Cada conversación tiene un id
  (`App.jsx` lo crea; `key` del componente) y se guarda en el historial en cada cambio; una búsqueda que
  seguía en marcha al guardar se restaura como «interrumpida». Sin mensajes todavía muestra una pantalla de bienvenida
  (`chat-landing`: Docu grande, saludo con el nombre del usuario, input centrado y sugerencias); en cuanto
  se manda el primer mensaje pasa al transcript normal, con burbujas estilo Telegram (usuario a la derecha,
  Docu a la izquierda) y cada resultado como una `DocumentCard`. Mientras se busca, el mensaje `loading`
  muestra a Docu en modo "buscando" (`<Docu mode="loading">`, ver más abajo) en vez del texto plano.
- `client/src/Docu.jsx` – la mascota: SVG + CSS puro (sin librerías), con dos modos por `animated`/`mode`:
  idle (flota, respira, parpadea) y `mode="loading"` (un meneo más juguetón, ojos mirando a los lados y
  una lupa que rebota) para la espera de una búsqueda. Respeta `prefers-reduced-motion`. Se reutiliza en
  `Login.jsx` y en la marca de `Sidebar.jsx` para que la identidad sea consistente en toda la app.
- `client/src/DocumentCard.jsx` – exporta los conjuntos de extensiones (`IMAGE_EXT`, `TEXT_EXT`,
  `VIDEO_EXT`, `AUDIO_EXT`, `OFFICE_EXT`, `PREVIEWABLE` = pdf/imagen/texto/Word/Excel) e `iconFor`/`formatSize`.
  `canPreviewDoc(doc)`: `PREVIEWABLE` o cualquier documento con `hasText` (se ve como texto en el modal). El nombre del
  archivo es clickable (abre `DocumentModal`) si es `PREVIEWABLE`; vídeo y audio se reproducen **en la
  propia tarjeta** (`<video>`/`<audio controls>`, sin modal) tal como pidió el cliente ("se puedan
  reproducir desde el chat"). En el chat el nombre y el icono del archivo abren la vista previa (igual
  que en «Documentos»), además del botón «Abrir».
- `client/src/chatHistory.js` – historial en `localStorage` (`neurorepo.chat.<userId>`, como mucho 40
  conversaciones `{id, title, scope, messages, updatedAt}`), con evento propio para que `Sidebar.jsx`
  (sección «Historial», borrar con la ×) se actualice. Todo en try/catch: sin almacenamiento, el chat
  funciona igual. No sale del navegador (en otro PC no aparece).
- `client/src/GuideEditor.jsx` («Guía rápida» en la barra lateral: admins y usuarios con permiso) –
  constructor de fichas: lista por categoría con buscador y filtros, `EntryDialog` con los campos del tipo
  elegido, avisos de duplicados mientras se escribe (`/guide/check`, bloquea guardar si el título ya
  existe en la categoría), visibilidad Todos/Solo admin, historial («Cargar en el formulario»), importar
  `.txt` (UTF-8 o Windows-1252), exportar `.txt` (UTF-8 con BOM y CRLF), «Sinónimos» y «Borradas».
  `client/src/GuideCard.jsx` – la ficha en el chat (categoría, tipo, título; plegada si es larga).
  `client/src/highlight.jsx` – `<Highlight text terms>`: marca con `<mark>` las palabras que empiezan
  por los términos de `highlight` (en `GuideCard` y en el párrafo de `DocumentCard`). `AnswerText`
  resalta `[Guía]`.
- `client/src/Favorites.jsx` – vista «Favoritos»: los favoritos viven en `App.jsx` (cargados de
  `/favorites`) y se comparten por `AppContext {favorites, favoriteIds, toggleFavorite}`; la estrella de
  `DocumentCard` los cambia con actualización optimista.
- `client/src/DocumentModal.jsx` – se pinta con `createPortal` en `<body>`: desde una tarjeta del chat
  quedaba dentro del mensaje (animación con `transform` y scroll propio). Modal de vista previa (pdf en `<iframe>`; Word/Excel con el HTML de
  `/preview` en un `<iframe sandbox="" srcDoc>` con CSP `default-src 'none'` — el HTML sale del propio
  documento, así que nunca se pinta en la página de la app —, con pestañas por hoja; imagen en `<img>`, texto
  leído aparte con `fetch` y mostrado en un `<pre>` con los colores del tema activo — así no se ve la página
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
- `client/src/Users.jsx` – menú de cada usuario: «Permitir editar la guía rápida» (`canEditGuide`, insignia
  «Edita la guía»; `PATCH /users/:id {canEditGuide}`). Alta nombre+DNI, botón «Importar .txt» (lee el archivo con `FileReader` en el
  navegador y manda el texto tal cual, sin subida multipart). `client/src/Groups.jsx` – `FolderTree`
  plegable (solo pinta los hijos de lo abierto: hay cientos de carpetas a varios niveles). En el diálogo
  del grupo, marcar una carpeta marca —deshabilitadas— sus subcarpetas y quita las que ya estuvieran
  marcadas por debajo; al editar se abren las ramas de lo marcado. El panel de mensajes usa el mismo árbol
  para elegir carpeta, marca las que tienen mensaje propio e indica de cuál hereda una subcarpeta.

## Decisiones (no revertir sin motivo)
- **Nombre del producto: DocuPaz** (antes «NeuroRepo»). Se cambió todo lo visible (interfaz, título,
  licencia, README, instaladores). Se conservan a propósito los identificadores internos, para no romper
  lo ya instalado: el repositorio de GitHub (`Smith-Develop/NeuroRepo`, del que descarga el instalador),
  la base de datos `notas-ia`, las claves de `localStorage` (`neurorepo-theme`, `neurorepo.chat.*`,
  `neurorepo.chatMode`), los volúmenes de Docker y la tarea `NeuroRepoInstalador`. El instalador de
  Windows sin Docker **migra** lo instalado con el nombre antiguo: tareas «NeuroRepo - App/IA» →
  «DocuPaz - App/IA», servicio `NeuroRepoMongo` → `DocuPazMongo` (se borra y se crea con la misma base de
  datos) y regla de firewall «NeuroRepo» → «DocuPaz»; si existe `C:\NeuroRepo` actualiza ahí, si no
  instala en `C:\DocuPaz`. Al renombrar una tarea que corre con un usuario, pide su contraseña (Windows
  no deja leer la guardada).
- **Licencia propietaria** (`LICENSE`, «todos los derechos reservados», © Smith Grisales). Los dos
  `package.json` son `"private": true` y `"license": "UNLICENSED"` (antes ponía `ISC`, el valor por
  defecto de npm, que es una licencia abierta: no volver a ponerla). El repositorio de GitHub sigue
  público a propósito (el instalador descarga desde ahí), así que la protección es legal, no técnica.
  `client/src/AboutDialog.jsx` (solo admin, desde la barra lateral) muestra autor, versión (la de
  `client/package.json`), contacto, el modelo de IA con su licencia (`GET /library` devuelve `model`) y
  los componentes de terceros; el login lleva un aviso de copyright. El modelo por defecto es
  `qwen2.5:1.5b` (Apache 2.0) y no `qwen2.5:3b` a propósito: el 3B (y el 72B) van con la Qwen Research
  License, que restringe el uso comercial; no volver a ponerlo por defecto.
- **Por qué no es posible un botón que abra el Explorador de Windows real desde dentro de la app**: un
  navegador nunca puede devolverle al servidor una ruta absoluta del disco, y aunque pudiera, el
  contenedor no vería esa ruta sin montarla antes en Docker. Por eso «Vincular biblioteca» es un
  explorador propio dentro de la app, limitado a lo que ya está montado en `LIBRARY_ROOT`.
- La carpeta base (`LIBRARY_ROOT`, vía `DOCS_HOST_PATH` en el host) se monta **una sola vez** al desplegar,
  de lectura/escritura; la subcarpeta activa, y las carpetas/archivos dentro de ella, se gestionan en
  caliente desde «Vincular biblioteca», sin tocar Docker.
- Subida de archivos con `multer` (`memoryStorage`, hasta 100 MB/archivo y 20 archivos por subida): es la
  única dependencia nueva para esto que Express 5 no cubre por sí solo (no hay parser multipart nativo).
- Búsqueda primero por coincidencia de texto (barata, instantánea). En el modo **simple** (el de por
  defecto) la IA solo reformula la pregunta en palabras clave como respaldo. Que la IA **redacte
  respuestas** solo pasa en el modo **avanzado**, que elige el usuario (antes estaba prohibido; se añadió
  a petición del cliente): siempre a partir de fragmentos de documentos que el usuario puede ver, con
  citas, y con el aviso de comprobarla en el original.
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
- Desarrollo: `ollama pull qwen2.5:1.5b`, MongoDB en marcha, `cd server && cp .env.example .env && npm run dev`
  (ajusta `LIBRARY_ROOT` a una carpeta local de prueba), `cd client && npm run dev` → http://localhost:5173
  (Vite hace proxy de `/api` a :4000).
- Comprobaciones rápidas: `node --check server/src/*.js`, `cd client && npm run build`,
  `cd server && npm test` (`node:test`, sin dependencias: de momento solo `test/permissions.test.js`).
- Pendientes conocidos: el filtro por nombre (`?name=`) usa una regex sin ancla, que no aprovecha
  índice (bien hasta decenas de miles de documentos); cada operación del admin espera a reindexar toda la
  biblioteca antes de responder (unos segundos con ~2400 archivos); LDAP/SSO, si algún día sale de una
  oficina.

## Instalador único (`instalador/`, se entrega como «DocuPaz-Instalador»)
- `Instalar-DocuPaz.bat` → `instalador.ps1`: se autoeleva, analiza el equipo (Windows, CPU, RAM, si es
  VM, virtualización —`VirtualizationFirmwareEnabled`, o Docker ya funcionando—, Docker y
  instalaciones previas: `C:\DocuPaz`/`C:\NeuroRepo` o el proyecto Docker `neurorepo`), recomienda
  (actualizar lo que ya haya; sin virtualización → sin Docker; Docker funcionando → Docker; si no, sin
  Docker) y delega con `&` en `windows\instalar-windows.ps1`, `docker\instalar.ps1` o, si se elige
  Docker sin tenerlo y `pre-instalacion\instaladores` trae sus instaladores, `preinstalar.ps1`.
  Carpetas comunes `modelo\` y `ollama\` (las buscan `instalar-windows.ps1` y `cargar-modelo.ps1`).
  El paquete se monta a mano (binarios fuera de git): raíz = `instalador/*` + `ui.ps1`, `windows\` =
  paquete DocuPaz-Windows, `docker\` = paquete offline, `pre-instalacion\` = sus scripts.
- `instalador/Desinstalar-version-anterior.bat`: un solo `.bat` (cmd + una línea de PowerShell, en
  ASCII y CRLF) que se autoeleva, lista lo encontrado (tareas «NeuroRepo/DocuPaz - App/IA» y
  `NeuroRepoInstalador`, servicios `NeuroRepoMongo`/`DocuPazMongo`, reglas de firewall, carpeta
  `C:\NeuroRepo` o `C:\DocuPaz`, contenedores Docker del proyecto `neurorepo`), pide confirmación y lo
  quita. Por defecto conserva `datos\` (base de datos y modelo) y los volúmenes de Docker; nunca toca
  la carpeta de documentos.
- **Estilo visual** (`ui.ps1`, en la raíz del repo): logo DOCUPAZ en bloques, `Ui-Fase`, `Ui-Paso`
  (numerado, con tiempo transcurrido), `Ui-Linea`/`Ui-Ok`/`Ui-Info`/`Ui-Aviso`/`Ui-Fallo` (etiqueta de
  color + clave de 16 columnas + texto) y `Ui-Final` (barra). Lo cargan los cinco scripts (`.\ui.ps1` o
  `..\ui.ps1`, con una versión mínima de reserva si falta). **Sustituye `Write-Host` y `Read-Host`** con
  funciones del mismo nombre: los mensajes existentes salen con el estilo según su color (Green=OK,
  Cyan=INFO, Yellow=AVISO, Red=ERROR, sin color = texto sangrado); para escribir sin estilo, usar
  `Ui-Escribir` o `Microsoft.PowerShell.Utility\Write-Host`. El banner y el contador de pasos son
  globales, así que al encadenar instaladores no se repiten. `instalar.ps1` fija
  `COMPOSE_PROJECT_NAME=neurorepo`, para que los volúmenes no dependan del nombre de la carpeta
  (`docker\` en el paquete único, `NeuroRepo` en las instalaciones anteriores).

## Instalador para Windows (`instalar.ps1` / `Instalar.bat`)
Pensado para pasárselo a alguien sin conocimientos técnicos (p. ej. para usarlo en la red interna de
una oficina, sin VPS), **sin que haga falta tener ya el proyecto descargado**: basta con guardar los
dos archivos (`Instalar.bat` + `instalar.ps1`, sueltos, descargados por separado) en cualquier carpeta
y hacer doble clic en `Instalar.bat` (lanza `instalar.ps1`, que se autoeleva a administrador si hace
falta).
- `Descargar-Proyecto` (primer paso, antes de nada de Docker): si `$PSScriptRoot` no contiene ya
  `docker-compose.yml` (es decir, el script se ejecutó suelto, no desde dentro del repo), pregunta en
  qué carpeta instalarlo (por defecto `%USERPROFILE%\DocuPaz`) y descarga el proyecto completo desde
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
- **Paquete offline** (redes sin internet o con el DNS capado, donde fallan `apk add`/`npm ci`):
  un zip del repo con `server/node_modules` y `client/dist` ya incluidos. Si están, el instalador
  añade `docker-compose.offline.yml`, que construye con `Dockerfile.offline` (sin npm ni Vite; OCR
  opcional si `apk` no llega; su propio `Dockerfile.offline.dockerignore`, que solo usa BuildKit) y
  deja que `model` termine con éxito aunque no pueda bajar el modelo. **OCR sin red**: el zip trae en
  `vendor/ocr-apk/` los 48 `.apk` (26 MB) de tesseract-ocr + tesseract-ocr-data-spa + poppler-utils que
  faltan en `node:22-alpine` (Alpine 3.24), bajados con `apk fetch` de lo que pide
  `apk add --simulate`; `Dockerfile.offline` los instala con `apk add --no-network` (firmados, sin
  `--allow-untrusted`), si no, desde internet, y si no, sin OCR. Los `.apk` no van en git
  (`.gitignore`), solo la carpeta con su `LEEME.txt`. Probado con `docker build --network=none`. Si la
  imagen base cambia de versión de Alpine, hay que volver a bajarlos. Necesita las imágenes
  `node:22-alpine`, `mongo:7` y `ollama/ollama` ya descargadas.
- **Carpeta de red** (`G:\...` o `\\servidor\recurso\...`): Docker Desktop corre en una VM que no ve
  las unidades de red con letra, así que un bind mount de `G:\` sale **vacío**. El instalador obtiene la
  ruta UNC (`Get-PSDrive`/`HKCU:\Network\<letra>`, porque elevado no ve las unidades de la sesión
  normal), la IP del servidor y el usuario/contraseña de red, y escribe `DOCS_SMB_DEVICE`/`DOCS_SMB_OPTS`
  en `.env`; con eso añade `docker-compose.red.yml` (volumen CIFS `neurorepo-documentos-red` en el mismo
  destino `/app/library`, que sustituye al bind mount) y recrea el volumen en cada arranque. La
  contraseña de red queda en `.env`: si cambia, hay que reconfigurar.
- **Modelo de IA sin internet**: el contenedor `model` es de un solo uso (descarga el modelo y se para;
  verlo «Exited» es normal). Si la red bloquea la descarga, `Cargar-modelo.bat`/`cargar-modelo.ps1` copia
  un `.gguf` de la carpeta del proyecto (Qwen2.5-1.5B-Instruct q4_k_m de Hugging Face) al contenedor
  `ollama` y lo registra con `ollama create <OLLAMA_MODEL>` (Ollama detecta la plantilla de chat del
  propio GGUF). Probado con `ollama/ollama` sin acceso al registro.
- **Pre-instalación sin internet** (`pre-instalacion/`, se entrega como carpeta «Pre-instalacion»):
  `Preinstalar.bat` → `preinstalar.ps1` (se autoeleva y recuerda el usuario normal) pregunta x64/arm64
  (propone el detectado con `Win32_Processor.Architecture`, 12 = ARM64), une los instaladores troceados
  (`<archivo>.parteN`, porque cada archivo que se entrega por el chat tiene un límite de ~400 MB),
  comprueba `SHA256SUMS.txt`, avisa si la virtualización está desactivada, activa
  `Microsoft-Windows-Subsystem-Linux` + `VirtualMachinePlatform`, instala `wsl.<ver>.<arq>.msi` y
  `docker-desktop-<arq>.exe install --quiet --accept-license --backend=wsl-2`, añade el usuario a
  `docker-users` y ofrece reiniciar. Los binarios no van en git. En PowerShell 5.1 los ejecutables
  externos se llaman con `Sin-Parar` (con `Stop`, redirigir su stderr lanza excepción).
- **Windows sin Docker** (`windows-nativo/`, se entrega como «DocuPaz-Windows»): para VMs sin
  virtualización anidada (Docker Desktop no arranca). `Instalar-DocuPaz.bat` → `instalar-windows.ps1`
  copia `app\` (server con `node_modules` + `client\dist`) a `C:\DocuPaz`, Node 22 portable,
  `mongod.exe` como servicio `DocuPazMongo` (`New-Service … --config mongod.cfg --service`, solo
  127.0.0.1, caché 0,5 GB) y la app e IA (Ollama: `ollama-windows-amd64.zip` u `OllamaSetup.exe` que
  aporta el usuario, porque se descarga de GitHub) como tareas programadas al arrancar
  (`iniciar-*.cmd` con bucle de reinicio, `ExecutionTimeLimit` 0). Con biblioteca de red usa la ruta UNC
  y la tarea de la app corre con un usuario con acceso (contraseña guardada por Windows en la tarea);
  si no, como SYSTEM. El `.env` se escribe sin BOM y con valores entre comillas simples (Node lo lee
  literal). **OCR**: `componentes\ocr` son los binarios win-64 de conda-forge (tesseract 5.5 + poppler,
  resueltos desde Linux con `py-rattler`; el servidor de Mannheim corta las conexiones desde la nube),
  podados a los 55 ejecutables/DLL que de verdad cargan (comprobado leyendo sus imports con `pefile`) y a
  los diccionarios spa/eng/osd (~100 MB); van a `C:\DocuPaz\ocr` y `iniciar-app.cmd` añade al PATH
  `ocr\Library\bin` y `ocr` y fija `TESSDATA_PREFIX`/`FONTCONFIG_FILE`. Poppler es GPL: el paquete
  lleva `ocr\LICENCIAS.txt` con la licencia y el origen de cada componente. `LIBRARY_ROOT` se normaliza con `path.resolve` (en Windows llega
  con barra final o como `\\servidor\recurso`). Solo x64. Los binarios no van en git.
  **Comprueba antes de instalar** y muestra el inventario ([OK]/[--]): Node (misma versión → se omite),
  runtime VC++ (registro), MongoDB (servicio + mismo hash de `mongod.exe` → solo se asegura de que
  corre), Ollama (`$modoIA`: «propio» en `C:\DocuPaz\ollama`, «externo» si ya responde el 11434 —se
  usa tal cual, sin tarea—, «sistema» si hay un `ollama.exe` instalado aparte, «instalar» o «ninguna»;
  con cualquiera de los tres primeros se salta directamente al modelo) y el modelo (si `/api/tags` ya
  lo tiene, se omite). Solo se para la tarea de la app (para actualizar sus archivos).
  `preinstalar.ps1` igual: si `wsl --version` responde, no instala ni pide el `.msi` de WSL.
- `instalar.ps1`, `cargar-modelo.ps1`, `preinstalar.ps1` e `instalar-windows.ps1` van en UTF-8 **con BOM**: Windows PowerShell 5.1 lee sin BOM como ANSI (tildes rotas,
  y algunos bytes UTF-8 pasan por comillas tipográficas).
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
