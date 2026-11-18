import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import { Document, FolderConfig, FileVersion, TrashItem, Group, User, GuideEntry, GuideEntryHistory } from "./models.js";
import { requireAdmin, requireGuideEditor, canSeeFolder, folderFilter, folderAncestors } from "./auth.js";
import { searchDocuments, topScore, bestPassages, stemsOf, queryConcepts, highlightTerms, isRelevant } from "./search.js";
import {
  guideEntries, searchGuide, allEntries, invalidateGuide, sanitizeEntry, checkDuplicates, titleKey, snapshot, parseGuideText,
  exportText, migrateLegacyGuide, DEFAULT_CATEGORIES, TYPES, GUIDE_MAX_CHARS,
} from "./guide.js";
import { getLexicon, getSynonymsText, saveSynonyms, invalidateLexicon, SYNONYMS_MAX_CHARS } from "./lexicon.js";
import { suggestKeywords, answerFromDocuments, MODEL } from "./ai.js";
import {
  safeResolve, browseFolder, getActiveLibraryPath, setActiveLibraryPath, getAppConfig, LibraryPathError, LIBRARY_ROOT,
  createFolder, renameFolder, saveUploadedFile, restoreVersion, restoreFromTrash, toRootRel,
} from "./library.js";
import { recordVersion, trash, purgeTrashItem, renameVersionPaths, TRASH_DAYS } from "./history.js";
import { scanLibrary } from "./indexer.js";
import { logActivity } from "./activityLog.js";
import { ocrAvailable } from "./ocr.js";
import { SUMMARIES_ENABLED } from "./summaries.js";
import { SHEET_EXTS, WORDX_EXTS } from "./extract.js";

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

const LIST_FIELDS = "filename ext folder topFolder size mtimeMs textOk hasText";
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

// Chat: busca por coincidencia de texto; solo si no hay nada razonable, pide a la IA mejores palabras clave.
// Modo avanzado (mode: "advanced"): además, la IA responde a la pregunta con fragmentos de los
// documentos encontrados que el usuario puede ver, citándolos ([1] = results[0]...).
const ANSWER_SOURCES = 2; // pocos y leídos a fondo: con 4 el modelo pequeño mezclaba los documentos
const HISTORY_TURNS = 3;
// Modo simple: la IA solo entra como respaldo en preguntas "complejas" (al menos estas palabras con
// contenido) sin respuesta en la guía y sin buenos resultados en la biblioteca
const COMPLEX_MIN_WORDS = Number(process.env.COMPLEX_MIN_WORDS) || 4;
r.post("/ask", wrap(async (req, res) => {
  const question = text(req.body?.question, 500);
  const advanced = req.body?.mode === "advanced";
  const scope = text(req.body?.scope, 500); // carpeta de primer nivel elegida en el chat ("" = todas)
  // Modo avanzado conversacional: las últimas preguntas/respuestas, para entender las de seguimiento
  const history = advanced && Array.isArray(req.body?.history)
    ? req.body.history.slice(-HISTORY_TURNS).map((h) => ({ q: text(h?.q, 500), a: text(h?.a, 1000) })).filter((h) => h.q && h.a)
    : [];
  if (!question) return res.status(400).json({ error: "Escribe qué documento buscas." });

  // 1) Guía rápida, antes que la biblioteca y sin IA (las entradas [solo admin], solo para admins)
  const isAdmin = req.user.role === "admin";
  const [entries, lexicon] = await Promise.all([guideEntries(), getLexicon()]);
  let guide = searchGuide(entries, question, { isAdmin, lexicon });
  if (!guide.length && history.length) guide = searchGuide(entries, `${history.at(-1).q} ${question}`, { isAdmin, lexicon });

  // 2) Biblioteca. Si la mejor coincidencia es de una carpeta sin permiso y la guía no responde, el
  // mensaje de carpeta bloqueada; si la guía sí responde, se sigue (los documentos sin permiso se
  // quitan igualmente más abajo).
  // Solo documentos relacionados de verdad (al menos la mitad de lo que se pregunta)
  const search = async (q) => (await searchDocuments(q, 30, lexicon)).filter(isRelevant);
  let found = await search(question);
  if (!guide.length && found.length && !canSeeFolder(req.user, found[0].folder)) {
    const folder = found[0].folder;
    await logActivity(req, "search.blocked", `${folder}: ${question}`);
    return res.json({ results: [], blocked: true, folder, message: await blockedMessageFor(folder) });
  }
  await logActivity(req, "search.query", question);

  // Pregunta de seguimiento ("¿y desde el móvil?"): si sola no encuentra nada razonable, se busca
  // junto con la pregunta anterior
  let searchQuery = question;
  if (history.length && (!found.length || topScore(found) < AI_FALLBACK_SCORE)) {
    const withContext = await search(`${history.at(-1).q} ${question}`);
    if (withContext.length && topScore(withContext) > topScore(found)) {
      found = withContext;
      searchQuery = `${history.at(-1).q} ${question}`;
    }
  }

  let usedAI = false;
  const weak = !found.length || topScore(found) < AI_FALLBACK_SCORE;
  const complex = stemsOf(question).length >= COMPLEX_MIN_WORDS;
  if (weak && !guide.length && (advanced || complex)) {
    try {
      const keywords = await suggestKeywords(question);
      if (keywords) {
        const retry = await search(keywords);
        if (retry.length) { found = retry; usedAI = true; }
      }
    } catch {
      // sin Ollama disponible, nos quedamos con lo que haya encontrado la búsqueda por texto
    }
  }

  found = found.filter((d) => canSeeFolder(req.user, d.folder) && (!scope || d.topFolder === scope));
  // Si la guía ya responde, los documentos son solo «relacionados» (el chat los enseña plegados)
  const results = found.slice(0, guide.length ? 5 : 10);
  // Términos que el cliente resalta en el párrafo de cada documento y en la guía
  const highlight = highlightTerms(queryConcepts(searchQuery, lexicon));
  if (!advanced || (!results.length && !guide.length)) return res.json({ results, usedAI, guide, highlight });

  // Con respuesta en la guía basta un documento de apoyo: menos texto, menos mezclas del modelo
  const sourcesDocs = results.slice(0, guide.length ? 1 : ANSWER_SOURCES);
  const texts = await Document.find({ _id: { $in: sourcesDocs.map((d) => d._id) } }, "extractedText").lean();
  const textById = new Map(texts.map((t) => [String(t._id), t.extractedText]));
  // El primero (el que más coincide) se lee mucho más a fondo que el segundo
  const docChars = guide.length ? 1200 : 3500;
  const sources = sourcesDocs.map((d, i) => ({
    filename: d.filename,
    folder: d.folder,
    text: `${d.summary ? `(Resumen: ${d.summary})\n` : ""}${bestPassages(searchQuery, textById.get(String(d._id)), i === 0 ? docChars : 1200)}`,
  }));
  try {
    let answer = await answerFromDocuments(question, sources, history, guide);
    // El modelo pequeño a veces numera la guía como si fuera un documento: una cita [n] sin documento
    // n detrás se convierte en [Guía]
    if (guide.length) answer = answer.replace(/\[(\d+)\]/g, (m, n) => (Number(n) > sources.length ? "[Guía]" : m));
    res.json({ results, usedAI, guide, highlight, answer, sourceCount: sources.length });
  } catch (e) {
    // Sin IA disponible: se devuelven igualmente la guía y los documentos, con el motivo
    res.json({ results, usedAI, guide, highlight, aiError: e.message || "La IA no está disponible." });
  }
}));

// Guía rápida: fichas que editan los admins y los usuarios con permiso (canEditGuide). Los que no
// son admin no ven ni tocan las fichas «solo admin» (ni las de tipo acceso, que siempre lo son).
const isAdminReq = (req) => req.user.role === "admin";
const guideChanged = () => { invalidateGuide(); invalidateLexicon(); };
const entryOut = (e) => ({ ...e, version: e.version || 1 });

async function loadEntry(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { res.status(404).end(); return null; }
  const e = await GuideEntry.findById(req.params.id).lean();
  if (!e || (e.adminOnly && !isAdminReq(req))) { res.status(404).json({ error: "Esa ficha ya no existe." }); return null; }
  return e;
}
// Ficha del formulario validada, o responde con el error (y devuelve null)
function entryFromBody(req, res) {
  const entry = sanitizeEntry(req.body?.entry);
  if (entry.error) { res.status(400).json({ error: entry.error }); return null; }
  if (entry.adminOnly && !isAdminReq(req)) { res.status(403).json({ error: "Solo un administrador puede crear o editar fichas «solo admin» y de accesos." }); return null; }
  return entry;
}
// Misma categoría y mismo título que otra ficha: no se guarda
async function duplicateOf(entry, exceptId) {
  const key = titleKey(entry);
  return (await GuideEntry.find(exceptId ? { _id: { $ne: exceptId } } : {}, "title category adminOnly").lean()).find((o) => titleKey(o) === key);
}
const duplicateError = (res, dup, req) =>
  res.status(409).json({
    error: dup.adminOnly && !isAdminReq(req)
      ? "Ya existe una ficha con ese título en esa categoría (es «solo admin»)."
      : `Ya existe la ficha «${dup.category ? `${dup.category} · ` : ""}${dup.title}». Edítala en lugar de crear otra.`,
    duplicateId: dup.adminOnly && !isAdminReq(req) ? undefined : dup._id,
  });

r.get("/guide/entries", requireGuideEditor, wrap(async (req, res) => {
  const entries = await allEntries({ isAdmin: isAdminReq(req) });
  const categories = [...new Set([...entries.map((e) => e.category).filter(Boolean), ...DEFAULT_CATEGORIES])];
  res.json({ entries: entries.map(entryOut), categories, types: TYPES });
}));

// Avisos de duplicados mientras se rellena el formulario (no guarda nada)
r.post("/guide/check", requireGuideEditor, wrap(async (req, res) => {
  const entry = sanitizeEntry({ ...req.body?.entry, title: req.body?.entry?.title || "-" });
  const id = mongoose.isValidObjectId(req.body?.id) ? String(req.body.id) : null;
  const others = (await allEntries({ isAdmin: isAdminReq(req) })).filter((o) => String(o._id) !== id);
  res.json(checkDuplicates(entry, others));
}));

r.post("/guide/entries", requireGuideEditor, wrap(async (req, res) => {
  const entry = entryFromBody(req, res);
  if (!entry) return;
  const dup = await duplicateOf(entry);
  if (dup) return duplicateError(res, dup, req);
  const created = await GuideEntry.create({ ...entry, version: 1, createdBy: req.user.name, updatedBy: req.user.name });
  guideChanged();
  await logActivity(req, "guide.create", `${entry.category ? `${entry.category} · ` : ""}${entry.title}`);
  res.status(201).json(entryOut(created.toObject()));
}));

r.put("/guide/entries/:id", requireGuideEditor, wrap(async (req, res) => {
  const current = await loadEntry(req, res);
  if (!current) return;
  const entry = entryFromBody(req, res);
  if (!entry) return;
  if ((current.version || 1) !== Number(req.body?.version)) {
    return res.status(409).json({ error: `${current.updatedBy || "Otra persona"} cambió esta ficha mientras la editabas. Ciérrala y vuelve a abrirla para ver su versión.`, conflict: true });
  }
  const dup = await duplicateOf(entry, current._id);
  if (dup) return duplicateError(res, dup, req);
  const saved = await GuideEntry.findOneAndUpdate(
    { _id: current._id, version: current.version || 1 },
    { ...entry, version: (current.version || 1) + 1, updatedBy: req.user.name },
    { new: true },
  ).lean();
  if (!saved) return res.status(409).json({ error: "La ficha cambió mientras la guardabas. Vuelve a abrirla.", conflict: true });
  await snapshot(current, "edit");
  guideChanged();
  await logActivity(req, "guide.update", `${entry.category ? `${entry.category} · ` : ""}${entry.title}`);
  res.json(entryOut(saved));
}));

r.delete("/guide/entries/:id", requireGuideEditor, wrap(async (req, res) => {
  const current = await loadEntry(req, res);
  if (!current) return;
  await snapshot(current, "delete", req.user.name);
  await GuideEntry.deleteOne({ _id: current._id });
  guideChanged();
  await logActivity(req, "guide.delete", `${current.category ? `${current.category} · ` : ""}${current.title}`);
  res.status(204).end();
}));

// Versiones anteriores de una ficha (la más reciente primero)
r.get("/guide/entries/:id/history", requireGuideEditor, wrap(async (req, res) => {
  const current = await loadEntry(req, res);
  if (!current) return;
  res.json(await GuideEntryHistory.find({ entryId: current._id }).sort({ savedAt: -1 }).lean());
}));

// Fichas borradas (para recuperarlas): el último borrado de cada una que no se haya vuelto a crear
r.get("/guide/deleted", requireGuideEditor, wrap(async (req, res) => {
  const deleted = await GuideEntryHistory.find({ action: "delete" }).sort({ savedAt: -1 }).limit(200).lean();
  const alive = new Set((await GuideEntry.find({ _id: { $in: deleted.map((d) => d.entryId) } }, "_id").lean()).map((e) => String(e._id)));
  const seen = new Set();
  res.json(deleted.filter((d) => {
    const id = String(d.entryId);
    if (alive.has(id) || seen.has(id) || (d.snapshot?.adminOnly && !isAdminReq(req))) return false;
    seen.add(id);
    return true;
  }));
}));

r.post("/guide/deleted/:hid/restore", requireGuideEditor, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.hid)) return res.status(404).end();
  const h = await GuideEntryHistory.findOne({ _id: req.params.hid, action: "delete" }).lean();
  if (!h || (h.snapshot?.adminOnly && !isAdminReq(req))) return res.status(404).end();
  if (await GuideEntry.exists({ _id: h.entryId })) return res.status(409).json({ error: "Esa ficha ya se recuperó." });
  const entry = sanitizeEntry(h.snapshot);
  if (entry.error) return res.status(400).json({ error: entry.error });
  const dup = await duplicateOf(entry);
  if (dup) return duplicateError(res, dup, req);
  const restored = await GuideEntry.create({
    _id: h.entryId, ...entry, version: (h.snapshot.version || 1) + 1,
    createdBy: h.snapshot.createdBy || "", createdAt: h.snapshot.createdAt, updatedBy: req.user.name,
  });
  guideChanged();
  await logActivity(req, "guide.restore", entry.title);
  res.status(201).json(entryOut(restored.toObject()));
}));

// Importar un .txt con el formato de siempre: crea las fichas que no existan (misma categoría y
// título = ya existe, se salta). Las «solo admin» solo las importa un admin.
r.post("/guide/import", requireGuideEditor, wrap(async (req, res) => {
  const raw = typeof req.body?.text === "string" ? req.body.text : "";
  if (!raw.trim()) return res.status(400).json({ error: "El archivo está vacío." });
  if (raw.length > GUIDE_MAX_CHARS) return res.status(413).json({ error: `El archivo no puede pasar de ${GUIDE_MAX_CHARS.toLocaleString("es-ES")} caracteres.` });
  await migrateLegacyGuide();
  // replace (solo admin): la guía entera pasa a ser la del archivo. Las fichas actuales se guardan
  // antes como borradas, así que se pueden recuperar desde «Borradas».
  const replace = req.body?.replace === true;
  if (replace) {
    if (!isAdminReq(req)) return res.status(403).json({ error: "Solo un administrador puede sustituir toda la guía." });
    if (!parseGuideText(raw).length) return res.status(400).json({ error: "El archivo no tiene ninguna ficha: no se sustituye nada." });
    const current = await GuideEntry.find({}).lean();
    if (current.length) {
      const now = new Date();
      await GuideEntryHistory.insertMany(current.map(({ _id, __v, ...snap }) => ({ entryId: _id, snapshot: snap, action: "delete", savedAt: now, savedBy: req.user.name })));
      await GuideEntry.deleteMany({ _id: { $in: current.map((e) => e._id) } });
    }
  }
  const keys = new Set((await GuideEntry.find({}, "title category").lean()).map(titleKey));
  const t0 = Date.now();
  const toCreate = [];
  let skipped = 0;
  let forbidden = 0;
  for (const parsed of parseGuideText(raw)) {
    const entry = sanitizeEntry(parsed);
    if (entry.error) { skipped++; continue; }
    if (entry.adminOnly && !isAdminReq(req)) { forbidden++; continue; }
    if (keys.has(titleKey(entry))) { skipped++; continue; }
    keys.add(titleKey(entry));
    const at = new Date(t0 + toCreate.length);
    toCreate.push({ ...entry, version: 1, createdBy: req.user.name, updatedBy: req.user.name, createdAt: at, updatedAt: at });
  }
  if (toCreate.length) await GuideEntry.insertMany(toCreate, { timestamps: false });
  guideChanged();
  await logActivity(req, "guide.import", `${replace ? "guía sustituida: " : ""}${toCreate.length} fichas nuevas, ${skipped} repetidas`);
  res.json({ created: toCreate.length, skipped, forbidden });
}));

// Exportar a .txt (el mismo formato que se importa); los que no son admin, sin las «solo admin»
r.get("/guide/export", requireGuideEditor, wrap(async (req, res) => {
  res.type("text/plain; charset=utf-8").send(exportText(await allEntries({ isAdmin: isAdminReq(req) })));
}));

// Sinónimos de la búsqueda (guía y documentos): una línea por grupo de términos equivalentes
r.get("/guide/synonyms", requireGuideEditor, wrap(async (req, res) => {
  const s = await getSynonymsText();
  res.json({ text: s.synonyms || "", updatedBy: s.updatedBy || "", updatedAt: s.updatedAt || null });
}));

r.put("/guide/synonyms", requireGuideEditor, wrap(async (req, res) => {
  const value = typeof req.body?.text === "string" ? req.body.text.replace(/\r\n?/g, "\n") : null;
  if (value === null) return res.status(400).json({ error: "Faltan los sinónimos." });
  if (value.length > SYNONYMS_MAX_CHARS) return res.status(413).json({ error: "Demasiados sinónimos." });
  const saved = await saveSynonyms(value, req.user);
  await logActivity(req, "guide.synonyms", `${value.split("\n").filter((l) => l.includes(",")).length} grupos`);
  res.json({ text: saved.synonyms, updatedBy: saved.updatedBy, updatedAt: saved.updatedAt });
}));

// Favoritos del usuario: documentos marcados desde el chat para no tener que volver a buscarlos.
const FAVORITES_MAX = 300;
r.get("/favorites", wrap(async (req, res) => {
  const user = await User.findById(req.user._id, "favorites").lean();
  const docs = await Document.find({ _id: { $in: user?.favorites || [] } }, LIST_FIELDS).lean();
  const order = new Map((user?.favorites || []).map((id, i) => [String(id), i]));
  res.json(docs.filter((d) => canSeeFolder(req.user, d.folder)).sort((a, b) => order.get(String(b._id)) - order.get(String(a._id))));
}));

r.put("/favorites/:id", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  const user = await User.findById(req.user._id, "favorites");
  if (!user.favorites.some((id) => String(id) === String(doc._id))) {
    if (user.favorites.length >= FAVORITES_MAX) return res.status(400).json({ error: `Como mucho ${FAVORITES_MAX} favoritos.` });
    user.favorites.push(doc._id);
    await user.save();
  }
  res.status(204).end();
}));

r.delete("/favorites/:id", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  await User.updateOne({ _id: req.user._id }, { $pull: { favorites: new mongoose.Types.ObjectId(req.params.id) } });
  res.status(204).end();
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

// El documento actual de una tarjeta del chat: por id o, si ese id ya no existe (conversación del
// historial guardada antes de reindexar o de cambiar la biblioteca), por carpeta y nombre
r.get("/documents/locate", wrap(async (req, res) => {
  const fields = "filename ext folder topFolder size mtimeMs textOk hasText";
  let doc = mongoose.isValidObjectId(req.query.id) ? await Document.findById(req.query.id, fields).lean() : null;
  if (!doc && typeof req.query.filename === "string") {
    doc = await Document.findOne({ filename: req.query.filename, folder: typeof req.query.folder === "string" ? req.query.folder : "" }, fields).lean();
  }
  if (!doc) return res.status(404).json({ error: "Este documento ya no está en la biblioteca (se movió, se renombró o se borró)." });
  if (!canSeeFolder(req.user, doc.folder)) return res.status(403).json({ error: "No tienes permiso para este documento." });
  res.json(doc);
}));

r.get("/documents/:id/view", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  const root = await getActiveLibraryPath();
  const abs = safeResolve(root, doc.path);
  res.sendFile(abs);
}));

// Vista previa de Word/Excel como HTML (el cliente lo pinta en un iframe con sandbox, sin scripts).
// Las hojas se recortan para que un Excel enorme no bloquee el servidor ni el navegador.
const PREVIEW_MAX_FILE = 30 * 1024 * 1024;
const PREVIEW_MAX_ROWS = 2000;
const PREVIEW_MAX_COLS = 50;
const PREVIEW_MAX_HTML = 8 * 1024 * 1024;

// Texto extraído (ya decodificado) para la vista previa de lo que no tiene visor propio: .doc, .rtf,
// .pptx, .odt, scripts .bat/.ps1, logs, configuración...
r.get("/documents/:id/text", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  res.json({ text: doc.extractedText || "" });
}));

r.get("/documents/:id/preview", wrap(async (req, res) => {
  const doc = await findAccessibleDoc(req, res);
  if (!doc) return;
  if (!WORDX_EXTS.has(doc.ext) && !SHEET_EXTS.has(doc.ext)) return res.status(415).json({ error: "Este tipo de archivo no tiene vista previa." });
  if (doc.size > PREVIEW_MAX_FILE) return res.status(413).json({ error: "El archivo es demasiado grande para la vista previa. Descárgalo para abrirlo." });
  const abs = safeResolve(await getActiveLibraryPath(), doc.path);

  let sheets;
  let truncated = false;
  try {
    if (WORDX_EXTS.has(doc.ext)) {
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
  const [totalDocuments, ocrPending, ocrFailed, ocr, summariesDone, summariesPending] = await Promise.all([
    Document.countDocuments(), Document.countDocuments({ ocrStatus: "pending" }), Document.countDocuments({ ocrStatus: "failed" }), ocrAvailable(),
    Document.countDocuments({ summaryStatus: "done" }), Document.countDocuments({ summaryStatus: "pending" }),
  ]);
  res.json({
    libraryPath: config.libraryPath, lastScanAt: config.lastScanAt, lastScanCount: config.lastScanCount, totalDocuments, ocr, ocrPending, ocrFailed, model: MODEL,
    summaries: SUMMARIES_ENABLED, summariesDone, summariesPending,
  });
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
