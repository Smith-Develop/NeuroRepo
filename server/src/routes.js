import { Router } from "express";
import mongoose from "mongoose";
import { Note, Scenario } from "./models.js";
import { classifyNote, answerQuestion } from "./ai.js";
import { requireAdmin, allowedScenarioIds } from "./auth.js";

const DEFAULT_BLOCKED_MESSAGE = "No tienes permiso para consultar esta aplicación. Pregunta al administrador.";

const r = Router();
const PALETTE_SIZE = 8; // debe coincidir con PALETTE en client/src/Tree.jsx
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v, max = Infinity) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const list = (v, maxItems, maxLen, fn = (x) => x) =>
  Array.isArray(v) ? [...new Set(v.map((x) => fn(text(x, maxLen))).filter(Boolean))].slice(0, maxItems) : [];

class BadRequest extends Error {}

// Valida los enlaces a otras casuísticas (deben existir y no auto-referenciarse)
async function relations(raw, selfId) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const items = [];
  for (const r of raw) {
    const noteId = text(r?.note, 40);
    if (!mongoose.isValidObjectId(noteId) || noteId === String(selfId) || seen.has(noteId)) continue;
    seen.add(noteId);
    items.push({ note: noteId, reason: text(r?.reason, 200) });
    if (items.length >= 30) break;
  }
  if (!items.length) return [];
  const existing = new Set((await Note.find({ _id: { $in: items.map((i) => i.note) } }, "_id").lean()).map((n) => String(n._id)));
  return items.filter((i) => existing.has(i.note));
}

// Valida lo que llega del formulario de revisión (la persona ya ha corregido lo que propuso la IA)
function noteFields(body, { partial = false } = {}) {
  const f = {};
  if (!partial || "raw" in body) f.raw = text(body.raw, 20000);
  if (!partial || "title" in body) f.title = text(body.title, 200);
  if (!partial || "summary" in body) f.summary = text(body.summary, 2000);
  if (!partial || "keyPoints" in body) f.keyPoints = list(body.keyPoints, 30, 500);
  if (!partial || "tags" in body) f.tags = list(body.tags, 15, 40, (t) => t.toLowerCase());
  if (!partial || "category" in body) f.category = text(body.category, 80);
  if (!partial || "scenario" in body) f.scenario = text(body.scenario, 80);
  for (const k of ["raw", "title", "scenario"]) if (k in f && !f[k]) throw new BadRequest(`Falta "${k}".`);
  return f;
}

// Valida el procedimiento (diagrama de flujo): remapea índices al quitar pasos sin texto
function validateSteps(raw) {
  if (!Array.isArray(raw)) return [];
  const VALID_TYPES = new Set(["inicio", "paso", "decision", "fin"]);
  const kept = [];
  const oldToNew = new Map();
  raw.slice(0, 40).forEach((s, i) => {
    const t = text(s?.text, 300);
    if (!t) return;
    oldToNew.set(i, kept.length);
    kept.push({ type: VALID_TYPES.has(s?.type) ? s.type : "paso", text: t, yesTargetRaw: s?.yesTarget, noTargetRaw: s?.noTarget });
  });
  return kept.map(({ yesTargetRaw, noTargetRaw, ...s }) => {
    if (s.type === "decision") {
      if (Number.isInteger(yesTargetRaw) && oldToNew.has(yesTargetRaw)) s.yesTarget = oldToNew.get(yesTargetRaw);
      if (Number.isInteger(noTargetRaw) && oldToNew.has(noTargetRaw)) s.noTarget = oldToNew.get(noTargetRaw);
    }
    return s;
  });
}

// Busca la rama por nombre (sin distinguir mayúsculas) o la crea
async function scenarioByName(name, description = "") {
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  const found = await Scenario.findOne({ name: re });
  if (found) return found;
  // Cada rama nueva toma un color de la paleta que no esté en uso
  const used = new Set(await Scenario.distinct("color"));
  const color = [...Array(PALETTE_SIZE).keys()].find((i) => !used.has(i)) ?? (await Scenario.countDocuments()) % PALETTE_SIZE;
  return Scenario.create({ name, description: text(description, 300), color });
}

// Las ramas sin hojas se podan
async function prune(scenarioId) {
  if (scenarioId && !(await Note.exists({ scenario: scenarioId }))) await Scenario.deleteOne({ _id: scenarioId });
}

r.get("/scenarios", wrap(async (req, res) => {
  const all = await Scenario.find().sort({ createdAt: 1 }).lean();
  if (req.user.role === "admin") return res.json(all);
  const allowed = allowedScenarioIds(req.user);
  res.json(all.filter((s) => allowed.has(String(s._id))));
}));

r.patch("/scenarios/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  if (text(req.body?.name, 80)) update.name = text(req.body.name, 80);
  if (typeof req.body?.description === "string") update.description = text(req.body.description, 300);
  if (typeof req.body?.blockedMessage === "string") update.blockedMessage = text(req.body.blockedMessage, 300);
  const s = await Scenario.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" });
  s ? res.json(s) : res.status(404).end();
}));

// Reordena por cuántas palabras distintas de la pregunta aparecen en la nota (raíz de 5 letras, sin tildes)
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const STOP = new Set(["como", "cual", "cuales", "donde", "cuando", "para", "porque", "que", "hago", "hacer", "tengo", "esta", "este", "esto", "sobre", "with"]);
function rerank(query, notes) {
  const stems = [...new Set(norm(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
  const hits = (n) => {
    const hay = norm([n.title, n.summary, n.raw, n.category, ...(n.tags ?? []), ...(n.keyPoints ?? [])].join(" "));
    return stems.filter((s) => hay.includes(s)).length;
  };
  return notes.map((n) => ({ n, h: hits(n) })).sort((a, b) => b.h - a.h || b.n.score - a.n.score).map(({ n }) => n);
}

// Busca por texto completo entre las notas guardadas y las reordena por relevancia real
async function searchNotes(query, limit = 30) {
  const found = await Note.find({ $text: { $search: query } }, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } }).limit(limit)
    .populate("scenario", "name").populate("relatedNotes.note", "title").lean();
  return rerank(query, found);
}

// Todas las notas (para dibujar la red) o búsqueda en lo guardado: nunca se inventa nada
r.get("/notes", wrap(async (req, res) => {
  const search = text(req.query.q, 300);
  const isAdmin = req.user.role === "admin";
  if (!search) {
    // shortcut: sin paginar; paginar si la red pasa de ~2000 hojas
    const all = await Note.find().sort({ createdAt: 1 }).limit(2000)
      .populate("scenario", "name").populate("relatedNotes.note", "title").lean();
    if (isAdmin) return res.json(all);
    const allowed = allowedScenarioIds(req.user);
    return res.json(all.filter((n) => allowed.has(String(n.scenario?._id))));
  }
  let found = await searchNotes(search);
  if (!isAdmin) {
    const allowed = allowedScenarioIds(req.user);
    found = found.filter((n) => allowed.has(String(n.scenario?._id)));
  }
  res.json(found.slice(0, 10));
}));

// Pregunta en lenguaje natural: busca por texto y la IA redacta una respuesta con solo esas notas.
// Si la mejor coincidencia es de una app sin permiso, no se llama a la IA: se devuelve el mensaje de esa app.
r.post("/ask", wrap(async (req, res) => {
  const question = text(req.body?.question, 500);
  if (!question) return res.status(400).json({ error: "Escribe tu pregunta." });
  let found = await searchNotes(question);
  if (!found.length) return res.json({ answer: null, notes: [] });
  if (req.user.role !== "admin") {
    const allowed = allowedScenarioIds(req.user);
    if (!allowed.has(String(found[0].scenario?._id))) {
      const blocked = await Scenario.findById(found[0].scenario._id, "blockedMessage").lean();
      return res.json({ answer: blocked?.blockedMessage || DEFAULT_BLOCKED_MESSAGE, notes: [], blocked: true });
    }
    found = found.filter((n) => allowed.has(String(n.scenario?._id)));
  }
  const notes = found.slice(0, 6);
  const answer = await answerQuestion(question, notes);
  res.json({ answer, notes });
}));

// Paso 1: la IA propone un borrador. No se guarda nada.
r.post("/notes/draft", requireAdmin, wrap(async (req, res) => {
  const raw = text(req.body?.text);
  if (!raw) return res.status(400).json({ error: "Escribe lo que aprendiste." });
  if (raw.length > 20000) return res.status(400).json({ error: "Máximo 20000 caracteres." });
  const scenarios = await Scenario.find().lean();
  res.json({ raw, ...(await classifyNote(raw, scenarios)) });
}));

// Paso 2: guardar lo que la persona revisó y corrigió
r.post("/notes", requireAdmin, wrap(async (req, res) => {
  const f = noteFields(req.body ?? {});
  const scenario = await scenarioByName(f.scenario, req.body?.scenarioDescription);
  const relatedNotes = await relations(req.body?.relatedNotes, null);
  const steps = validateSteps(req.body?.steps);
  const note = await Note.create({ ...f, scenario: scenario._id, relatedNotes, steps });
  await note.populate("scenario", "name");
  await note.populate("relatedNotes.note", "title");
  res.status(201).json(note);
}));

r.patch("/notes/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const note = await Note.findById(req.params.id);
  if (!note) return res.status(404).end();
  const f = noteFields(req.body ?? {}, { partial: true });
  if ("relatedNotes" in (req.body ?? {})) f.relatedNotes = await relations(req.body.relatedNotes, note._id);
  if ("steps" in (req.body ?? {})) f.steps = validateSteps(req.body.steps);
  const previous = note.scenario;
  if (f.scenario) f.scenario = (await scenarioByName(f.scenario))._id;
  note.set(f);
  await note.save();
  if (String(previous) !== String(note.scenario)) await prune(previous);
  await note.populate("scenario", "name");
  await note.populate("relatedNotes.note", "title");
  res.json(note);
}));

r.delete("/notes/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const note = await Note.findByIdAndDelete(req.params.id);
  if (note) {
    await prune(note.scenario);
    await Note.updateMany({ "relatedNotes.note": note._id }, { $pull: { relatedNotes: { note: note._id } } });
  }
  res.status(204).end();
}));

r.use((err, _req, res, next) => (err instanceof BadRequest ? res.status(400).json({ error: err.message }) : next(err)));

export default r;
