// Extracción de texto de cada formato para el índice (búsqueda y modo avanzado de la IA). Todo en
// JavaScript, sin programas externos ni servicios: pdf-parse, mammoth (.docx), word-extractor (.doc
// antiguo), SheetJS (hojas de cálculo), jszip (PowerPoint y OpenDocument) y lectura directa del resto.
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import * as XLSX from "xlsx";
import WordExtractor from "word-extractor";
import JSZip from "jszip";
import { OCR_IMAGE_EXTS } from "./ocr.js";

// Sube cuando cambia lo que se sabe extraer: el indexador vuelve a leer los documentos que se
// quedaron sin texto con una versión anterior (p. ej. los .doc antes de word-extractor).
export const EXTRACTOR_VERSION = 2;

// Un PDF con menos de esto por página casi seguro que es un escaneo (imágenes sin capa de texto)
const OCR_MIN_CHARS_PER_PAGE = 50;
// Archivos de texto enormes (logs...): solo se lee el principio
const TEXT_MAX_BYTES = 20 * 1024 * 1024;

export const SHEET_EXTS = new Set([".xlsx", ".xlsm", ".xlsb", ".xls", ".ods", ".csv"]); // SheetJS
export const WORDX_EXTS = new Set([".docx", ".docm", ".dotx"]); // mammoth
const SLIDES_EXTS = new Set([".pptx", ".ppsx", ".potx", ".pptm"]);
const OPENDOC_EXTS = new Set([".odt", ".odp"]);
// Texto plano conocido: documentación, configuración, scripts, código y datos
export const TEXT_EXTS = new Set([
  ".txt", ".md", ".csv", ".tsv", ".log", ".ini", ".cfg", ".conf", ".config", ".json", ".xml", ".yaml", ".yml",
  ".html", ".htm", ".css", ".js", ".ts", ".sql", ".bat", ".cmd", ".ps1", ".psm1", ".psd1", ".sh", ".vbs",
  ".py", ".java", ".c", ".cpp", ".h", ".cs", ".php", ".rb", ".go", ".properties", ".reg", ".nfo", ".srt",
  ".eml", ".url", ".inf",
]);
// Binarios conocidos que no merece la pena mirar si "parecen texto"
const BINARY_EXTS = new Set([
  ...OCR_IMAGE_EXTS, ".gif", ".svg", ".ico", ".mp4", ".webm", ".mov", ".mkv", ".m4v", ".avi", ".wmv", ".mp3", ".wav",
  ".m4a", ".flac", ".ogg", ".zip", ".rar", ".7z", ".gz", ".tar", ".exe", ".dll", ".msi", ".iso", ".ppt", ".msg", ".pst",
  ".mdb", ".accdb", ".db", ".bin", ".dat",
]);

function readPrefix(absPath, maxBytes) {
  const size = statSync(absPath).size;
  if (size <= maxBytes) return readFileSync(absPath);
  const fd = openSync(absPath, "r");
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

// Texto con su codificación real: UTF-8 (con o sin BOM), UTF-16 con BOM (habitual en scripts de
// PowerShell y exportaciones de Windows) o, si no es UTF-8 válido, Windows-1252 (ANSI de Windows).
export function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString("utf16le");
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString("utf16le");
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

// Sin bytes nulos al principio (o con BOM de UTF-16): casi seguro que es texto
function looksLikeText(buf) {
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) return true;
  return !buf.subarray(0, 8000).includes(0);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function xmlToText(xml) {
  return xml
    .replace(/<\/(?:a:p|text:p|text:h)>|<(?:text:line-break|a:br|text:tab)\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
      return ENTITIES[e] ?? m;
    })
    .replace(/\n{3,}/g, "\n\n");
}

async function slidesText(absPath) {
  const zip = await JSZip.loadAsync(readFileSync(absPath));
  const slideNo = (name) => Number(name.match(/(\d+)\.xml$/)?.[1] || 0);
  const slides = zip.file(/^ppt\/slides\/slide\d+\.xml$/).sort((a, b) => slideNo(a.name) - slideNo(b.name));
  const texts = await Promise.all(slides.map(async (f, i) => `Diapositiva ${i + 1}\n${xmlToText(await f.async("string")).trim()}`));
  return texts.join("\n\n");
}

async function openDocText(absPath) {
  const zip = await JSZip.loadAsync(readFileSync(absPath));
  const content = zip.file("content.xml");
  return content ? xmlToText(await content.async("string")) : "";
}

// RTF a texto aproximado: quita grupos de control, palabras de control y llaves.
function rtfToText(rtf) {
  return rtf
    .replace(/\{\\\*[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, "") // grupos {\* ...} (fuentes, estilos, metadatos)
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict)[^]*?\}\s*\}/g, "")
    // \uN va seguido de un carácter "de reserva" para lectores antiguos (\'hh o una letra): se descarta
    .replace(/\\u(-?\d+) ?(?:\\'[0-9a-f]{2}|[^\\{}])?/gi, (_, n) => String.fromCharCode(Number(n) < 0 ? Number(n) + 65536 : Number(n)))
    .replace(/\\'([0-9a-f]{2})/gi, (_, h) => new TextDecoder("windows-1252").decode(Uint8Array.of(parseInt(h, 16))))
    .replace(/\\(?:par|line)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\[a-z]+-?\d* ?/gi, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

// {ok, text, needsOcr?}. ok: false si el archivo no se pudo leer (protegido, corrupto...).
export async function extractText(absPath, ext) {
  try {
    if (ext === ".pdf") {
      const { text, numpages } = await pdfParse(readFileSync(absPath));
      return { ok: true, text, needsOcr: text.replace(/\s+/g, "").length < OCR_MIN_CHARS_PER_PAGE * Math.max(1, numpages) };
    }
    if (WORDX_EXTS.has(ext)) return { ok: true, text: (await mammoth.extractRawText({ path: absPath })).value };
    if (ext === ".doc" || ext === ".dot") {
      const doc = await new WordExtractor().extract(absPath);
      return { ok: true, text: [doc.getHeaders({ includeFooters: false }), doc.getBody(), doc.getFootnotes()].filter((t) => t?.trim()).join("\n\n") };
    }
    if (SHEET_EXTS.has(ext) && ext !== ".csv") {
      const book = XLSX.read(readFileSync(absPath));
      return { ok: true, text: book.SheetNames.map((name) => `${name}\n${XLSX.utils.sheet_to_csv(book.Sheets[name])}`).join("\n\n") };
    }
    if (SLIDES_EXTS.has(ext)) return { ok: true, text: await slidesText(absPath) };
    if (OPENDOC_EXTS.has(ext)) return { ok: true, text: await openDocText(absPath) };
    if (ext === ".rtf") return { ok: true, text: rtfToText(decodeText(readPrefix(absPath, TEXT_MAX_BYTES))) };
    if (TEXT_EXTS.has(ext)) return { ok: true, text: decodeText(readPrefix(absPath, TEXT_MAX_BYTES)) };
    if (OCR_IMAGE_EXTS.has(ext)) return { ok: true, text: "", needsOcr: true };
    // Cualquier otro archivo que no sea un binario conocido: si parece texto, se lee como texto
    if (!BINARY_EXTS.has(ext)) {
      const head = readPrefix(absPath, TEXT_MAX_BYTES);
      if (head.length && looksLikeText(head)) return { ok: true, text: decodeText(head) };
    }
    return { ok: true, text: "" }; // se indexa solo por nombre
  } catch {
    return { ok: false, text: "" };
  }
}
