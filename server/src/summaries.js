// Resúmenes de los documentos con la IA local, en segundo plano y de uno en uno (como el OCR): cada
// documento con texto guarda `summary` (1–2 frases) y `summaryKeywords`, que se muestran en el chat y
// entran en el índice de texto con más peso que el contenido. Es un añadido: la búsqueda sigue usando
// el texto completo, porque el modelo pequeño puede resumir mal y un resumen pierde datos concretos.
//
// Prioridad baja: si alguien usa la IA en el chat, el resumen en curso se cancela (ai.js) y la cola
// espera a que el chat lleve IDLE_MS sin usarla. Si Ollama no responde, la cola se para y se vuelve a
// intentar en el siguiente escaneo.
import { Document } from "./models.js";
import { summarizeDocument, msSinceInteractive } from "./ai.js";

export const SUMMARIES_ENABLED = process.env.SUMMARIES_ENABLED !== "false";
const IDLE_MS = Number(process.env.SUMMARY_IDLE_SECONDS || 60) * 1000;
const TEXT_CHARS = 2500; // principio del documento que lee la IA
const MIN_TEXT = 40; // con menos texto no hay nada que resumir

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lo que se le pasa a la IA: el principio del texto, sin espacios de sobra
export function summarySource(text) {
  return (text || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, TEXT_CHARS);
}

let running = false;
export async function processSummaryQueue() {
  if (!SUMMARIES_ENABLED || running) return;
  running = true;
  try {
    for (;;) {
      if (msSinceInteractive() < IDLE_MS) { await sleep(5000); continue; }
      // Lo último indexado primero; los que esperan OCR, cuando tengan texto
      const doc = await Document.findOne({ summaryStatus: "pending", ocrStatus: { $ne: "pending" } }, "filename folder mtimeMs extractedText")
        .sort({ updatedAt: -1 }).lean();
      if (!doc) break;
      const text = summarySource(doc.extractedText);
      if (text.length < MIN_TEXT) {
        await Document.updateOne({ _id: doc._id, summaryStatus: "pending" }, { summaryStatus: "none" });
        continue;
      }
      try {
        const { summary, keywords } = await summarizeDocument({ filename: doc.filename, folder: doc.folder, text });
        // Solo si el archivo no cambió mientras tanto (si cambió, el indexador ya lo dejó pendiente otra vez)
        await Document.updateOne({ _id: doc._id, mtimeMs: doc.mtimeMs, summaryStatus: "pending" }, { summary, summaryKeywords: keywords, summaryStatus: "done" });
      } catch (e) {
        if (e.cause === "aborted") continue; // lo canceló el chat: se repite cuando vuelva a estar libre
        if (e.cause === "bad-output") {
          await Document.updateOne({ _id: doc._id, summaryStatus: "pending" }, { summaryStatus: "failed" });
          continue;
        }
        console.error(`Resúmenes en pausa hasta el próximo escaneo: ${e.message}`);
        break; // Ollama caído o sin el modelo
      }
    }
  } finally {
    running = false;
  }
}

// Documentos de antes de los resúmenes (sin el campo): pendientes si tienen texto
export async function markLegacyForSummary() {
  await Document.updateMany({ summaryStatus: { $exists: false }, hasText: true }, { summaryStatus: "pending" });
  await Document.updateMany({ summaryStatus: { $exists: false } }, { summaryStatus: "none" });
}
