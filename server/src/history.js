// Versiones y papelera: une las operaciones en disco de library.js con su registro en Mongo.
import { FileVersion, TrashItem } from "./models.js";
import { moveToTrash, purgeStored, TRASH_DIR, VERSIONS_DIR } from "./library.js";

const VERSIONS_MAX = Number(process.env.VERSIONS_MAX) || 10; // versiones que se guardan por archivo
const TRASH_RETENTION_DAYS = Number(process.env.TRASH_RETENTION_DAYS) || 30;
const by = (req) => ({ byName: req.user?.name ?? "?", byDni: req.user?.dni ?? "?" });
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function recordVersion(req, version) {
  if (!version) return;
  await FileVersion.create({ ...version, ...by(req) });
  const old = await FileVersion.find({ originalPath: version.originalPath }).sort({ createdAt: -1, _id: -1 }).skip(VERSIONS_MAX);
  for (const v of old) {
    purgeStored(v.storedPath, VERSIONS_DIR);
    await v.deleteOne();
  }
}

export async function trash(req, relPath) {
  const item = moveToTrash(relPath);
  await TrashItem.create({ ...item, ...by(req) });
  return item;
}

export async function purgeTrashItem(item) {
  purgeStored(item.storedPath, TRASH_DIR);
  await item.deleteOne();
}

export async function purgeExpiredTrash() {
  const limit = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  for (const item of await TrashItem.find({ createdAt: { $lt: limit } })) await purgeTrashItem(item);
}

// Al renombrar una carpeta, el historial de sus archivos sigue a la ruta nueva
export async function renameVersionPaths(from, to) {
  const prefix = `${from}/`;
  await FileVersion.collection.updateMany(
    { originalPath: { $regex: `^${escapeRegex(prefix)}` } },
    [{ $set: { originalPath: { $concat: [`${to}/`, { $substrCP: ["$originalPath", [...prefix].length, 1_000_000] }] } } }],
  );
}

export const TRASH_DAYS = TRASH_RETENTION_DAYS;
