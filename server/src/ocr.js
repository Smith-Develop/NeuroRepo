// OCR con las herramientas del sistema (tesseract + pdftoppm de poppler, instaladas en el Dockerfile):
// sin paquete npm ni servicio externo. Si no están (p. ej. en desarrollo), el OCR queda desactivado.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const run = promisify(execFile);
const LANG = process.env.OCR_LANG || "spa";
export const OCR_MAX_PAGES = Number(process.env.OCR_MAX_PAGES) || 30;
export const OCR_IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp"]);
// Un solo hilo por proceso de tesseract: el servidor sigue respondiendo mientras se procesa la cola.
const OPTS = { maxBuffer: 20 * 1024 * 1024, env: { ...process.env, OMP_THREAD_LIMIT: "1" } };

async function commandExists(cmd, args) {
  try {
    await run(cmd, args);
    return true;
  } catch (e) {
    return e.code !== "ENOENT"; // existe aunque esa opción devuelva código de error
  }
}

let available;
export async function ocrAvailable() {
  if (process.env.OCR_ENABLED === "false") return false;
  if (available === undefined) {
    available = (await commandExists("tesseract", ["--version"])) && (await commandExists("pdftoppm", ["-v"]));
    if (!available) console.warn("OCR desactivado: no se encontró tesseract o pdftoppm en el sistema.");
  }
  return available;
}

export async function ocrImage(abs) {
  const { stdout } = await run("tesseract", [abs, "stdout", "-l", LANG], { ...OPTS, timeout: 120_000 });
  return stdout;
}

// Rasteriza como mucho OCR_MAX_PAGES páginas a PNG en un directorio temporal y pasa tesseract por cada una
export async function ocrPdf(abs) {
  const dir = await mkdtemp(path.join(tmpdir(), "ocr-"));
  try {
    await run("pdftoppm", ["-r", "200", "-png", "-l", String(OCR_MAX_PAGES), abs, path.join(dir, "p")], { ...OPTS, timeout: 300_000 });
    const pages = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
    const texts = [];
    for (const page of pages) texts.push(await ocrImage(path.join(dir, page)));
    return texts.join("\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
