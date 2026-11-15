import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { Document, FolderConfig, FileVersion, TrashItem } from "./models.js";
import { requireAdmin, allowedFolders } from "./auth.js";
import { searchDocuments, topScore } from "./search.js";
import { suggestKeywords } from "./ai.js";
import {
  safeResolve, browseFolder, getActiveLibraryPath, setActiveLibraryPath, getAppConfig, LibraryPathError, LIBRARY_ROOT,
  createFolder, renameFolder, saveUploadedFile, restoreVersion, restoreFromTrash, toRootRel,
} from "./library.js";
import { recordVersion, trash, purgeTrashItem, renameVersionPaths, TRASH_DAYS } from "./history.js";
import { scanLibrary } from "./indexer.js";
import { logActivity } from "./activityLog.js";
import { ocrAvailable } from "./ocr.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 20 } });

const DEFAULT_BLOCKED_MESSAGE = "No tienes permiso para consultar esta carpeta. Pregunta al administrador.";
const AI_FALLBACK_SCORE = Number(process.env.AI_FALLBACK_SCORE) || 0.3; // por debajo de esto, se intenta el respaldo de IA

const r = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v, max = Infinity) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function canAccess(user, topFolder) {
  return user.role === "admin" || allowedFolders(user).has(topFolder);
}

async function blockedMessageFor(topFolder) {
  const cfg = await FolderConfig.findOne({ folder: topFolder }, "blockedMessage").lean();
  return cfg?.blockedMessage || DEFAULT_BLOCKED_MESSAGE;
}

// Lista ligera (para el árbol de carpetas) o búsqueda con puntuación, siempre filtrada por permisos
r.get("/documents", wrap(async (req, res) => {
  const q = text(req.query.q, 300);
  const isAdmin = req.user.role === "admin";
  const allowed = allowedFolders(req.user);

  if (!q) {
    const all = await Document.find({}, "filename ext folder topFolder size mtimeMs textOk")
      .sort({ folder: 1, filename: 1 }).limit(5000).lean();
    return res.json(isAdmin ? all : all.filter((d) => allowed.has(d.topFolder)));
  }
  let found = await searchDocuments(q);
  if (!isAdmin) found = found.filter((d) => allowed.has(d.topFolder));
  res.json(found.slice(0, 20));
}));

// Chat: busca por coincidencia de texto; solo si no hay nada razonable, pide a la IA mejores palabras clave
r.post("/ask", wrap(async (req, res) => {
  const question = text(req.body?.question, 500);
  if (!question) return res.status(400).json({ error: "Escribe qué documento buscas." });

  let found = await searchDocuments(question);
  if (found.length && req.user.role !== "admin" && !allowedFolders(req.user).has(found[0].topFolder)) {
    await logActivity(req, "search.blocked", `${found[0].topFolder}: ${question}`);
    return res.json({ results: [], blocked: true, folder: found[0].topFolder, message: await blockedMessageFor(found[0].topFolder) });
  }
  await logActivity(req, "search.query", question);

  let usedAI = false;
  if (!found.length || topScore(found) < AI_FALLBACK_SCORE) {
    try {
      const keywords = await suggestKeywords(question);
      if (keywords) {
        const retry = await searchDocuments(keywords);
        if (retry.length) { found = retry; usedAI = true; }
      }
    } catch {
      // sin Ollama disponible, nos quedamos con lo que haya encontrado la búsqueda por texto
    }
  }

  if (req.user.role !== "admin") {
    const allowed = allowedFolders(req.user);
    found = found.filter((d) => allowed.has(d.topFolder));
  }
  res.json({ results: found.slice(0, 10), usedAI });
}));

// El usuario pide acceso a una carpeta bloqueada: solo deja constancia en el registro para que
// el admin la vea y decida (no concede el acceso automáticamente).
r.post("/access-requests", wrap(async (req, res) => {
  const folder = text(req.body?.folder, 200);
  if (!folder) return res.status(400).json({ error: "Falta la carpeta." });
  await logActivity(req, "access.request", folder);
  res.status(201).json({ ok: true });
}));

async function findAccessibleDoc(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).end(); return null; }
  const doc = await Document.findById(req.params.id).lean();
  if (!doc) { res.status(404).end(); return null; }
  if (!canAccess(req.user, doc.topFolder)) { res.status(403).json({ error: "No tienes permiso para este documento." }); return null; }
  return doc;
}

r.get("/documents/:id/view", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  const root = await getActiveLibraryPath();
  const abs = safeResolve(root, doc.path);
  res.sendFile(abs);
}));

// Vista previa de Word/Excel como HTML (el cliente lo pinta en un iframe con sandbox, sin scripts).
// Las hojas se recortan para que un Excel enorme no bloquee el servidor ni el navegador.
const SHEET_EXTS = new Set([".xlsx", ".xls", ".csv"]);
const PREVIEW_MAX_FILE = 30 * 1024 * 1024;
const PREVIEW_MAX_ROWS = 2000;
const PREVIEW_MAX_COLS = 50;
const PREVIEW_MAX_HTML = 8 * 1024 * 1024;

r.get("/documents/:id/preview", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  if (doc.ext !== ".docx" && !SHEET_EXTS.has(doc.ext)) return res.status(415).json({ error: "Este tipo de archivo no tiene vista previa." });
  if (doc.size > PREVIEW_MAX_FILE) return res.status(413).json({ error: "El archivo es demasiado grande para la vista previa. Descárgalo para abrirlo." });
  const abs = safeResolve(await getActiveLibraryPath(), doc.path);

  let sheets;
  let truncated = false;
  try {
    if (doc.ext === ".docx") {
      sheets = [{ name: "", html: (await mammoth.convertToHtml({ path: abs })).value }];
    } else {
      const book = XLSX.read(readFileSync(abs));
      sheets = book.SheetNames.map((name) => {
        const ws = book.Sheets[name];
        if (ws["!ref"]) {
          const range = XLSX.utils.decode_range(ws["!ref"]);
          if (range.e.r - range.s.r >= PREVIEW_MAX_ROWS || range.e.c - range.s.c >= PREVIEW_MAX_COLS) {
            truncated = true;
            range.e.r = Math.min(range.e.r, range.s.r + PREVIEW_MAX_ROWS - 1);
            range.e.c = Math.min(range.e.c, range.s.c + PREVIEW_MAX_COLS - 1);
            ws["!ref"] = XLSX.utils.encode_range(range);
          }
        }
        // sin los atributos data-t/data-v/id por celda, que no hacen falta para verla y triplican el tamaño
        const html = XLSX.utils.sheet_to_html(ws, { header: "", footer: "" }).replace(/ (?:data-[tv]|id)="[^"]*"/g, "");
        return { name, html };
      });
    }
  } catch {
    return res.status(422).json({ error: "No se pudo leer el archivo para la vista previa. Descárgalo para abrirlo." });
  }
  if (sheets.reduce((n, s) => n + s.html.length, 0) > PREVIEW_MAX_HTML) {
    return res.status(413).json({ error: "El documento es demasiado grande para la vista previa. Descárgalo para abrirlo." });
  }
  res.json({ kind: doc.ext === ".docx" ? "docx" : "sheet", sheets, truncated, maxRows: PREVIEW_MAX_ROWS, maxCols: PREVIEW_MAX_COLS });
}));

r.get("/documents/:id/download", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  const root = await getActiveLibraryPath();
  const abs = safeResolve(root, doc.path);
  res.download(abs, doc.filename);
}));

// Carpetas de primer nivel existentes + su mensaje de bloqueo (para el panel de Grupos)
r.get("/folders", requireAdmin, wrap(async (req, res) => {
  const names = (await Document.distinct("topFolder")).filter(Boolean).sort();
  const configs = await FolderConfig.find({ folder: { $in: names } }).lean();
  const byName = new Map(configs.map((c) => [c.folder, c.blockedMessage]));
  res.json(names.map((folder) => ({ folder, blockedMessage: byName.get(folder) || "" })));
}));

r.patch("/folders/:name", requireAdmin, wrap(async (req, res) => {
  const folder = text(req.params.name, 200);
  const blockedMessage = text(req.body?.blockedMessage, 300);
  const cfg = await FolderConfig.findOneAndUpdate({ folder }, { blockedMessage }, { upsert: true, returnDocument: "after" });
  await logActivity(req, "folder.blocked-message", folder);
  res.json(cfg);
}));

// Estado y gestión de la biblioteca de documentos (solo admin)
r.get("/library", requireAdmin, wrap(async (req, res) => {
  const config = await getAppConfig();
  const [totalDocuments, ocrPending, ocrFailed, ocr] = await Promise.all([
    Document.countDocuments(), Document.countDocuments({ ocrStatus: "pending" }), Document.countDocuments({ ocrStatus: "failed" }), ocrAvailable(),
  ]);
  res.json({ libraryPath: config.libraryPath, lastScanAt: config.lastScanAt, lastScanCount: config.lastScanCount, totalDocuments, ocr, ocrPending, ocrFailed });
}));

r.get("/library/browse", requireAdmin, wrap(async (req, res) => {
  try {
    res.json(browseFolder(text(req.query.path, 2000)));
  } catch (e) {
    res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "Ruta inválida." });
  }
}));

r.post("/library/select", requireAdmin, wrap(async (req, res) => {
  const requested = text(req.body?.path, 2000);
  try {
    await setActiveLibraryPath(requested);
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "Ruta inválida." });
  }
  const result = await scanLibrary();
  await logActivity(req, "library.select", `/${requested}`);
  res.json({ ok: true, indexed: result?.count ?? 0 });
}));

r.post("/library/reindex", requireAdmin, wrap(async (req, res) => {
  const result = await scanLibrary();
  res.json({ ok: true, indexed: result?.count ?? 0 });
}));

// Gestión de carpetas y archivos dentro de la biblioteca (solo admin)
r.post("/library/folders", requireAdmin, wrap(async (req, res) => {
  try {
    const rel = createFolder(text(req.body?.path, 2000), text(req.body?.name, 200));
    await scanLibrary();
    await logActivity(req, "folder.create", `/${rel}`);
    res.status(201).json({ path: rel });
  } catch (e) {
    res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo crear la carpeta." });
  }
}));

r.patch("/library/folders", requireAdmin, wrap(async (req, res) => {
  let renamed;
  try {
    renamed = renameFolder(text(req.body?.path, 2000), text(req.body?.newName, 200));
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo renombrar la carpeta." });
  }
  await renameVersionPaths(renamed.from, renamed.to);
  await scanLibrary();
  await logActivity(req, "folder.rename", `/${renamed.from} → /${renamed.to}`);
  res.json({ path: renamed.to });
}));

// Borrar = mover a la papelera (se puede restaurar durante TRASH_RETENTION_DAYS)
r.delete("/library/folders", requireAdmin, wrap(async (req, res) => {
  let item;
  try {
    item = await trash(req, text(req.query.path, 2000));
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo borrar la carpeta." });
  }
  await scanLibrary();
  await logActivity(req, "folder.delete", `/${item.originalPath}`);
  res.status(204).end();
}));

r.post("/library/upload", requireAdmin, upload.array("files", 20), wrap(async (req, res) => {
  const targetPath = text(req.body?.path, 2000);
  if (!req.files?.length) return res.status(400).json({ error: "No se ha subido ningún archivo." });
  let replaced = 0;
  try {
    for (const file of req.files) {
      const { version } = saveUploadedFile(targetPath, file.originalname, file.buffer);
      if (version) { await recordVersion(req, version); replaced++; }
    }
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo guardar el archivo." });
  }
  await logActivity(req, "document.upload", `/${targetPath}: ${req.files.map((f) => f.originalname).join(", ")}${replaced ? ` (${replaced} sustituido(s), versión anterior guardada)` : ""}`);
  const result = await scanLibrary();
  res.json({ ok: true, uploaded: req.files.length, replaced, indexed: result?.count ?? 0 });
}));

// Ruta de un documento indexado relativa a LIBRARY_ROOT (Document.path es relativa a la biblioteca activa)
async function rootPathOf(doc) {
  return toRootRel(safeResolve(await getActiveLibraryPath(), doc.path));
}

// Un archivo suelto a la papelera
r.delete("/documents/:id", requireAdmin, wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  let item;
  try {
    item = await trash(req, await rootPathOf(doc));
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo borrar el archivo." });
  }
  await scanLibrary();
  await logActivity(req, "document.delete", `/${item.originalPath}`);
  res.status(204).end();
}));

// Versiones anteriores de un documento (las que se apartaron al sobrescribirlo desde la app)
r.get("/documents/:id/versions", requireAdmin, wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  res.json(await FileVersion.find({ originalPath: await rootPathOf(doc) }, "size mtimeMs byName createdAt").sort({ createdAt: -1, _id: -1 }).lean());
}));

async function findById(Model, req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).end(); return null; }
  const found = await Model.findById(req.params.id);
  if (!found) res.status(404).end();
  return found;
}

r.get("/versions/:id/download", requireAdmin, wrap(async (req, res) => {
  const version = await findById(FileVersion, req, res);
  if (!version) return;
  const name = version.originalPath.split("/").pop();
  const day = version.createdAt.toISOString().slice(0, 10);
  // dotfiles: "allow" porque .versiones empieza por punto y send lo ignora por defecto
  res.download(safeResolve(LIBRARY_ROOT, version.storedPath), name.replace(/(\.[^.]*)?$/, ` (versión ${day})$1`), { dotfiles: "allow" });
}));

r.post("/versions/:id/restore", requireAdmin, wrap(async (req, res) => {
  const version = await findById(FileVersion, req, res);
  if (!version) return;
  try {
    await recordVersion(req, restoreVersion(version));
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo restaurar la versión." });
  }
  await scanLibrary();
  await logActivity(req, "version.restore", `/${version.originalPath} (${version.createdAt.toLocaleString("es-ES")})`);
  res.status(204).end();
}));

r.get("/trash", requireAdmin, wrap(async (req, res) => {
  res.json({ retentionDays: TRASH_DAYS, items: await TrashItem.find({}, "-storedPath").sort({ createdAt: -1 }).limit(500).lean() });
}));

r.post("/trash/:id/restore", requireAdmin, wrap(async (req, res) => {
  const item = await findById(TrashItem, req, res);
  if (!item) return;
  try {
    restoreFromTrash(item);
  } catch (e) {
    return res.status(409).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo restaurar." });
  }
  await item.deleteOne();
  await scanLibrary();
  await logActivity(req, "trash.restore", `/${item.originalPath}`);
  res.status(204).end();
}));

r.delete("/trash/:id", requireAdmin, wrap(async (req, res) => {
  const item = await findById(TrashItem, req, res);
  if (!item) return;
  await purgeTrashItem(item);
  await logActivity(req, "trash.purge", `/${item.originalPath}`);
  res.status(204).end();
}));

export default r;
