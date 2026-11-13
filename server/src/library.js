import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AppConfig } from "./models.js";

// Carpeta montada en Docker (de lectura/escritura) desde el host: la base dentro de la cual se puede
// elegir cualquier subcarpeta como biblioteca activa, crear/renombrar/borrar carpetas y subir archivos,
// todo sin volver a tocar Docker.
export const LIBRARY_ROOT = process.env.LIBRARY_ROOT || "/app/library";

export class LibraryPathError extends Error {}

// Resuelve una ruta relativa dentro de una raíz y comprueba que no se sale de ella (anti path-traversal)
export function safeResolve(root, relPath = "") {
  const resolved = path.resolve(root, relPath || ".");
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new LibraryPathError("Ruta fuera de la biblioteca.");
  }
  return resolved;
}

export async function getAppConfig() {
  return (await AppConfig.findById("singleton")) ?? (await AppConfig.create({ _id: "singleton" }));
}

// Ruta absoluta de la biblioteca activa (la raíz montada, o la subcarpeta elegida con "Vincular biblioteca")
export async function getActiveLibraryPath() {
  const config = await getAppConfig();
  try {
    return safeResolve(LIBRARY_ROOT, config.libraryPath || "");
  } catch {
    return LIBRARY_ROOT; // la subcarpeta guardada ya no existe: cae a la raíz
  }
}

export async function setActiveLibraryPath(relPath) {
  const abs = safeResolve(LIBRARY_ROOT, relPath || "");
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
    throw new LibraryPathError("Esa carpeta no existe.");
  }
  const config = await getAppConfig();
  config.libraryPath = relPath || "";
  config.lastScanAt = null;
  config.lastScanCount = 0;
  await config.save();
  return config;
}

// Lista las subcarpetas directas de una ruta relativa a LIBRARY_ROOT, para el selector "Vincular biblioteca"
export function browseFolder(relPath = "") {
  const abs = safeResolve(LIBRARY_ROOT, relPath || "");
  mkdirSync(abs, { recursive: true });
  const entries = readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  return { path: relPath || "", folders: entries };
}

const SAFE_NAME = /^[^/\\:*?"<>|]+$/; // sin separadores de ruta ni caracteres problemáticos en Windows/Linux

function requireSafeName(name) {
  if (!name || !SAFE_NAME.test(name) || name === "." || name === "..") {
    throw new LibraryPathError("Nombre de carpeta no válido.");
  }
}

// Crea una subcarpeta dentro de relPath (relativa a LIBRARY_ROOT)
export function createFolder(relPath, name) {
  requireSafeName(name);
  const parent = safeResolve(LIBRARY_ROOT, relPath || "");
  const dest = safeResolve(LIBRARY_ROOT, relPath ? `${relPath}/${name}` : name);
  if (statSync(dest, { throwIfNoEntry: false })) throw new LibraryPathError("Ya existe una carpeta con ese nombre.");
  mkdirSync(dest, { recursive: true });
  return path.relative(LIBRARY_ROOT, dest).split(path.sep).join("/");
}

// Renombra una carpeta (no la raíz) dentro de LIBRARY_ROOT
export function renameFolder(relPath, newName) {
  if (!relPath) throw new LibraryPathError("No se puede renombrar la raíz de la biblioteca.");
  requireSafeName(newName);
  const abs = safeResolve(LIBRARY_ROOT, relPath);
  const dest = safeResolve(LIBRARY_ROOT, `${path.dirname(relPath) === "." ? "" : `${path.dirname(relPath)}/`}${newName}`);
  if (statSync(dest, { throwIfNoEntry: false })) throw new LibraryPathError("Ya existe una carpeta con ese nombre.");
  renameSync(abs, dest);
  return path.relative(LIBRARY_ROOT, dest).split(path.sep).join("/");
}

// Borra una carpeta (no la raíz) y todo su contenido, dentro de LIBRARY_ROOT
export function deleteFolder(relPath) {
  if (!relPath) throw new LibraryPathError("No se puede borrar la raíz de la biblioteca.");
  const abs = safeResolve(LIBRARY_ROOT, relPath);
  rmSync(abs, { recursive: true, force: true });
}

// Guarda un archivo subido dentro de relFolder (relativa a LIBRARY_ROOT)
export function saveUploadedFile(relFolder, filename, buffer) {
  requireSafeName(filename);
  const dir = safeResolve(LIBRARY_ROOT, relFolder || "");
  mkdirSync(dir, { recursive: true });
  const dest = safeResolve(LIBRARY_ROOT, relFolder ? `${relFolder}/${filename}` : filename);
  writeFileSync(dest, buffer);
  return path.relative(LIBRARY_ROOT, dest).split(path.sep).join("/");
}
