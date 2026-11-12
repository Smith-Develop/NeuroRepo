# Mi conocimiento (MERN + IA local)

Un chat (estilo ChatGPT) y una **red de conocimiento** neuronal que crece con lo que aprendes. Usa una IA
**local** (Ollama + Qwen2.5 3B): sin suscripciones, tus notas no salen de tu máquina.

Tiene dos roles:
- **Administrador**: cuéntale al chat lo que aprendiste (o pégaselo tal cual con el constructor manual 🧱) →
  la IA propone título, resumen, puntos clave, etiquetas y app → lo corriges y lo guardas. Puede crear
  usuarios, editar/borrar notas y revisar las sugerencias que mandan los demás.
- **Usuario normal**: puede **preguntar** en modo «Buscar» (la IA responde en lenguaje natural con lo ya
  guardado, sin inventar) y **mandar lo que aprendió o un aviso de cambio** al administrador, que decide si
  lo añade a la red.

Desde la barra lateral se muestra u oculta la red de conocimiento, con zoom y arrastre.

## Opción A: todo con Docker (lo más fácil)
Requisito: Docker Desktop. Crea un archivo `.env` en la raíz con tu contraseña:
```
APP_PASSWORD=pon-aqui-tu-contraseña
```
y arranca:
```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```
Abre http://localhost:4000 y entra con usuario `admin` y tu contraseña (así se crea esa primera cuenta; luego puedes crear más usuarios desde «Usuarios» en la barra lateral). La primera vez descarga el modelo (~2 GB) y tarda unos minutos.

## Opción B: sin Docker (desarrollo)
1. Instala **Ollama** (https://ollama.com/download) y descarga el modelo:
   ```bash
   ollama pull qwen2.5:3b
   ```
2. Ten **MongoDB** en marcha (local o MongoDB Atlas gratis).
3. Backend:
   ```bash
   cd server && cp .env.example .env && npm install && npm run dev
   ```
4. Frontend (otra terminal):
   ```bash
   cd client && npm install && npm run dev
   ```
   Abre http://localhost:5173

## Elegir modelo
Variable `OLLAMA_MODEL` (en `server/.env` o al lanzar `docker compose`):
| Modelo | RAM aprox. | Notas |
|---|---|---|
| `qwen2.5:3b` (por defecto) | 4 GB | ~20 s por nota en CPU, clasifica bien la mayoría |
| `qwen2.5:7b` | 8 GB | Clasifica mejor los escenarios; más lento sin GPU |

Con GPU NVIDIA es mucho más rápido: descomenta el bloque `deploy` en `docker-compose.yml`.

## Estructura
Ver `CLAUDE.md` para el detalle de archivos, rutas y decisiones. Resumen rápido:
- `server/src/ai.js` – borrador de nota y respuestas de búsqueda, vía Ollama.
- `server/src/auth.js` / `authRoutes.js` – login por cookie, usuarios y sugerencias.
- `server/src/models.js` – Mongoose: `Scenario`, `Note`, `User`, `Session`, `Suggestion`.
- `server/src/routes.js` – API de notas/escenarios/búsqueda, protegida por rol.
- `client/src/Network.jsx` – red neuronal SVG con zoom/arrastre · `Chat.jsx` – chat · `Sidebar.jsx` – nav
  tipo ChatGPT · `Suggestions.jsx` / `Users.jsx` – paneles de admin · `NoteForm.jsx`/`Builder.jsx` – alta de notas.
