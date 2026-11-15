import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";
import { Document } from "./models.js";
import { getActiveLibraryPath, getAppConfig, safeResolve } from "./library.js";
import { ocrAvailable, ocrImage, ocrPdf, OCR_IMAGE_EXTS } from "./ocr.js";

const MAX_TEXT = 200_000; // recorte por documento, para no disparar el tamaño del índice
const TEXT_EXTS = new Set([".txt", ".md", ".csv"]);
const SHEET_EXTS = new Set([".xlsx", ".xls", ".csv"]);

// Un PDF con menos de esto por página casi seguro que es un escaneo (imágenes sin capa de texto)
const OCR_MIN_CHARS_PER_PAGE = 50;

async function extractText(absPath, ext) {
  try {
    if (ext === ".pdf") {
      const { text, numpages } = await pdfParse(readFileSync(absPath));
      return { ok: true, text, needsOcr: text.replace(/\s+/g, "").length < OCR_MIN_CHARS_PER_PAGE * Math.max(1, numpages) };
    }
    if (ext === ".docx") return { ok: true, text: (await mammoth.extractRawText({ path: absPath })).value };
    if (SHEET_EXTS.has(ext) && ext !== ".csv") {
      const book = XLSX.read(readFileSync(absPath));
      return { ok: true, text: book.SheetNames.map((name) => XLSX.utils.sheet_to_csv(book.Sheets[name])).join("\n") };
    }
    if (TEXT_EXTS.has(ext)) return { ok: true, text: readFileSync(absPath, "utf8") };
    // sin extracción directa: las imágenes pasan a la cola de OCR; el resto se indexa solo por nombre
    return { ok: true, text: "", needsOcr: OCR_IMAGE_EXTS.has(ext) };
  } catch {
    return { ok: false, text: "" };
  }
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
        if (text.length > doc.extractedText.trim().length) update.extractedText = text.slice(0, MAX_TEXT);
      } catch (e) {
        console.error(`OCR fallido en ${doc.path}: ${e.message}`);
        update = { ocrStatus: "failed" };
      }
      await Document.updateOne({ _id: doc._id, mtimeMs: doc.mtimeMs, ocrStatus: "pending" }, update);
    }
  } finally {
    ocrRunning = false;
  }
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

      const existing = await Document.findOne({ path: rel }, "mtimeMs size").lean();
      if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) continue;

      const extracted = await extractText(abs, ext);
      await Document.updateOne(
        { path: rel },
        {
          filename: path.basename(rel), ext, folder, topFolder, size: stat.size, mtimeMs: stat.mtimeMs,
          extractedText: extracted.text.slice(0, MAX_TEXT), textOk: extracted.ok, ocrStatus: extracted.needsOcr ? "pending" : "none",
        },
        { upsert: true },
      );
    }
    await Document.deleteMany({ path: { $nin: seenPaths } });
    await markLegacyForOcr();
    processOcrQueue().catch((e) => console.error("Error en la cola de OCR:", e));

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
  scanLibrary().catch((e) => console.error("Error indexando la biblioteca:", e));
  setInterval(() => scanLibrary().catch((e) => console.error("Error indexando la biblioteca:", e)), minutes * 60 * 1000);
}
