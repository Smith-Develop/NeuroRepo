import { Router } from "express";
import mongoose from "mongoose";
import { Note, Scenario } from "./models.js";
import { classifyNote } from "./ai.js";

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
  if (!partial || "scenario" in body) f.scenario = text(body.scenario, 80);
  for (const k of ["raw", "title", "scenario"]) if (k in f && !f[k]) throw new BadRequest(`Falta "${k}".`);
  return f;
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

r.get("/scenarios", wrap(async (_req, res) => {
  res.json(await Scenario.find().sort({ createdAt: 1 }).lean());
}));

r.patch("/scenarios/:id", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  if (text(req.body?.name, 80)) update.name = text(req.body.name, 80);
  if (typeof req.body?.description === "string") update.description = text(req.body.description, 300);
  const s = await Scenario.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" });
  s ? res.json(s) : res.status(404).end();
}));

// Reordena por cuántas palabras distintas de la pregunta aparecen en la nota (raíz de 5 letras, sin tildes)
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const STOP = new Set(["como", "cual", "cuales", "donde", "cuando", "para", "porque", "que", "hago", "hacer", "tengo", "esta", "este", "esto", "sobre", "with"]);
function rerank(query, notes) {
  const stems = [...new Set(norm(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
  const hits = (n) => {
    const hay = norm([n.title, n.summary, n.raw, ...(n.tags ?? []), ...(n.keyPoints ?? [])].join(" "));
    return stems.filter((s) => hay.includes(s)).length;
  };
  return notes.map((n) => ({ n, h: hits(n) })).sort((a, b) => b.h - a.h || b.n.score - a.n.score).map(({ n }) => n);
}

// Todas las notas (para dibujar el árbol) o búsqueda en lo guardado: nunca se inventa nada
r.get("/notes", wrap(async (req, res) => {
  const search = text(req.query.q, 300);
  if (!search) {
    // shortcut: sin paginar; paginar si el árbol pasa de ~2000 hojas
    return res.json(
      await Note.find().sort({ createdAt: 1 }).limit(2000)
        .populate("scenario", "name").populate("relatedNotes.note", "title").lean(),
    );
  }
  const found = await Note.find({ $text: { $search: search } }, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } }).limit(30)
    .populate("scenario", "name").populate("relatedNotes.note", "title").lean();
  res.json(rerank(search, found).slice(0, 10));
}));

// Paso 1: la IA propone un borrador. No se guarda nada.
r.post("/notes/draft", wrap(async (req, res) => {
  const raw = text(req.body?.text);
  if (!raw) return res.status(400).json({ error: "Escribe lo que aprendiste." });
  if (raw.length > 20000) return res.status(400).json({ error: "Máximo 20000 caracteres." });
  const scenarios = await Scenario.find().lean();
  res.json({ raw, ...(await classifyNote(raw, scenarios)) });
}));

// Paso 2: guardar lo que la persona revisó y corrigió
r.post("/notes", wrap(async (req, res) => {
  const f = noteFields(req.body ?? {});
  const scenario = await scenarioByName(f.scenario, req.body?.scenarioDescription);
  const relatedNotes = await relations(req.body?.relatedNotes, null);
  const note = await Note.create({ ...f, scenario: scenario._id, relatedNotes });
  await note.populate("scenario", "name");
  await note.populate("relatedNotes.note", "title");
  res.status(201).json(note);
}));

r.patch("/notes/:id", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const note = await Note.findById(req.params.id);
  if (!note) return res.status(404).end();
  const f = noteFields(req.body ?? {}, { partial: true });
  if ("relatedNotes" in (req.body ?? {})) f.relatedNotes = await relations(req.body.relatedNotes, note._id);
  const previous = note.scenario;
  if (f.scenario) f.scenario = (await scenarioByName(f.scenario))._id;
  note.set(f);
  await note.save();
  if (String(previous) !== String(note.scenario)) await prune(previous);
  await note.populate("scenario", "name");
  await note.populate("relatedNotes.note", "title");
  res.json(note);
}));

r.delete("/notes/:id", wrap(async (req, res) => {
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
