import { copyFileSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { AppConfig } from "./models.js";

// Carpeta montada en Docker (de lectura/escritura) desde el host: la base dentro de la cual se puede
// elegir cualquier subcarpeta como biblioteca activa, crear/renombrar/borrar carpetas y subir archivos,
// todo sin volver a tocar Docker.
// Normalizada (absoluta y sin barra final): en Windows puede llegar como G:\Docs\ o \\servidor\recurso, y
// safeResolve compara prefijos con path.sep.
export const LIBRARY_ROOT = path.resolve(process.env.LIBRARY_ROOT || "/app/library");

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
  const { abs, rel } = resolveVisible(relPath);
  if (!statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
    throw new LibraryPathError("Esa carpeta no existe.");
  }
  const config = await getAppConfig();
  config.libraryPath = rel;
  config.lastScanAt = null;
  config.lastScanCount = 0;
  await config.save();
  return config;
}

// Carpetas internas (ocultas: el indexador y el selector se saltan lo que empieza por ".")
export const VERSIONS_DIR = ".versiones";
export const TRASH_DIR = ".papelera";

export const toRootRel = (abs) => path.relative(LIBRARY_ROOT, abs).split(path.sep).join("/");
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

// Resuelve una ruta que manda el admin: dentro de LIBRARY_ROOT y sin tocar nada oculto (.versiones,
// .papelera, temporales). Con allowRoot=false rechaza también la raíz, que se compara ya resuelta
// para que algo como "x/.." no se cuele.
function resolveVisible(relPath, { allowRoot = true } = {}) {
  const abs = safeResolve(LIBRARY_ROOT, relPath || "");
  const rel = toRootRel(abs);
  if (!allowRoot && !rel) throw new LibraryPathError("No se puede tocar la raíz de la biblioteca.");
  if (rel.split("/").some((part) => part.startsWith("."))) throw new LibraryPathError("Ruta no válida.");
  return { abs, rel };
}

// Lista las subcarpetas directas de una ruta relativa a LIBRARY_ROOT, para el selector "Vincular biblioteca"
export function browseFolder(relPath = "") {
  const { abs, rel } = resolveVisible(relPath);
  mkdirSync(abs, { recursive: true });
  const entries = readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
  return { path: rel, folders: entries };
}

const SAFE_NAME = /^[^/\\:*?"<>|]+$/; // sin separadores de ruta ni caracteres problemáticos en Windows/Linux

function requireSafeName(name) {
  if (!name || !SAFE_NAME.test(name) || name.startsWith(".")) {
    throw new LibraryPathError("Nombre no válido (no puede empezar por punto ni llevar / \\ : * ? \" < > |).");
  }
}

// Crea una subcarpeta dentro de relPath (relativa a LIBRARY_ROOT)
export function createFolder(relPath, name) {
  requireSafeName(name);
  const { rel: parent } = resolveVisible(relPath);
  const { abs: dest, rel } = resolveVisible(parent ? `${parent}/${name}` : name);
  if (statSync(dest, { throwIfNoEntry: false })) throw new LibraryPathError("Ya existe una carpeta con ese nombre.");
  mkdirSync(dest, { recursive: true });
  return rel;
}

// Renombra una carpeta (no la raíz) dentro de LIBRARY_ROOT
export function renameFolder(relPath, newName) {
  requireSafeName(newName);
  const { abs, rel } = resolveVisible(relPath, { allowRoot: false });
  const parent = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
  const { abs: dest, rel: destRel } = resolveVisible(parent ? `${parent}/${newName}` : newName);
  if (statSync(dest, { throwIfNoEntry: false })) throw new LibraryPathError("Ya existe una carpeta con ese nombre.");
  renameSync(abs, dest);
  return { from: rel, to: destRel };
}

// Aparta la versión actual de un archivo (si existe) a .versiones/<carpeta>/<fecha>__<nombre>
function stashVersion(relFile) {
  const abs = safeResolve(LIBRARY_ROOT, relFile);
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st?.isFile()) return null;
  const dir = safeResolve(LIBRARY_ROOT, path.posix.join(VERSIONS_DIR, path.posix.dirname(relFile)));
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${stamp()}__${path.basename(relFile)}`);
  renameSync(abs, dest);
  return { originalPath: relFile, storedPath: toRootRel(dest), size: st.size, mtimeMs: st.mtimeMs };
}

// Escribe el contenido nuevo sin perder el anterior: primero en un temporal oculto junto al destino,
// después aparta la versión actual y por último renombra el temporal (mismo disco: renombrado atómico).
// Devuelve la versión apartada, o null si el archivo no existía.
function replaceFile(relFile, { buffer, copyFrom }) {
  const dest = safeResolve(LIBRARY_ROOT, relFile);
  mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.${path.basename(dest)}.${randomBytes(4).toString("hex")}.tmp`);
  try {
    if (copyFrom) copyFileSync(copyFrom, tmp);
    else writeFileSync(tmp, buffer);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  const version = stashVersion(relFile);
  renameSync(tmp, dest);
  return version;
}

// Guarda un archivo subido dentro de relFolder (relativa a LIBRARY_ROOT); si ya existía, el anterior
// queda como versión
export function saveUploadedFile(relFolder, filename, buffer) {
  requireSafeName(filename);
  const { rel: folder } = resolveVisible(relFolder);
  const { rel } = resolveVisible(folder ? `${folder}/${filename}` : filename);
  return { path: rel, version: replaceFile(rel, { buffer }) };
}

// Vuelve a poner una versión guardada en su sitio (copia: la versión sigue en el historial);
// lo que hubiera en ese momento pasa a ser a su vez una versión
export function restoreVersion({ originalPath, storedPath }) {
  const src = safeResolve(LIBRARY_ROOT, storedPath);
  if (!statSync(src, { throwIfNoEntry: false })?.isFile()) throw new LibraryPathError("Esa versión ya no está en el disco.");
  return replaceFile(resolveVisible(originalPath, { allowRoot: false }).rel, { copyFrom: src });
}

// Mueve un archivo o carpeta (no la raíz) a .papelera/<fecha>/<ruta original>
export function moveToTrash(relPath) {
  const { abs, rel } = resolveVisible(relPath, { allowRoot: false });
  const st = statSync(abs, { throwIfNoEntry: false });
  if (!st) throw new LibraryPathError("Ese archivo o carpeta ya no existe.");
  const dest = safeResolve(LIBRARY_ROOT, path.posix.join(TRASH_DIR, stamp(), rel));
  mkdirSync(path.dirname(dest), { recursive: true });
  renameSync(abs, dest);
  const folder = st.isDirectory();
  const files = folder ? readdirSync(dest, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length : 1;
  return { originalPath: rel, storedPath: toRootRel(dest), kind: folder ? "folder" : "file", size: folder ? 0 : st.size, files };
}

// Devuelve a su sitio algo de la papelera; falla si en la ruta original ya hay otra cosa
export function restoreFromTrash({ originalPath, storedPath }) {
  const src = safeResolve(LIBRARY_ROOT, storedPath);
  const { abs: dest } = resolveVisible(originalPath, { allowRoot: false });
  if (!statSync(src, { throwIfNoEntry: false })) throw new LibraryPathError("Ya no está en la papelera del disco.");
  if (statSync(dest, { throwIfNoEntry: false })) {
    throw new LibraryPathError(`Ya existe algo en /${originalPath}. Renómbralo o muévelo antes de restaurar.`);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  renameSync(src, dest);
  pruneEmptyDirs(path.dirname(src), TRASH_DIR);
}

// Borra para siempre un archivo/carpeta guardado en .versiones o .papelera
export function purgeStored(storedPath, baseDir) {
  const base = safeResolve(LIBRARY_ROOT, baseDir);
  const abs = safeResolve(LIBRARY_ROOT, storedPath);
  if (!abs.startsWith(base + path.sep)) throw new LibraryPathError("Ruta interna no válida.");
  rmSync(abs, { recursive: true, force: true });
  pruneEmptyDirs(path.dirname(abs), baseDir);
}

// Quita las carpetas que se quedan vacías (sin pasar de baseDir), para no dejar restos en .papelera/.versiones
function pruneEmptyDirs(dir, baseDir) {
  const stop = safeResolve(LIBRARY_ROOT, baseDir);
  while (dir.startsWith(stop + path.sep)) {
    try { rmdirSync(dir); } catch { break; }
    dir = path.dirname(dir);
  }
}
