# Mi conocimiento (MERN + IA local)

Un chat (estilo ChatGPT) y un **árbol de conocimiento** que crece con lo que aprendes. Usa una IA **local**
(Ollama + Qwen2.5 3B): sin suscripciones, tus notas no salen de tu máquina.

1. Cuéntale al chat lo que aprendiste, tal como te salga.
2. La IA te propone título, resumen, puntos clave, etiquetas y la rama del árbol. **Lo corriges y lo guardas.**
3. Tu árbol crece: cada rama es un área de trabajo y cada hoja una nota.
4. Para consultar, pregunta en modo «Buscar» (o empieza con «¿»): te muestra **lo que ya tienes guardado**,
   sin inventar nada, y lo ilumina en el árbol. Haz clic en una hoja para verla, editarla o borrarla.

## Opción A: todo con Docker (lo más fácil)
Requisito: Docker Desktop. Crea un archivo `.env` en la raíz con tu contraseña:
```
APP_PASSWORD=pon-aqui-tu-contraseña
```
y arranca:
```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```
Abre http://localhost:4000 (usuario `admin` y tu contraseña). La primera vez descarga el modelo (~2 GB) y tarda unos minutos.

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
- `server/src/ai.js` – llamadas a Ollama: borrador de la nota (JSON con esquema) y elección de rama en 2 pasos
- `server/src/models.js` – Mongoose: `Scenario`, `Note` (índice de texto en español)
- `server/src/routes.js` – API REST: `/api/notes/draft`, `/api/notes`, `/api/scenarios`
- `client/src/Tree.jsx` – árbol SVG animado · `Chat.jsx` – chat · `NoteForm.jsx` – revisión/edición
