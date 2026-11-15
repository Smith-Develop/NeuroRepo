import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { Document, FolderConfig, FileVersion, TrashItem, Group } from "./models.js";
import { requireAdmin, canSeeFolder, folderFilter, folderAncestors } from "./auth.js";
import { searchDocuments, topScore } from "./search.js";
import { suggestKeywords, MODEL } from "./ai.js";
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

// Mensaje de la carpeta más concreta que lo tenga configurado (la propia, o la más cercana hacia arriba)
async function blockedMessageFor(folder) {
  const ancestors = folderAncestors(folder);
  const configs = await FolderConfig.find({ folder: { $in: ancestors }, blockedMessage: { $ne: "" } }, "folder blockedMessage").lean();
  configs.sort((a, b) => b.folder.length - a.folder.length);
  return configs[0]?.blockedMessage || DEFAULT_BLOCKED_MESSAGE;
}

const LIST_FIELDS = "filename ext folder topFolder size mtimeMs textOk";
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TYPE_EXTS = { pdf: [".pdf"], doc: [".doc", ".docx"], xls: [".xls", ".xlsx", ".csv"] };
const FILTER_LIMIT = 200;
const CHILDREN_FILES_LIMIT = 2000;

// Búsqueda con puntuación (?q=), o filtro por nombre y/o tipo (?name=&type=, como mucho 200), siempre
// según permisos. Ya no hay "lista completa": el explorador pide cada carpeta con /documents/children.
r.get("/documents", wrap(async (req, res) => {
  const q = text(req.query.q, 300);
  if (q) {
    const found = (await searchDocuments(q)).filter((d) => canSeeFolder(req.user, d.folder));
    return res.json(found.slice(0, 20));
  }
  const name = text(req.query.name, 200);
  const type = text(req.query.type, 10);
  if (!name && !TYPE_EXTS[type] && type !== "other") return res.status(400).json({ error: "Indica q, name o type." });
  const and = [folderFilter(req.user)];
  if (name) and.push({ $or: [{ filename: { $regex: escapeRegex(name), $options: "i" } }, { folder: { $regex: escapeRegex(name), $options: "i" } }] });
  if (TYPE_EXTS[type]) and.push({ ext: { $in: TYPE_EXTS[type] } });
  if (type === "other") and.push({ ext: { $nin: Object.values(TYPE_EXTS).flat() } });
  const items = await Document.find({ $and: and }, LIST_FIELDS).sort({ folder: 1, filename: 1 }).limit(FILTER_LIMIT + 1).lean();
  res.json({ items: items.slice(0, FILTER_LIMIT), truncated: items.length > FILTER_LIMIT });
}));

// Total visible y carpetas de primer nivel (contador de la barra lateral y ámbito del chat)
r.get("/documents/summary", wrap(async (req, res) => {
  const filter = folderFilter(req.user);
  const [total, topFolders] = await Promise.all([Document.countDocuments(filter), Document.distinct("topFolder", filter)]);
  res.json({ total, topFolders: topFolders.filter(Boolean).sort((a, b) => a.localeCompare(b)) });
}));

// Un nivel del árbol: subcarpetas directas (con cuántos documentos cuelgan de cada una) y archivos
r.get("/documents/children", wrap(async (req, res) => {
  const folder = text(req.query.folder, 2000);
  const below = folder ? { folder: { $regex: `^${escapeRegex(folder)}/` } } : { folder: { $ne: "" } };
  const [groups, files] = await Promise.all([
    Document.aggregate([{ $match: { $and: [folderFilter(req.user), below] } }, { $group: { _id: "$folder", n: { $sum: 1 } } }]),
    Document.find({ $and: [folderFilter(req.user), { folder }] }, LIST_FIELDS).sort({ filename: 1 }).limit(CHILDREN_FILES_LIMIT + 1).lean(),
  ]);
  const counts = new Map();
  const skip = folder ? folder.length + 1 : 0;
  for (const { _id, n } of groups) {
    const name = _id.slice(skip).split("/")[0];
    counts.set(name, (counts.get(name) || 0) + n);
  }
  const folders = [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, path: folder ? `${folder}/${name}` : name, count }));
  res.json({ folder, folders, files: files.slice(0, CHILDREN_FILES_LIMIT), truncated: files.length > CHILDREN_FILES_LIMIT });
}));

// Chat: busca por coincidencia de texto; solo si no hay nada razonable, pide a la IA mejores palabras clave
r.post("/ask", wrap(async (req, res) => {
  const question = text(req.body?.question, 500);
  if (!question) return res.status(400).json({ error: "Escribe qué documento buscas." });

  let found = await searchDocuments(question);
  if (found.length && !canSeeFolder(req.user, found[0].folder)) {
    const folder = found[0].folder;
    await logActivity(req, "search.blocked", `${folder}: ${question}`);
    return res.json({ results: [], blocked: true, folder, message: await blockedMessageFor(folder) });
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

  found = found.filter((d) => canSeeFolder(req.user, d.folder));
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
  if (!canSeeFolder(req.user, doc.folder)) { res.status(403).json({ error: "No tienes permiso para este documento." }); return null; }
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

// Todas las carpetas con documentos (y sus carpetas padre), a cualquier profundidad, con su mensaje
// de bloqueo y cuántos documentos cuelgan de cada una (para el árbol del panel de Grupos)
r.get("/folders", requireAdmin, wrap(async (req, res) => {
  const counts = new Map();
  for (const { _id, n } of await Document.aggregate([{ $group: { _id: "$folder", n: { $sum: 1 } } }])) {
    for (const f of folderAncestors(_id || "")) counts.set(f, (counts.get(f) || 0) + n);
  }
  const names = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  const configs = await FolderConfig.find({ folder: { $in: names } }).lean();
  const byName = new Map(configs.map((c) => [c.folder, c.blockedMessage]));
  res.json(names.map((folder) => ({ folder, count: counts.get(folder), blockedMessage: byName.get(folder) || "" })));
}));

r.patch("/folders/:name", requireAdmin, wrap(async (req, res) => {
  const folder = text(req.params.name, 1000);
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
  res.json({ libraryPath: config.libraryPath, lastScanAt: config.lastScanAt, lastScanCount: config.lastScanCount, totalDocuments, ocr, ocrPending, ocrFailed, model: MODEL });
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

// Group.folders y FolderConfig guardan rutas relativas a la biblioteca activa (renameFolder trabaja con
// rutas relativas a LIBRARY_ROOT): al renombrar, los permisos y mensajes siguen a la carpeta.
async function renameFolderPermissions(fromRoot, toRoot) {
  const base = (await getAppConfig()).libraryPath;
  const rel = (p) => (!base ? p : p.startsWith(`${base}/`) ? p.slice(base.length + 1) : null);
  const from = rel(fromRoot);
  const to = rel(toRoot);
  if (!from || !to) return;
  const swap = (f) => (f === from ? to : f.startsWith(`${from}/`) ? to + f.slice(from.length) : f);
  for (const group of await Group.find()) {
    const next = group.folders.map(swap);
    if (next.some((f, i) => f !== group.folders[i])) { group.folders = next; await group.save(); }
  }
  for (const cfg of await FolderConfig.find({ folder: { $regex: `^${escapeRegex(from)}(/|$)` } })) {
    cfg.folder = swap(cfg.folder);
    await cfg.save().catch(() => {}); // ya había un mensaje para la ruta nueva: se queda ese
  }
}

r.patch("/library/folders", requireAdmin, wrap(async (req, res) => {
  let renamed;
  try {
    renamed = renameFolder(text(req.body?.path, 2000), text(req.body?.newName, 200));
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo renombrar la carpeta." });
  }
  await renameVersionPaths(renamed.from, renamed.to);
  await renameFolderPermissions(renamed.from, renamed.to);
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
