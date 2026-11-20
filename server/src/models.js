import mongoose from "mongoose";

const documentSchema = new mongoose.Schema(
  {
    path: { type: String, required: true, unique: true, trim: true }, // relativo a la biblioteca activa
    filename: { type: String, required: true },
    ext: { type: String, default: "" },
    folder: { type: String, default: "", index: true }, // carpeta completa (relativa), "" = raíz
    topFolder: { type: String, default: "", index: true }, // primer nivel: agrupa permisos por "carpeta"
    size: { type: Number, default: 0 },
    mtimeMs: { type: Number, default: 0 },
    extractedText: { type: String, default: "" },
    textOk: { type: Boolean, default: true }, // false si no se pudo extraer texto (protegido, corrupto, formato no soportado)
    // OCR de imágenes y PDF escaneados: lo marca el indexador y lo procesa una cola aparte (ocr.js)
    ocrStatus: { type: String, enum: ["none", "pending", "done", "failed"], default: "none", index: true },
    hasText: { type: Boolean, default: false }, // hay texto extraído (o de OCR): se puede leer en la vista previa y por la IA
    extractorVersion: { type: Number, default: 0 }, // versión de extract.js con la que se leyó (ver EXTRACTOR_VERSION)
    // Resumen de la IA (summaries.js): de qué trata el documento y sus palabras clave. Es un añadido:
    // la búsqueda sigue usando el texto completo. "none" = sin texto que resumir.
    summary: { type: String, default: "" },
    summaryKeywords: { type: [String], default: [] },
    summaryStatus: { type: String, enum: ["none", "pending", "done", "failed"], default: "pending", index: true },
  },
  { timestamps: true },
);

// Búsqueda de texto completo: nombre, carpeta, resumen y palabras clave pesan más que el contenido.
// Si cambia esta definición, ensureDocumentTextIndex (index.js) rehace el índice al arrancar.
export const DOCUMENT_TEXT_WEIGHTS = { filename: 5, summaryKeywords: 4, folder: 3, summary: 3, extractedText: 1 };
documentSchema.index(
  Object.fromEntries(Object.keys(DOCUMENT_TEXT_WEIGHTS).map((k) => [k, "text"])),
  { weights: DOCUMENT_TEXT_WEIGHTS, default_language: "spanish", name: "document_text" },
);

const groupSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    folders: { type: [String], default: [] }, // nombres de carpetas de primer nivel permitidas
  },
  { timestamps: true },
);

const folderConfigSchema = new mongoose.Schema(
  {
    folder: { type: String, required: true, unique: true, trim: true }, // carpeta de primer nivel
    blockedMessage: { type: String, default: "" }, // lo que ve quien no tiene permiso para esta carpeta
  },
  { timestamps: true },
);

// Documento único con la configuración de la biblioteca activa (ruta elegida con "Vincular biblioteca")
const appConfigSchema = new mongoose.Schema({
  _id: { type: String, default: "singleton" },
  libraryPath: { type: String, default: "" }, // relativa a LIBRARY_ROOT; "" = la propia raíz montada
  lastScanAt: { type: Date, default: null },
  lastScanCount: { type: Number, default: 0 },
});

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    dni: { type: String, required: true, unique: true, trim: true, uppercase: true },
    passwordHash: { type: String, default: null }, // solo lo tiene el admin; los usuarios normales entran solo con el DNI
    role: { type: String, enum: ["admin", "user"], default: "user" },
    group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", default: null },
    // Documentos marcados como favoritos desde el chat (se filtran por permisos al listarlos)
    favorites: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }], default: [] },
    // Permiso que da un admin a usuarios concretos para crear y editar fichas de la Guía rápida
    canEditGuide: { type: Boolean, default: false },
    // Búsqueda avanzada (la IA redacta respuestas): solo los admins y a quien un admin se la active
    canUseAdvanced: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const sessionSchema = new mongoose.Schema({
  _id: { type: String }, // el propio token, usado como id
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Mongo borra solas las caducadas

// Quién añadió, editó o borró qué: solo lo ve el admin, desde "Registro"
const activityLogSchema = new mongoose.Schema(
  {
    actorName: { type: String, required: true },
    actorDni: { type: String, required: true },
    action: { type: String, required: true }, // p. ej. "document.upload", "user.delete"
    target: { type: String, default: "" }, // descripción legible de sobre qué actuó
  },
  { timestamps: true },
);
activityLogSchema.index({ createdAt: -1 });

// Versión anterior de un archivo, apartada al sobrescribirlo (subida o restauración). Rutas relativas a
// LIBRARY_ROOT, no a la biblioteca activa: así sobreviven a un cambio de carpeta activa.
const fileVersionSchema = new mongoose.Schema(
  {
    originalPath: { type: String, required: true, index: true },
    storedPath: { type: String, required: true }, // dentro de .versiones/
    size: { type: Number, default: 0 },
    mtimeMs: { type: Number, default: 0 },
    byName: { type: String, default: "" },
    byDni: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Archivo o carpeta borrado desde la app: se mueve a .papelera/ y se purga pasados TRASH_RETENTION_DAYS
const trashItemSchema = new mongoose.Schema(
  {
    originalPath: { type: String, required: true },
    storedPath: { type: String, required: true }, // dentro de .papelera/
    kind: { type: String, enum: ["file", "folder"], required: true },
    size: { type: Number, default: 0 },
    files: { type: Number, default: 0 },
    byName: { type: String, default: "" },
    byDni: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
trashItemSchema.index({ createdAt: -1 });

// Guía rápida (guide.js): un único texto, con versión para no pisar ediciones simultáneas
const guideSchema = new mongoose.Schema({
  _id: { type: String },
  text: { type: String, default: "" },
  version: { type: Number, default: 0 },
  updatedAt: { type: Date, default: null },
  updatedBy: { type: String, default: "" },
  migratedAt: { type: Date, default: null }, // cuando el texto se pasó a fichas (GuideEntry)
});
const guideVersionSchema = new mongoose.Schema({ text: String, savedAt: Date, savedBy: String });
guideVersionSchema.index({ savedAt: -1 });

// Fichas de la Guía rápida (guide.js): sustituyen al texto único de `Guide`, que se migra solo.
// `fields` depende del tipo (aplicación, procedimiento, contacto, acceso o nota libre).
const guideEntrySchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["nota", "aplicacion", "procedimiento", "contacto", "acceso"], default: "nota" },
    category: { type: String, default: "", trim: true },
    title: { type: String, required: true, trim: true },
    keywords: { type: [String], default: [] },
    content: { type: String, default: "" },
    fields: { type: mongoose.Schema.Types.Mixed, default: {} },
    adminOnly: { type: Boolean, default: false },
    version: { type: Number, default: 1 },
    createdBy: { type: String, default: "" },
    updatedBy: { type: String, default: "" },
  },
  { timestamps: true, minimize: false },
);
guideEntrySchema.index({ category: 1, title: 1 });
// Copia de cada ficha antes de cada cambio o borrado (historial por ficha)
const guideEntryHistorySchema = new mongoose.Schema({
  entryId: { type: mongoose.Schema.Types.ObjectId, index: true },
  snapshot: { type: mongoose.Schema.Types.Mixed },
  action: { type: String, enum: ["edit", "delete"], default: "edit" },
  savedAt: { type: Date, default: Date.now },
  savedBy: { type: String, default: "" },
});
// Ajustes de búsqueda que mantienen los admins y editores: la lista de sinónimos
const searchSettingsSchema = new mongoose.Schema({ _id: { type: String }, synonyms: { type: String, default: "" }, updatedBy: String, updatedAt: Date });

export const Document = mongoose.model("Document", documentSchema);
// Veces que cada usuario abre (ve, descarga o previsualiza) cada documento: «más vistos» del inicio del chat
const docViewSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  doc: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
  count: { type: Number, default: 0 },
  lastAt: { type: Date, default: Date.now },
});
docViewSchema.index({ user: 1, doc: 1 }, { unique: true });
docViewSchema.index({ user: 1, count: -1 });
export const DocView = mongoose.model("DocView", docViewSchema);
export const FileVersion = mongoose.model("FileVersion", fileVersionSchema);
export const TrashItem = mongoose.model("TrashItem", trashItemSchema);
export const Group = mongoose.model("Group", groupSchema);
export const FolderConfig = mongoose.model("FolderConfig", folderConfigSchema);
export const AppConfig = mongoose.model("AppConfig", appConfigSchema);
export const User = mongoose.model("User", userSchema);
export const Session = mongoose.model("Session", sessionSchema);
export const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
export const Guide = mongoose.model("Guide", guideSchema);
export const GuideVersion = mongoose.model("GuideVersion", guideVersionSchema);
export const GuideEntry = mongoose.model("GuideEntry", guideEntrySchema);
export const GuideEntryHistory = mongoose.model("GuideEntryHistory", guideEntryHistorySchema);
export const SearchSettings = mongoose.model("SearchSettings", searchSettingsSchema);
