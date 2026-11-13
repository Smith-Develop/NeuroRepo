import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import { Document, FolderConfig } from "./models.js";
import { requireAdmin, allowedFolders } from "./auth.js";
import { searchDocuments, topScore } from "./search.js";
import { suggestKeywords } from "./ai.js";
import {
  safeResolve, browseFolder, getActiveLibraryPath, setActiveLibraryPath, getAppConfig, LibraryPathError,
  createFolder, renameFolder, deleteFolder, saveUploadedFile,
} from "./library.js";
import { scanLibrary } from "./indexer.js";
import { logActivity } from "./activityLog.js";

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
    return res.json({ results: [], blocked: true, message: await blockedMessageFor(found[0].topFolder) });
  }

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
  const totalDocuments = await Document.countDocuments();
  res.json({ libraryPath: config.libraryPath, lastScanAt: config.lastScanAt, lastScanCount: config.lastScanCount, totalDocuments });
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
  try {
    const from = text(req.body?.path, 2000);
    const rel = renameFolder(from, text(req.body?.newName, 200));
    await scanLibrary();
    await logActivity(req, "folder.rename", `/${from} → /${rel}`);
    res.json({ path: rel });
  } catch (e) {
    res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo renombrar la carpeta." });
  }
}));

r.delete("/library/folders", requireAdmin, wrap(async (req, res) => {
  try {
    const target = text(req.query.path, 2000);
    deleteFolder(target);
    await scanLibrary();
    await logActivity(req, "folder.delete", `/${target}`);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo borrar la carpeta." });
  }
}));

r.post("/library/upload", requireAdmin, upload.array("files", 20), wrap(async (req, res) => {
  const targetPath = text(req.body?.path, 2000);
  if (!req.files?.length) return res.status(400).json({ error: "No se ha subido ningún archivo." });
  try {
    for (const file of req.files) saveUploadedFile(targetPath, file.originalname, file.buffer);
    await logActivity(req, "document.upload", `/${targetPath}: ${req.files.map((f) => f.originalname).join(", ")}`);
  } catch (e) {
    return res.status(400).json({ error: e instanceof LibraryPathError ? e.message : "No se pudo guardar el archivo." });
  }
  const result = await scanLibrary();
  res.json({ ok: true, uploaded: req.files.length, indexed: result?.count ?? 0 });
}));

export default r;
