# Mi conocimiento (notas-ia)

App MERN para guardar lo aprendido en el trabajo. Interfaz tipo ChatGPT + un **árbol de conocimiento** visual
(raíz → ramas = escenarios → hojas = notas) que crece con cada nota. Flujo:
1. La persona escribe lo que aprendió → una IA **local** (Ollama) propone un borrador (título, resumen, puntos clave, etiquetas, rama).
2. La persona lo **revisa y corrige** en el chat → solo entonces se guarda.
3. Al buscar, **la IA no redacta respuestas**: se devuelven las notas guardadas tal cual y se iluminan en el árbol.
Nada depende de APIs de pago.

## Stack
- `server/` Node 22 + Express 5 + Mongoose 9 (ESM, sin TypeScript). Zod 4 para validar la salida de la IA.
- `client/` React 19 + Vite, sin librerías de UI ni de gráficos. CSS plano en `src/index.css` (tema oscuro).
- IA: Ollama vía REST (`fetch`, sin SDK). Modelo por defecto `qwen2.5:3b` (`OLLAMA_MODEL`).
- MongoDB 7. Índice de texto en español sobre las notas (`server/src/models.js`).

## Archivos clave
- `server/src/ai.js` – solo clasifica (Ollama, `fetch`). `classifyNote` en **2 pasos**:
  1. Analiza la nota con JSON Schema (`format`) → título, resumen, keyPoints, tags, área propuesta. No ve los escenarios existentes, para no sesgarlo.
  2. `chooseScenario`: elige entre los escenarios existentes con un `enum` cerrado (+ `"NINGUNO"`); si es NINGUNO se usa el área propuesta. Devuelve `isNewScenario`.
- `server/src/routes.js` – API bajo `/api`:
  - `POST /notes/draft {text}` → borrador de la IA, **no guarda nada**.
  - `POST /notes {raw,title,summary,keyPoints,tags,scenario,scenarioDescription}` → guarda lo revisado (`noteFields` valida y limita tamaños). La rama se busca por nombre sin distinguir mayúsculas o se crea con un color libre.
  - `GET /notes` (todas, para el árbol) · `GET /notes?q=` búsqueda `$text` + `rerank` (palabras distintas de la pregunta que aparecen, raíz de 5 letras sin tildes).
  - `PATCH /notes/:id` (parcial; puede cambiar de rama), `DELETE /notes/:id`. Las ramas que se quedan sin notas se podan (`prune`).
  - `GET /scenarios`, `PATCH /scenarios/:id`.
- `server/src/models.js` – `Scenario {name, description, color}` (`color` = índice de la paleta de 8), `Note`.
- `server/src/index.js` – Express, contraseña HTTP Basic (`APP_USER`/`APP_PASSWORD`), sirve `client/dist`, errores (`AIError` → 502).
- `client/src/Tree.jsx` – SVG propio: dendrograma radial (tronco de hebras, ramas con brillo `feGaussianBlur`, hojas en un arco). Animaciones: crecimiento con `stroke-dashoffset` (solo lo nuevo, por `key` estable), `transition: d` y `transform` al reordenar, pulso en la hoja recién guardada (`freshId`) y en resultados (`highlight`). `PALETTE` debe tener `PALETTE_SIZE` (8) colores, como en `routes.js`.
- `client/src/Chat.jsx` – chat estilo ChatGPT. Modos «Aprendí algo» / «Buscar» (pasa solo a Buscar si el texto empieza por «¿» o termina en «?»). Mensajes tipo `text|loading|error|draft|saved|results`. El historial vive solo en memoria.
- `client/src/NoteForm.jsx` – formulario de revisión/edición (reutilizado en el chat y en el panel de la hoja). `NoteCard.jsx` – nota guardada.
- `client/src/App.jsx` – layout (árbol | chat; en móvil, pestañas), carga de datos, panel de la hoja seleccionada (ver/editar/borrar).

## Decisiones (no revertir sin motivo)
- Los prompts se probaron con qwen2.5:3b: con un solo paso, o pidiendo "reutilizar escenarios", el modelo mete todo en el primer escenario. El esquema de 2 pasos acertó 6/8 en las pruebas.
- No dar ejemplos de nombres de escenario en el prompt: el modelo 3B los copia literalmente.
- El orden de campos del esquema importa (primero entender la nota, al final el área).
- La búsqueda nunca genera texto con la IA (antes inventaba); solo devuelve lo guardado.
- `temperature: 0` para clasificar, `num_ctx: 8192`, timeout 300 s (en CPU tarda ~20-27 s por borrador; la búsqueda es instantánea).
- En `NODE_ENV=production` la app no arranca sin `APP_PASSWORD`. Ollama nunca publica su puerto.

## Ejecutar
- Docker local: `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build` → http://localhost:4000 (requiere `APP_PASSWORD` en el entorno o en `.env`).
- Desarrollo: `ollama pull qwen2.5:3b`, MongoDB en marcha, `cd server && cp .env.example .env && npm run dev`, `cd client && npm run dev` → http://localhost:5173 (Vite hace proxy de `/api` a :4000).
- Comprobaciones rápidas: `node --check server/src/*.js`, `cd client && npm run build`. No hay tests automatizados todavía.
- Pendientes conocidos: zoom/arrastre del árbol (en móvil se ve pequeño), paginar `GET /notes` si pasa de ~2000 hojas, guardar el historial del chat.

## Despliegue (Coolify)
- `docker-compose.yml` está preparado para Coolify (`SERVICE_FQDN_APP_4000`, sin puertos publicados).
- Requisitos del VPS: ~4 GB de RAM libre, 4 vCPU recomendados, ~8 GB de disco, CPU con AVX2. Comprobar con `free -h && nproc && df -h /` antes de desplegar.
- Pendiente: crear el recurso en Coolify y definir `APP_PASSWORD`.

## Estilo
- Código y comentarios en español en la UI/prompts; nombres de variables en inglés.
- Sin dependencias nuevas para cosas que cubre Node/Express (p. ej. la autenticación usa `node:crypto`).
