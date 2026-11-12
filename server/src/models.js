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

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
  },
  { timestamps: true },
);

const sessionSchema = new mongoose.Schema({
  _id: { type: String }, // el propio token, usado como id
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Mongo borra solas las caducadas

const suggestionSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["nota", "cambio"], default: "nota" },
    note: { type: mongoose.Schema.Types.ObjectId, ref: "Note" }, // si es un aviso de cambio sobre una nota existente
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["pendiente", "resuelta", "descartada"], default: "pendiente" },
  },
  { timestamps: true },
);

export const Scenario = mongoose.model("Scenario", scenarioSchema);
export const Note = mongoose.model("Note", noteSchema);
export const User = mongoose.model("User", userSchema);
export const Session = mongoose.model("Session", sessionSchema);
export const Suggestion = mongoose.model("Suggestion", suggestionSchema);
