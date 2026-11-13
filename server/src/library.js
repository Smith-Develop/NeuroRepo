import { mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AppConfig } from "./models.js";

// Carpeta montada en Docker (de solo lectura) desde el host: la base dentro de la cual se puede
// elegir cualquier subcarpeta como biblioteca activa, sin volver a tocar Docker.
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
