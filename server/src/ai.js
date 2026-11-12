import { z } from "zod";

// IA local vía Ollama (https://ollama.com). Sin suscripciones ni datos fuera de tu máquina.
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:3b";
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 300_000; // en CPU puede tardar

export class AIError extends Error {}

async function chat(messages, format) {
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        ...(format && { format }), // JSON Schema: Ollama obliga al modelo a respetarlo
        options: { temperature: format ? 0 : 0.2, num_ctx: 8192 },
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
  return (await res.json()).message?.content ?? "";
}

// Paso 1: entender la nota y proponer un área (sin ver las existentes, para no sesgarlo)
const Analysis = z.object({
  title: z.string().min(1),
  summary: z.string(),
  keyPoints: z.array(z.string()),
  tags: z.array(z.string()),
  area: z.string().min(1),
  areaDescription: z.string(),
});
const analysisSchema = z.toJSONSchema(Analysis);

const ANALYZE_SYSTEM = `Organizas la base de conocimiento de trabajo de una persona. Analiza la nota y devuelve JSON con:
- title: título claro de la nota (máx. 10 palabras), basado solo en lo que dice.
- summary: resumen de 1-2 frases.
- keyPoints: pasos, comandos, datos o reglas concretas (lista vacía si no hay).
- tags: 3-6 etiquetas cortas en minúsculas, palabras normales.
- area: el área de trabajo general de la nota, 2-4 palabras con espacios y mayúscula inicial, lo bastante amplia para que quepan otras notas parecidas (nada de fechas ni detalles concretos, sin guiones bajos). Evita áreas demasiado genéricas como "Trabajo", "General" u "Otros".
- areaDescription: una frase que describa el área en general (no la nota).
No inventes información. Escribe en el idioma de la nota.`;

// Paso 2: elegir entre las áreas existentes con una lista cerrada (más fiable en modelos pequeños)
const NONE = "NINGUNO";
const CHOOSE_SYSTEM = `Clasificas notas de trabajo en áreas existentes.
Responde con el nombre EXACTO del área a la que pertenece la nota, o "${NONE}" si ninguna trata claramente del mismo tema.
Fíjate en el tema principal de la nota, no en palabras sueltas que coincidan.`;

async function chooseScenario(text, note, scenarios) {
  const names = scenarios.map((s) => s.name);
  const list = scenarios.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  const content = await chat(
    [
      { role: "system", content: CHOOSE_SYSTEM },
      { role: "user", content: `Áreas existentes:\n${list}\n\nNota:\n"""\n${text.slice(0, 2000)}\n"""\nÁrea que se propondría si fuera nueva: ${note.area}` },
    ],
    { type: "object", properties: { area: { type: "string", enum: [...names, NONE] } }, required: ["area"] },
  );
  try {
    const { area } = JSON.parse(content);
    return names.includes(area) ? area : null;
  } catch {
    return null;
  }
}

export async function classifyNote(text, scenarios) {
  const content = await chat(
    [
      { role: "system", content: ANALYZE_SYSTEM },
      { role: "user", content: `Nota:\n"""\n${text}\n"""` },
    ],
    analysisSchema,
  );
  let a;
  try {
    a = Analysis.parse(JSON.parse(content));
  } catch {
    throw new AIError("La IA devolvió un análisis inválido; vuelve a intentarlo.");
  }
  const existing = scenarios.length ? await chooseScenario(text, a, scenarios) : null;
  const { area, areaDescription, ...rest } = a;
  return { ...rest, scenario: existing ?? area, scenarioDescription: areaDescription, isNewScenario: !existing };
}

// Responde una pregunta en lenguaje natural usando solo las notas que ya encontró la búsqueda de texto
const ASK_SYSTEM = `Eres el asistente de la base de conocimiento de trabajo de una persona. Te paso notas que ella ya guardó.
Responde a su pregunta en un par de frases claras y directas, como alguien que conoce el tema y no está adivinando.
Usa solo lo que dicen las notas, con sus pasos y nombres exactos (comandos, rutas, nombres de servicios) cuando los haya.
Si varias notas tratan lo mismo, combínalas en una sola respuesta coherente; no las repitas una por una ni copies todo el contenido.
Si las notas no responden realmente a la pregunta, dilo con naturalidad en vez de forzar una respuesta.
Responde en el idioma de la pregunta, sin inventar nada que no esté en las notas.`;

export async function answerQuestion(question, notes) {
  const context = notes.slice(0, 6).map((n, i) => {
    const points = (n.keyPoints ?? []).map((k) => `- ${k}`).join("\n");
    return `### Nota ${i + 1}: ${n.title}\n${n.summary ?? ""}\n${points}\n${(n.raw ?? "").slice(0, 1500)}`;
  }).join("\n\n");
  const content = await chat([
    { role: "system", content: ASK_SYSTEM },
    { role: "user", content: `Notas guardadas:\n\n${context}\n\nPregunta: ${question}` },
  ]);
  return content.trim();
}
