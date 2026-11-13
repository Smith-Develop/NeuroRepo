import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";
import { Document } from "./models.js";
import { getActiveLibraryPath, getAppConfig } from "./library.js";

const MAX_TEXT = 200_000; // recorte por documento, para no disparar el tamaño del índice
const TEXT_EXTS = new Set([".txt", ".md", ".csv"]);
const SHEET_EXTS = new Set([".xlsx", ".xls", ".csv"]);

async function extractText(absPath, ext) {
  try {
    if (ext === ".pdf") return (await pdfParse(readFileSync(absPath))).text;
    if (ext === ".docx") return (await mammoth.extractRawText({ path: absPath })).value;
    if (SHEET_EXTS.has(ext) && ext !== ".csv") {
      const book = XLSX.read(readFileSync(absPath));
      return book.SheetNames.map((name) => XLSX.utils.sheet_to_csv(book.Sheets[name])).join("\n");
    }
    if (TEXT_EXTS.has(ext)) return readFileSync(absPath, "utf8");
    return { ok: true, text: "" }; // formato sin extracción (imágenes, etc.): se indexa solo por nombre
  } catch {
    return { ok: false, text: "" };
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
      const ok = extracted?.ok !== false;
      const text = (typeof extracted === "string" ? extracted : extracted.text || "").slice(0, MAX_TEXT);
      await Document.updateOne(
        { path: rel },
        { filename: path.basename(rel), ext, folder, topFolder, size: stat.size, mtimeMs: stat.mtimeMs, extractedText: text, textOk: ok },
        { upsert: true },
      );
    }
    await Document.deleteMany({ path: { $nin: seenPaths } });

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
