import { readdirSync, statSync } from "node:fs";
import { processSummaryQueue, markLegacyForSummary } from "./summaries.js";
import path from "node:path";
import { Document } from "./models.js";
import { getActiveLibraryPath, getAppConfig, safeResolve } from "./library.js";
import { ocrAvailable, ocrImage, ocrPdf, OCR_IMAGE_EXTS } from "./ocr.js";
import { extractText, EXTRACTOR_VERSION } from "./extract.js";
import { purgeExpiredTrash } from "./history.js";

const MAX_TEXT = 200_000; // recorte por documento, para no disparar el tamaño del índice

// Documentos indexados antes de existir "hasText": se calcula una vez a partir del texto guardado
async function markLegacyHasText() {
  await Document.updateMany({ hasText: { $exists: false } }, [
    { $set: { hasText: { $gt: [{ $strLenCP: { $trim: { input: { $ifNull: ["$extractedText", ""] } } } }, 0] } } },
  ], { updatePipeline: true }); // Mongoose 9 exige declarar las actualizaciones con pipeline
}

// Documentos indexados antes de existir el OCR: no se vuelven a extraer (no han cambiado), así que se
// marcan aquí una vez. Sin el número de páginas, un PDF con menos de 100 caracteres cuenta como escaneo.
async function markLegacyForOcr() {
  const legacy = { ocrStatus: { $exists: false } };
  await Document.updateMany({ ...legacy, ext: { $in: [...OCR_IMAGE_EXTS] } }, { ocrStatus: "pending" });
  await Document.updateMany(
    { ...legacy, ext: ".pdf", textOk: true, $expr: { $lt: [{ $strLenCP: { $trim: { input: "$extractedText" } } }, 100] } },
    { ocrStatus: "pending" },
  );
  await Document.updateMany(legacy, { ocrStatus: "none" });
}

// Procesa de uno en uno los documentos pendientes de OCR, aparte del escaneo, para que un lote de
// escaneos no frene el indexado normal. Solo guarda el resultado si el archivo no cambió entretanto.
let ocrRunning = false;
export async function processOcrQueue() {
  if (ocrRunning || !(await ocrAvailable())) return;
  ocrRunning = true;
  try {
    for (;;) {
      // lo último indexado primero: un escaneo recién subido no espera detrás del atraso de toda la biblioteca
      const doc = await Document.findOne({ ocrStatus: "pending" }, "path ext mtimeMs extractedText").sort({ updatedAt: -1 }).lean();
      if (!doc) break;
      let update;
      try {
        const abs = safeResolve(await getActiveLibraryPath(), doc.path);
        const text = (doc.ext === ".pdf" ? await ocrPdf(abs) : await ocrImage(abs)).trim();
        update = { ocrStatus: "done" };
        // Con texto nuevo del OCR, el documento pasa a la cola de resúmenes
        if (text.length > doc.extractedText.trim().length) Object.assign(update, { extractedText: text.slice(0, MAX_TEXT), hasText: true, summaryStatus: "pending", summary: "", summaryKeywords: [] });
      } catch (e) {
        console.error(`OCR fallido en ${doc.path}: ${e.message}`);
        update = { ocrStatus: "failed" };
      }
      await Document.updateOne({ _id: doc._id, mtimeMs: doc.mtimeMs, ocrStatus: "pending" }, update);
    }
  } finally {
    ocrRunning = false;
  }
  processSummaryQueue().catch((e) => console.error("Error en la cola de resúmenes:", e));
}

function walk(root) {
  const files = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const abs = path.join(root, rel);
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const relChild = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(relChild);
      else if (e.isFile()) files.push(relChild);
    }
  }
  return files;
}

// Recorre la biblioteca activa, extrae texto de lo nuevo/cambiado y poda lo que ya no existe.
// Pensado para ejecutarse en serie (al arrancar, por intervalo, o bajo demanda); evita solaparse.
let running = false;
export async function scanLibrary() {
  if (running) return;
  running = true;
  try {
    await markLegacyHasText(); // antes del recorrido: sin esto, todo lo antiguo parecería "sin texto" y se releería
    const root = await getActiveLibraryPath();
    const relFiles = walk(root);
    const seenPaths = [];
    for (const rel of relFiles) {
      const abs = path.join(root, rel);
      const stat = statSync(abs);
      const ext = path.extname(rel).toLowerCase();
      const folder = path.dirname(rel) === "." ? "" : path.dirname(rel);
      const topFolder = folder.split("/")[0] || "";
      seenPaths.push(rel);

      const existing = await Document.findOne({ path: rel }, "mtimeMs size hasText extractorVersion").lean();
      const unchanged = existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size;
      // Sin cambios, salvo que se quedara sin texto con un extractor anterior que no sabía leerlo
      if (unchanged && (existing.hasText || (existing.extractorVersion || 0) >= EXTRACTOR_VERSION)) continue;

      const extracted = await extractText(abs, ext);
      await Document.updateOne(
        { path: rel },
        {
          filename: path.basename(rel), ext, folder, topFolder, size: stat.size, mtimeMs: stat.mtimeMs,
          extractedText: extracted.text.slice(0, MAX_TEXT), textOk: extracted.ok, ocrStatus: extracted.needsOcr ? "pending" : "none",
          hasText: extracted.text.trim().length > 0, extractorVersion: EXTRACTOR_VERSION,
          // contenido nuevo o cambiado: resumen nuevo (si no hay texto todavía, lo pedirá el OCR)
          summary: "", summaryKeywords: [], summaryStatus: extracted.text.trim().length > 0 ? "pending" : "none",
        },
        { upsert: true },
      );
    }
    await Document.deleteMany({ path: { $nin: seenPaths } });
    await markLegacyForOcr();
    await markLegacyForSummary();
    processOcrQueue().catch((e) => console.error("Error en la cola de OCR:", e));
    processSummaryQueue().catch((e) => console.error("Error en la cola de resúmenes:", e));

    const config = await getAppConfig();
    config.lastScanAt = new Date();
    config.lastScanCount = seenPaths.length;
    await config.save();
    return { count: seenPaths.length };
  } finally {
    running = false;
  }
}

export function scheduleIndexing() {
  const minutes = Number(process.env.SCAN_INTERVAL_MINUTES) || 15;
  const tick = () => {
    scanLibrary().catch((e) => console.error("Error indexando la biblioteca:", e));
    purgeExpiredTrash().catch((e) => console.error("Error vaciando la papelera caducada:", e));
  };
  tick();
  setInterval(tick, minutes * 60 * 1000);
}
