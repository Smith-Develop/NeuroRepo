// IA local vía Ollama (https://ollama.com). Dos usos:
//  - Búsqueda simple: SOLO como respaldo cuando la búsqueda por texto no encuentra nada razonable;
//    reformula la pregunta en palabras clave y se reintenta la búsqueda una vez.
//  - Búsqueda avanzada (la elige el usuario en el chat): responde a la pregunta usando ÚNICAMENTE
//    fragmentos de los documentos encontrados (y que el usuario puede ver), citándolos con [n]. Si la
//    respuesta no está en esos fragmentos, debe decirlo en vez de inventar.
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 300_000;

export class AIError extends Error {}

const KEYWORDS_SYSTEM = `Conviertes preguntas en palabras clave para buscar documentos.
Responde solo con 3-6 palabras sueltas (sin frases, sin puntuación) que probablemente aparezcan en el
nombre o el contenido del documento buscado, separadas por espacios. Nada más.`;

const ANSWER_SYSTEM = `Eres Docu, el asistente de la biblioteca de documentos de la empresa. Conversas con
el usuario como un compañero que conoce bien esos documentos.
Responde en español usando SOLO la información de los fragmentos de documentos del último mensaje,
numerados [1], [2], y lo ya hablado en la conversación. Reglas:
- Ve al grano: responde directamente en 1 a 4 frases, o con una lista corta de pasos si es un
  procedimiento. No repitas la pregunta ni describas los documentos.
- Pon el número del documento entre corchetes justo después del dato que sale de él, p. ej. [1].
- No uses conocimientos propios ni inventes datos, pasos, cifras, nombres ni fechas.
- Si piden documentos o "todo lo" de un tema, resume en una o dos frases qué contiene el documento [1]
  sobre ese tema.
- Si hay apuntes de la "Guía rápida", son la fuente PRIORITARIA (los mantiene el equipo y están al
  día): úsalos primero y cítalos como [Guía]. Copia tal cual rutas, direcciones, números y nombres.
- Si los fragmentos no tienen la respuesta, dilo en una sola frase ("No he encontrado eso en los
  documentos.") sin añadir nada más.`;

// Las peticiones del chat tienen prioridad sobre los resúmenes en segundo plano (summaries.js): al
// llegar una, se cancela el resumen en curso (se repetirá después) y la cola espera a que el chat
// lleve un rato sin usar la IA.
let lastInteractiveAt = 0;
let backgroundAbort = null;
export const msSinceInteractive = () => Date.now() - lastInteractiveAt;

async function chat(messages, options = {}, { background = false, format } = {}) {
  let res;
  const signals = [AbortSignal.timeout(TIMEOUT_MS)];
  if (background) {
    backgroundAbort = new AbortController();
    signals.push(backgroundAbort.signal);
  } else {
    lastInteractiveAt = Date.now();
    backgroundAbort?.abort();
  }
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any(signals),
      body: JSON.stringify({ model: MODEL, stream: false, messages, ...(format ? { format } : {}), options: { temperature: 0, num_ctx: 4096, ...options } }),
    });
  } catch (e) {
    if (e.name === "AbortError") throw new AIError("cancelado", { cause: "aborted" });
    throw new AIError(e.name === "TimeoutError"
      ? "La IA local tardó demasiado en responder."
      : `No se pudo conectar con la IA local (Ollama en ${OLLAMA_URL}).`, { cause: "unreachable" });
  } finally {
    if (!background) lastInteractiveAt = Date.now();
  }
  if (!res.ok) {
    const body = await res.text();
    throw new AIError(res.status === 404
      ? `El modelo de IA "${MODEL}" no está instalado en el servidor. Pide al administrador que lo cargue.`
      : `Error de la IA local (${res.status}): ${body.slice(0, 200)}`);
  }
  return ((await res.json()).message?.content ?? "").trim();
}

// Resumen de un documento para el índice: {summary, keywords}. Solo con el principio del texto (el
// modelo pequeño no da para más en una CPU) y en JSON, para no tener que adivinar el formato.
const SUMMARY_SYSTEM = `Eres un archivero del servicio de Informática de un hospital. Te paso el nombre, la
carpeta y el principio de un documento. Devuelve SOLO un JSON {"resumen": "...", "palabras": ["...", ...]}:
- "resumen": 1 o 2 frases en español que digan de qué trata y para qué sirve el documento (sin inventar
  nada que no esté en el texto; sin datos personales, contraseñas ni números de teléfono).
- "palabras": de 3 a 8 palabras clave en español, en minúsculas: aplicaciones, temas y tareas que trata.`;
export async function summarizeDocument({ filename, folder, text }) {
  const content = `Nombre: ${filename}\nCarpeta: ${folder || "(raíz)"}\n\nTexto:\n${text}`;
  const raw = await chat([{ role: "system", content: SUMMARY_SYSTEM }, { role: "user", content }], { num_predict: 220 }, { background: true, format: "json" });
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AIError("La IA no devolvió un JSON válido.", { cause: "bad-output" });
  }
  const summary = typeof data.resumen === "string" ? data.resumen.replace(/\s+/g, " ").trim().slice(0, 500) : "";
  const keywords = (Array.isArray(data.palabras) ? data.palabras : [])
    .filter((k) => typeof k === "string")
    .map((k) => k.trim().toLowerCase().slice(0, 40))
    .filter(Boolean)
    .slice(0, 8);
  if (!summary) throw new AIError("La IA devolvió un resumen vacío.", { cause: "bad-output" });
  return { summary, keywords: [...new Set(keywords)] };
}

export function suggestKeywords(question) {
  return chat([
    { role: "system", content: KEYWORDS_SYSTEM },
    { role: "user", content: question },
  ]);
}

// sources: [{filename, folder, text}] en el orden en que se citan ([1] = sources[0]).
// history: [{q, a}] turnos anteriores de la conversación (modo avanzado), del más antiguo al último.
// guide: [{title, body}] apuntes de la Guía rápida que coinciden con la pregunta (van primero)
export function answerFromDocuments(question, sources, history = [], guide = []) {
  const guideText = guide.map((g) => `[Guía] ${g.category ? `${g.category} · ` : ""}${g.title}\n${g.body.slice(0, 2000)}`).join("\n\n");
  const docsText = sources.map((s, i) => `[${i + 1}] ${s.folder ? `${s.folder}/` : ""}${s.filename}\n${s.text}`).join("\n\n");
  const context = [guideText && `Guía rápida:\n\n${guideText}`, docsText && `Fragmentos de documentos:\n\n${docsText}`].filter(Boolean).join("\n\n");
  return chat([
    { role: "system", content: ANSWER_SYSTEM },
    ...history.flatMap((h) => [{ role: "user", content: h.q }, { role: "assistant", content: h.a }]),
    { role: "user", content: `${context}\n\nPregunta: ${question}` },
  ], { num_ctx: 8192, num_predict: 500 });
}
