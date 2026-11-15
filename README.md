# NeuroRepo — Biblioteca de documentos con IA

Gestor documental (parecido a Alfresco Community, con IA) para la documentación del trabajo. Interfaz
tipo ChatGPT: en el chat se **busca** por coincidencia de texto (la IA solo entra como respaldo si la
búsqueda no encuentra nada razonable, y nunca redacta la respuesta) y los resultados se pueden **ver**
en línea o **descargar**. También hay un explorador de carpetas (`Documentos`) para navegar todo lo
indexado, en lista o en tarjetas.

Los documentos viven en una carpeta normal del disco (fuera de la app); Mongo solo guarda el índice
(metadatos + texto extraído), nunca el archivo en sí.

<p align="center">
  <img src="docs/screenshots/login.jpg" width="49%" alt="Pantalla de inicio de sesión" />
  <img src="docs/screenshots/chat.jpg" width="49%" alt="Asistente de búsqueda (Docu)" />
</p>
<p align="center">
  <img src="docs/screenshots/documentos.jpg" width="49%" alt="Explorador de carpetas" />
  <img src="docs/screenshots/grupos.jpg" width="49%" alt="Grupos y permisos" />
</p>

Roles:
- **Usuario normal**: se da de alta con **nombre + DNI, sin contraseña**; entra escribiendo solo su DNI.
  Solo puede buscar/consultar las carpetas que le permita su grupo (sin grupo, no ve ninguna).
- **admin**: mantiene contraseña (puede cambiarla desde el botón de la llave, junto a «Cerrar sesión»).
  Gestiona usuarios, grupos (qué carpetas ve cada uno) y la biblioteca activa («Vincular biblioteca»:
  elegir carpeta, crear/renombrar/borrar carpetas, subir archivos, papelera). Puede haber varios admins.

Nada depende de APIs de pago: Mongo, Ollama, el OCR y el almacenamiento son todos locales.

## Qué hace
- **Búsqueda por texto** en nombre, carpeta y contenido de PDF, Word (`.docx`), Excel (`.xlsx`/`.xls`),
  CSV, TXT y Markdown. Si no encuentra nada razonable, la IA local convierte la pregunta en palabras
  clave y se reintenta una vez; nunca inventa una respuesta.
- **OCR de escaneos e imágenes**: los PDF escaneados (sin capa de texto) y las fotos de documentos
  (`.png`, `.jpg`, `.tif`, `.bmp`, `.webp`) se leen con Tesseract en segundo plano, así que también se
  encuentran por su contenido. El progreso se ve en «Vincular biblioteca» (columna «OCR»).
- **Vista previa** en el propio navegador de PDF, imágenes, texto, **Word y Excel** (con una pestaña por
  hoja; las hojas muy grandes se recortan a 2000 filas × 50 columnas). Vídeo y audio se reproducen en
  el propio chat. El `.doc` antiguo de Word solo se puede descargar.
- **Versiones**: si el admin sube un archivo con el mismo nombre que uno existente, el anterior no se
  pierde: queda como versión (se guardan las 10 últimas). Desde la vista previa, botón «Versiones», se
  pueden descargar o restaurar.
- **Papelera**: lo que se borra desde la app (un archivo desde `Documentos`, o una carpeta entera desde
  «Vincular biblioteca») va a la papelera y se puede recuperar durante 30 días; después se elimina solo.
- **Permisos por carpeta y subcarpeta**: un grupo puede tener acceso a una carpeta entera o solo a una
  subcarpeta (p. ej. `Calidad/Procedimientos`); cada carpeta marcada incluye todas las suyas. Quien
  busque algo de una carpeta sin permiso recibe el mensaje que el admin haya configurado para esa
  carpeta (o el de la carpeta superior más cercana), y puede pulsar «Solicitar acceso».
- **Registro** de quién consultó, subió, borró o cambió qué (solo lo ve el admin).
- `Documentos` carga cada carpeta al abrirla, así que sigue yendo ágil con bibliotecas grandes.

Límite a tener en cuenta: las versiones y la papelera solo cubren lo que se hace **desde la app**. Si
alguien edita o borra un archivo directamente en la carpeta del servidor, ese cambio no deja copia.

## Puesta en marcha rápida (Docker)
Requisito: Docker Desktop (o Docker Engine + el plugin `compose` en Linux).

1. Crea un archivo `.env` en la raíz:
   ```
   DOCS_HOST_PATH=./documentos-prueba        # carpeta del host con los documentos
   BOOTSTRAP_ADMIN_NAME=Administrador
   BOOTSTRAP_ADMIN_DNI=00000000A
   BOOTSTRAP_ADMIN_PASSWORD=pon-aqui-una-contraseña
   OLLAMA_MODEL=qwen2.5:3b
   ```
2. Arranca:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
   ```
3. Abre http://localhost:4000 y entra con el DNI y la contraseña del admin (así se crea esa primera
   cuenta). La primera vez descarga el modelo de IA (de 1 a 2 GB según el modelo) y tarda unos minutos.
   Si la biblioteca tiene muchos escaneos o imágenes, el OCR seguirá trabajando en segundo plano un rato
   (ver [Consumo de recursos](#consumo-de-recursos)); la búsqueda funciona desde el primer momento.

La carpeta de documentos se monta **de lectura/escritura**: la app crea ahí dentro dos carpetas ocultas,
`.versiones` y `.papelera`, que no se indexan ni aparecen en la interfaz. No las borres a mano si
quieres conservar las versiones y lo que haya en la papelera.

### En Windows, sin usar la terminal
Si vas a instalarlo en un ordenador con Windows para compartirlo por la red local con compañeros, usa
el instalador incluido. No hace falta tener ya el proyecto descargado ni saber de Git ni de Docker:

1. Descarga solo estos dos archivos (botón derecho → «Guardar enlace como…») en cualquier carpeta:
   [`Instalar.bat`](https://raw.githubusercontent.com/Smith-Develop/NeuroRepo/main/Instalar.bat) y
   [`instalar.ps1`](https://raw.githubusercontent.com/Smith-Develop/NeuroRepo/main/instalar.ps1)
   (o, si ya tienes clonado el repositorio entero, úsalos directamente desde ahí).
2. Haz doble clic en `Instalar.bat`.

A partir de ahí el instalador hace todo solo, sin más intervención que responder lo que pregunta:
- Si todavía no tiene el proyecto al lado (es el caso del paso 1), **descarga NeuroRepo entero desde
  GitHub** él mismo (con `git clone` si hay Git instalado, o un `.zip` si no) en la carpeta que le
  digas (por defecto `%USERPROFILE%\NeuroRepo`), y continúa la instalación ya desde esa copia.
- Comprueba si hace falta Docker Desktop (lo instala solo si no está, reiniciando el equipo si es
  necesario — al volver a iniciar sesión el propio instalador continúa solo donde lo dejó).
- Pide por pantalla la configuración (nombre/DNI/contraseña del admin, carpeta de documentos, modelo
  de IA, intervalo de reindexado) y la guarda en `.env`.
- Abre el puerto 4000 en el Firewall de Windows y levanta todo con `docker compose`.
- Al terminar muestra la URL para compartir con el resto del equipo en la misma red
  (`http://<ip-del-pc>:4000`).

Si ya tienes el proyecto entero descargado (por ejemplo, lo clonaste con Git), el instalador detecta
que ya está ahí y se salta el paso de descarga.

## Si se pierde la contraseña del admin
No hay recuperación por email (la app no depende de ningún servicio de correo). Si hay otro admin,
puede ponerle una contraseña nueva desde `Usuarios`. Si no, desde el ordenador donde está instalado:

- **Windows**: doble clic en `Restablecer-admin.bat` (en la carpeta del proyecto) y escribe el DNI del
  admin.
- **Cualquier sistema**, desde la carpeta del proyecto:
  ```bash
  docker compose -f docker-compose.yml -f docker-compose.local.yml exec app node src/resetAdmin.js 00000000A
  ```
  Sin DNI, lista los admins que existen.

En ambos casos pide la contraseña nueva dos veces (sin mostrarla), cierra todas las sesiones abiertas de
ese admin y lo anota en el Registro. Hace falta acceso al propio servidor, que es la prueba de confianza.

## Consumo de recursos
Medido con `docker stats` en un equipo de 4 núcleos con Docker Desktop limitado a 3,6 GB de RAM, sobre
una biblioteca real de **2394 documentos** (unos 1500 de ellos imágenes o PDF escaneados) y el modelo
`qwen2.5:1.5b`.

**Memoria RAM**
| Servicio | En reposo | Trabajando |
|---|---|---|
| `app` (Node + OCR) | ~75 MB | ~100–125 MB con el OCR en marcha |
| `mongo` | ~275 MB | igual |
| `ollama` (modelo cargado) | ~1,2 GB con `qwen2.5:1.5b` | igual (el modelo se queda cargado en memoria) |
| **Total** | **~1,6 GB** | **~1,7 GB** |

Con `qwen2.5:3b` (el modelo por defecto) Ollama necesita aproximadamente el doble (unos 2,5 GB), y con
`qwen2.5:7b` unos 5–6 GB.

**CPU**
- En reposo: prácticamente nada (por debajo del 2 % entre todos los servicios).
- **OCR**: ~1 núcleo mientras haya cola (Tesseract trabaja con un solo hilo para no bloquear el resto).
  Cada página tarda unos **3,5 s** (0,9 s en pasar el PDF a imagen + 2,6 s de Tesseract). La primera
  pasada sobre la biblioteca de prueba (≈1500 imágenes y escaneos) tardó **unos 30 minutos**; después
  solo se procesa lo nuevo o modificado. Los PDF se leen como mucho hasta la página 30.
- **IA** (solo cuando la búsqueda por texto no encuentra nada razonable): usa los 4 núcleos durante
  unos **5 s por pregunta** con `qwen2.5:1.5b` sin GPU. Con modelos más grandes tarda más; con GPU
  NVIDIA, mucho menos.
- La búsqueda normal por texto responde en menos de 0,2 s.

**Disco**
| Qué | Tamaño |
|---|---|
| Imagen de la app (`neurorepo-app`, incluye Tesseract y Poppler) | 445 MB |
| Imagen `mongo:7` | 1,2 GB |
| Imagen `ollama/ollama` (incluye librerías para GPU) | 8,5 GB |
| Modelo de IA | ~1 GB (`qwen2.5:1.5b`) · ~1,9 GB (`qwen2.5:3b`) · ~4,7 GB (`qwen2.5:7b`) |
| Datos de Mongo (volumen) | ~330 MB (el índice de los 2394 documentos ocupa menos de 5 MB) |
| `.versiones` y `.papelera` | lo que ocupen los archivos guardados (10 versiones por archivo como mucho; la papelera se vacía sola a los 30 días) |

**Equipo recomendado**: 4 núcleos con AVX2, **4 GB de RAM libres** para Docker con `qwen2.5:3b` (2 GB
bastan con `qwen2.5:1.5b`) y unos **15 GB de disco** para imágenes y modelo, más el espacio de los
propios documentos.

## Desarrollo (sin Docker)
1. Instala **Ollama** (https://ollama.com/download) y el modelo:
   ```bash
   ollama pull qwen2.5:3b
   ```
2. Ten **MongoDB** en marcha (local o Atlas gratis).
3. (Opcional) Para el OCR, instala `tesseract` con el idioma español y `poppler-utils` (por ejemplo
   `sudo apt install tesseract-ocr tesseract-ocr-spa poppler-utils`). Si no están, la app funciona
   igual y lo avisa en el log: simplemente no lee los escaneos.
4. Backend:
   ```bash
   cd server && cp .env.example .env   # ajusta LIBRARY_ROOT a una carpeta local de prueba
   npm install && npm run dev
   ```
5. Frontend (otra terminal):
   ```bash
   cd client && npm install && npm run dev
   ```
   Abre http://localhost:5173 (Vite hace proxy de `/api` al backend en :4000).

Comprobaciones: `cd server && npm test` (tests de la lógica de permisos, con `node:test`, sin
dependencias) y `cd client && npm run build`.

## Elegir modelo de IA
Variable `OLLAMA_MODEL` (en `.env` o en `server/.env`). La IA solo se usa como respaldo de la búsqueda
por texto (reformula la pregunta en palabras clave), así que un modelo pequeño suele bastar:
| Modelo | RAM aprox. | Notas |
|---|---|---|
| `qwen2.5:1.5b` | 1,2 GB (medido) | El más ligero; ~5 s por pregunta en CPU. Suficiente para palabras clave |
| `qwen2.5:3b` (por defecto) | ~2,5 GB | Algo más fino reformulando |
| `qwen2.5:7b` | ~5–6 GB | Más preciso; bastante más lento sin GPU |

Con GPU NVIDIA es mucho más rápido: descomenta el bloque `deploy` en `docker-compose.yml`.

## Otras variables de entorno
Todas tienen un valor por defecto razonable. En Docker, para cambiarlas añádelas al bloque
`environment` del servicio `app` en `docker-compose.yml`.
| Variable | Por defecto | Para qué |
|---|---|---|
| `SCAN_INTERVAL_MINUTES` | 15 | Cada cuánto se reindexa la biblioteca |
| `OCR_ENABLED` | activado | `false` desactiva el OCR |
| `OCR_MAX_PAGES` | 30 | Páginas como mucho que se leen por PDF escaneado |
| `OCR_LANG` | `spa` | Idioma de Tesseract (la imagen Docker solo trae español) |
| `VERSIONS_MAX` | 10 | Versiones anteriores que se guardan por archivo |
| `TRASH_RETENTION_DAYS` | 30 | Días que se conserva lo borrado antes de eliminarse solo |
| `AI_FALLBACK_SCORE` | 0.3 | Por debajo de esta puntuación de búsqueda se recurre a la IA |
| `OLLAMA_TIMEOUT_MS` | 300000 | Tiempo máximo de espera a la IA |

## Estructura
Ver `CLAUDE.md` para el detalle de archivos, rutas y decisiones. Resumen rápido:
- `server/src/library.js` / `indexer.js` – biblioteca activa, operaciones sobre carpetas y archivos,
  escaneo e indexado de documentos. `ocr.js` – OCR con Tesseract y Poppler.
  `history.js` – versiones y papelera.
- `server/src/search.js` – búsqueda por texto (Mongo `$text` + reordenado). `ai.js` – respaldo de la IA
  (solo palabras clave, nunca redacta respuestas).
- `server/src/auth.js` / `authRoutes.js` – login (DNI, o DNI+contraseña para el admin), permisos por
  carpeta, usuarios, grupos. `resetAdmin.js` – recuperación de la contraseña del admin por consola.
- `server/src/models.js` – Mongoose: `Document`, `Group`, `FolderConfig`, `User`, `Session`,
  `ActivityLog`, `FileVersion`, `TrashItem`.
- `client/src/Chat.jsx` – búsqueda tipo chat · `Explorer.jsx` – árbol de carpetas (lista/tarjetas) ·
  `DocumentModal.jsx` – vista previa y versiones · `LibraryPicker.jsx` – «Vincular biblioteca» y
  papelera · `Users.jsx`/`Groups.jsx`/`ActivityLog.jsx` – paneles de admin.
- `instalar.ps1` / `Instalar.bat` – instalador para Windows, capaz de descargar el proyecto desde
  GitHub por sí solo (ver sección de arriba). `Restablecer-admin.bat` – recuperación de contraseña.
