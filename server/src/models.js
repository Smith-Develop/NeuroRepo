import mongoose from "mongoose";

const scenarioSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, default: "" },
    color: { type: Number, default: 0 }, // índice de la paleta del árbol
  },
  { timestamps: true },
);

const relatedNoteSchema = new mongoose.Schema(
  {
    note: { type: mongoose.Schema.Types.ObjectId, ref: "Note", required: true },
    reason: { type: String, default: "" }, // por qué dependen una de otra
  },
  { _id: false },
);

const noteSchema = new mongoose.Schema(
  {
    raw: { type: String, required: true }, // lo que escribiste tal cual
    title: { type: String, required: true },
    summary: { type: String, default: "" },
    keyPoints: [String],
    tags: { type: [String], index: true },
    scenario: { type: mongoose.Schema.Types.ObjectId, ref: "Scenario", required: true, index: true },
    relatedNotes: { type: [relatedNoteSchema], default: [] }, // casuísticas de otras apps de las que depende
  },
  { timestamps: true },
);

// Búsqueda de texto completo para "preguntar" a tu base de conocimiento
noteSchema.index(
  { title: "text", summary: "text", raw: "text", tags: "text", keyPoints: "text" },
  { weights: { title: 5, tags: 4, keyPoints: 3, summary: 2, raw: 1 }, default_language: "spanish" },
);

export const Scenario = mongoose.model("Scenario", scenarioSchema);
export const Note = mongoose.model("Note", noteSchema);
