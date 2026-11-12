# Mi conocimiento (notas-ia)

App MERN para guardar lo aprendido en el trabajo en lenguaje natural. Una IA **local** (Ollama) analiza
cada nota, le pone título/resumen/puntos clave/etiquetas, la asigna a un **escenario** (área de trabajo)
y permite preguntar a las notas. Nada depende de APIs de pago.

## Stack
- `server/` Node 22 + Express 5 + Mongoose 9 (ESM, sin TypeScript). Zod 4 para validar la salida de la IA.
- `client/` React 19 + Vite. Un solo componente (`src/App.jsx`), CSS plano en `src/index.css` (claro/oscuro).
- IA: Ollama vía REST (`fetch`, sin SDK). Modelo por defecto `qwen2.5:3b` (`OLLAMA_MODEL`).
- MongoDB 7. Índice de texto en español sobre las notas (`server/src/models.js`).

## Archivos clave
- `server/src/ai.js` – llamadas a Ollama. Clasificación en **2 pasos**:
  1. `classifyNote`: analiza la nota con JSON Schema (`format`) → título, resumen, keyPoints, tags, área propuesta.
     No ve los escenarios existentes, para no sesgarlo.
  2. `chooseScenario`: elige entre los escenarios existentes con un `enum` cerrado (+ `"NINGUNO"`); si es NINGUNO se crea el área propuesta.
  `answerQuestion`: responde solo con las notas encontradas por búsqueda de texto (máx. 6, recortadas a 1500 caracteres).
- `server/src/routes.js` – API REST bajo `/api`: `GET/POST /notes`, `PATCH/DELETE /notes/:id`, `GET /scenarios`, `PATCH /scenarios/:id`, `POST /ask`.
- `server/src/index.js` – Express, contraseña HTTP Basic (`APP_USER`/`APP_PASSWORD`), sirve `client/dist` si existe, manejo de errores (`AIError` → 502).

## Decisiones (no revertir sin motivo)
- Los prompts se probaron con qwen2.5:3b: con un solo paso, o pidiendo "reutilizar escenarios", el modelo mete todo en el primer escenario. El esquema de 2 pasos acertó 6/8 en las pruebas.
- No dar ejemplos de nombres de escenario en el prompt: el modelo 3B los copia literalmente.
- El orden de campos del esquema importa (primero entender la nota, al final el área).
- `temperature: 0` para clasificar, `num_ctx: 8192`, timeout 300 s (en CPU tarda ~20-27 s por nota, ~5 s por pregunta).
- En `NODE_ENV=production` la app no arranca sin `APP_PASSWORD`. Ollama nunca publica su puerto.

## Ejecutar
- Docker local: `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build` → http://localhost:4000 (requiere `APP_PASSWORD` en el entorno o en `.env`).
- Desarrollo: `ollama pull qwen2.5:3b`, MongoDB en marcha, `cd server && cp .env.example .env && npm run dev`, `cd client && npm run dev` → http://localhost:5173 (Vite hace proxy de `/api` a :4000).
- Comprobaciones rápidas: `node --check server/src/*.js`, `cd client && npm run build`. No hay tests automatizados todavía.

## Despliegue (Coolify)
- `docker-compose.yml` está preparado para Coolify (`SERVICE_FQDN_APP_4000`, sin puertos publicados).
- Requisitos del VPS: ~4 GB de RAM libre, 4 vCPU recomendados, ~8 GB de disco, CPU con AVX2. Comprobar con `free -h && nproc && df -h /` antes de desplegar.
- Pendiente: crear el recurso en Coolify y definir `APP_PASSWORD`.

## Estilo
- Código y comentarios en español en la UI/prompts; nombres de variables en inglés.
- Sin dependencias nuevas para cosas que cubre Node/Express (p. ej. la autenticación usa `node:crypto`).
