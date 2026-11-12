import { Router } from "express";
import mongoose from "mongoose";
import { Note, Scenario } from "./models.js";
import { classifyNote, answerQuestion } from "./ai.js";

const r = Router();
const MAX_LEN = 20000;
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v) => (typeof v === "string" ? v.trim() : "");

r.get("/scenarios", wrap(async (_req, res) => {
  const counts = await Note.aggregate([{ $group: { _id: "$scenario", n: { $sum: 1 } } }]);
  const byId = Object.fromEntries(counts.map((c) => [String(c._id), c.n]));
  const scenarios = await Scenario.find().sort({ name: 1 }).lean();
  res.json(scenarios.map((s) => ({ ...s, noteCount: byId[String(s._id)] || 0 })));
}));

r.get("/notes", wrap(async (req, res) => {
  const q = {};
  if (mongoose.isValidObjectId(req.query.scenario)) q.scenario = req.query.scenario;
  if (text(req.query.tag)) q.tags = text(req.query.tag);
  const search = text(req.query.q);
  const query = search ? Note.find({ ...q, $text: { $search: search } }, { score: { $meta: "textScore" } }).sort({ score: { $meta: "textScore" } })
                       : Note.find(q).sort({ createdAt: -1 });
  res.json(await query.limit(200).populate("scenario", "name").lean());
}));

// Crear nota: la IA decide escenario, título, resumen, etiquetas
r.post("/notes", wrap(async (req, res) => {
  const raw = text(req.body?.text);
  if (!raw) return res.status(400).json({ error: "La nota está vacía." });
  if (raw.length > MAX_LEN) return res.status(400).json({ error: `Máximo ${MAX_LEN} caracteres.` });

  const scenarios = await Scenario.find().lean();
  const c = await classifyNote(raw, scenarios);

  // Empareja el escenario por nombre (sin distinguir mayúsculas) o lo crea
  const wanted = text(c.scenario) || "General";
  let scenario = scenarios.find((s) => s.name.toLowerCase() === wanted.toLowerCase());
  if (!scenario) {
    scenario = await Scenario.findOneAndUpdate(
      { name: wanted },
      { $setOnInsert: { name: wanted, description: text(c.scenarioDescription) } },
      { upsert: true, returnDocument: "after" },
    );
  }
  const note = await Note.create({
    raw, title: c.title, summary: c.summary, keyPoints: c.keyPoints,
    tags: [...new Set(c.tags.map((t) => t.toLowerCase().replaceAll("_", " ").trim()).filter(Boolean))],
    scenario: scenario._id,
  });
  res.status(201).json(await note.populate("scenario", "name"));
}));

// Corrección manual: mover de escenario o editar
r.patch("/notes/:id", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  for (const k of ["title", "summary"]) if (text(req.body?.[k])) update[k] = text(req.body[k]);
  if (mongoose.isValidObjectId(req.body?.scenario)) update.scenario = req.body.scenario;
  const note = await Note.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" }).populate("scenario", "name");
  note ? res.json(note) : res.status(404).end();
}));

r.delete("/notes/:id", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  await Note.findByIdAndDelete(req.params.id);
  res.status(204).end();
}));

r.patch("/scenarios/:id", wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  if (text(req.body?.name)) update.name = text(req.body.name);
  if (typeof req.body?.description === "string") update.description = req.body.description.trim();
  const s = await Scenario.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" });
  s ? res.json(s) : res.status(404).end();
}));

// Preguntar en lenguaje natural sobre lo aprendido
r.post("/ask", wrap(async (req, res) => {
  const question = text(req.body?.question);
  if (!question) return res.status(400).json({ error: "Escribe una pregunta." });
  let notes = await Note.find({ $text: { $search: question } }, { score: { $meta: "textScore" } })
    .sort({ score: { $meta: "textScore" } }).limit(6).populate("scenario", "name").lean();
  if (!notes.length) notes = await Note.find().sort({ createdAt: -1 }).limit(6).populate("scenario", "name").lean();
  const answer = await answerQuestion(question, notes);
  res.json({ answer, sources: notes.map(({ _id, title, scenario }) => ({ _id, title, scenario })) });
}));

export default r;
