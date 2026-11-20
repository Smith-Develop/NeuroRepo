import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { User, Session } from "./models.js";

const SESSION_DAYS = 30;
const COOKIE_NAME = "sid";

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function parseCookies(header = "") {
  return Object.fromEntries(
    header.split(";").filter(Boolean).map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())];
    }),
  );
}

// Token de la sesión actual (cookie "sid"), o undefined
export const sessionToken = (req) => parseCookies(req.headers.cookie)[COOKIE_NAME];

export async function createSession(user) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await Session.create({ _id: token, user: user._id, expiresAt });
  return { token, expiresAt };
}

// "Secure" solo si la petición llega por HTTPS (directo o tras el proxy de Coolify):
// NODE_ENV=production no sirve aquí porque el contenedor también se usa en local sin TLS.
export function setSessionCookie(req, res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

// IP del ordenador que se conecta, para el acceso por IP. Se usa la del socket, NO X-Forwarded-For: sin
// un proxy delante (instalación en Windows) cualquiera podría mandar esa cabecera y hacerse pasar por
// otro ordenador. Solo si hay un proxy de confianza delante (Docker/Coolify) se activa TRUST_PROXY_IP.
export function clientIp(req) {
  const raw = process.env.TRUST_PROXY_IP === "true" ? req.ip : req.socket?.remoteAddress;
  return String(raw || "").replace(/^::ffff:/, "");
}
export const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

// Middleware no bloqueante: deja req.user (con role y, si lo tiene, su grupo con las carpetas permitidas) o null
export async function attachUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  req.user = null;
  if (token) {
    const session = await Session.findById(token).populate({
      path: "user",
      select: "name dni role group canEditGuide canUseAdvanced",
      populate: { path: "group", select: "folders" },
    });
    if (session && session.expiresAt > new Date()) req.user = session.user;
  }
  next();
}

// Permisos por carpeta: un grupo guarda rutas de cualquier profundidad ("Calidad" o
// "Calidad/Procedimientos"), relativas a la biblioteca activa, y cada ruta incluye todas sus
// subcarpetas. Sin grupo no se ve nada; el admin lo ve todo. Los archivos sueltos en la raíz
// (folder "") solo los ve el admin.
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function allowedFolders(user) {
  return user.group?.folders ?? [];
}

export function canSeeFolder(user, folder = "") {
  if (user.role === "admin") return true;
  return allowedFolders(user).some((p) => folder === p || folder.startsWith(`${p}/`));
}

// Lo mismo que canSeeFolder, como filtro de Mongo sobre Document.folder
export function folderFilter(user) {
  if (user.role === "admin") return {};
  const paths = allowedFolders(user);
  if (!paths.length) return { _id: { $exists: false } }; // no coincide con nada
  return { $or: paths.flatMap((p) => [{ folder: p }, { folder: { $regex: `^${escapeRegex(p)}/` } }]) };
}

// "a/b/c" → ["a", "a/b", "a/b/c"]
export function folderAncestors(folder = "") {
  const parts = folder.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Solo el administrador puede hacer esto." });
  next();
}

// Fichas de la Guía rápida: los admins y los usuarios a los que un admin se lo haya permitido
export const canUseAdvanced = (user) => user?.role === "admin" || Boolean(user?.canUseAdvanced);
export const canEditGuide = (user) => user?.role === "admin" || Boolean(user?.canEditGuide);
export function requireGuideEditor(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
  if (!canEditGuide(req.user)) return res.status(403).json({ error: "No tienes permiso para editar la guía rápida." });
  next();
}

// Crea el admin a partir de BOOTSTRAP_ADMIN_NAME/DNI/PASSWORD si todavía no existe ninguno
export async function bootstrapAdmin() {
  if (await User.exists({ role: "admin" })) return;
  const name = process.env.BOOTSTRAP_ADMIN_NAME || "Administrador";
  const dni = process.env.BOOTSTRAP_ADMIN_DNI;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!dni || !password) return; // en desarrollo sin definir: no se crea admin todavía
  await User.create({ name, dni: dni.toUpperCase(), passwordHash: hashPassword(password), role: "admin" });
  console.log(`Admin creado: ${name} (${dni})`);
}
