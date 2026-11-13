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
  },
  { timestamps: true },
);

// Búsqueda de texto completo: nombre de archivo y carpeta pesan más que el contenido extraído
documentSchema.index(
  { filename: "text", folder: "text", extractedText: "text" },
  { weights: { filename: 5, folder: 3, extractedText: 1 }, default_language: "spanish" },
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
  },
  { timestamps: true },
);

const sessionSchema = new mongoose.Schema({
  _id: { type: String }, // el propio token, usado como id
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true },
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // Mongo borra solas las caducadas

export const Document = mongoose.model("Document", documentSchema);
export const Group = mongoose.model("Group", groupSchema);
export const FolderConfig = mongoose.model("FolderConfig", folderConfigSchema);
export const AppConfig = mongoose.model("AppConfig", appConfigSchema);
export const User = mongoose.model("User", userSchema);
export const Session = mongoose.model("Session", sessionSchema);
