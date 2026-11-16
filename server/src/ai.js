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

const ANSWER_SYSTEM = `Eres Docu, el asistente de la biblioteca de documentos de la empresa.
Responde en español a la pregunta usando SOLO la información de los fragmentos de documentos que se te
dan, numerados [1], [2]... Reglas:
- No uses conocimientos propios ni inventes datos, cifras, nombres ni fechas.
- Indica de qué documento sale cada dato poniendo su número entre corchetes, p. ej. [2].
- Si te piden documentos o "todo lo" de un tema, cliente, proveedor o proyecto, no digas que no lo
  encuentras: haz una lista con cada documento relacionado ([n] y nombre) y, en una línea, qué dice
  de ese tema.
- Si es una pregunta concreta y los fragmentos no contienen la respuesta, dilo claramente ("No lo
  encuentro en los documentos") y sugiere qué documento de la lista podría revisar.
- Sé breve y concreto: unas pocas frases o una lista corta.`;

async function chat(messages, options = {}) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ model: MODEL, stream: false, messages, options: { temperature: 0, num_ctx: 4096, ...options } }),
    });
  } catch (e) {
    throw new AIError(e.name === "TimeoutError"
      ? "La IA local tardó demasiado en responder."
      : `No se pudo conectar con la IA local (Ollama en ${OLLAMA_URL}).`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new AIError(res.status === 404
      ? `El modelo de IA "${MODEL}" no está instalado en el servidor. Pide al administrador que lo cargue.`
      : `Error de la IA local (${res.status}): ${body.slice(0, 200)}`);
  }
  return ((await res.json()).message?.content ?? "").trim();
}

export function suggestKeywords(question) {
  return chat([
    { role: "system", content: KEYWORDS_SYSTEM },
    { role: "user", content: question },
  ]);
}

// sources: [{filename, folder, text}] en el orden en que se citan ([1] = sources[0])
export function answerFromDocuments(question, sources) {
  const context = sources.map((s, i) => `[${i + 1}] ${s.folder ? `${s.folder}/` : ""}${s.filename}\n${s.text}`).join("\n\n");
  return chat([
    { role: "system", content: ANSWER_SYSTEM },
    { role: "user", content: `Fragmentos de documentos:\n\n${context}\n\nPregunta: ${question}` },
  ], { num_ctx: 8192, num_predict: 600 });
}
