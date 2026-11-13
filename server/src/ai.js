// IA local vía Ollama (https://ollama.com), usada SOLO como respaldo cuando la búsqueda por texto no
// encuentra nada razonable: reformula la pregunta en palabras clave y se reintenta la búsqueda una vez.
// Nunca redacta una respuesta sobre el contenido de los documentos (evita alucinaciones y uso innecesario de IA).
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 300_000;

export class AIError extends Error {}

const KEYWORDS_SYSTEM = `Conviertes preguntas en palabras clave para buscar documentos.
Responde solo con 3-6 palabras sueltas (sin frases, sin puntuación) que probablemente aparezcan en el
nombre o el contenido del documento buscado, separadas por espacios. Nada más.`;

export async function suggestKeywords(question) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        messages: [
          { role: "system", content: KEYWORDS_SYSTEM },
          { role: "user", content: question },
        ],
        options: { temperature: 0, num_ctx: 4096 },
      }),
    });
  } catch (e) {
    throw new AIError(e.name === "TimeoutError"
      ? "La IA local tardó demasiado en responder."
      : `No se pudo conectar con Ollama en ${OLLAMA_URL}. ¿Está arrancado?`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new AIError(res.status === 404
      ? `El modelo "${MODEL}" no está descargado. Ejecuta: ollama pull ${MODEL}`
      : `Error de Ollama (${res.status}): ${body.slice(0, 200)}`);
  }
  const content = (await res.json()).message?.content ?? "";
  return content.trim();
}
