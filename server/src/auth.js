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

// Middleware no bloqueante: deja req.user (con role y, si lo tiene, su grupo con las apps permitidas) o null
export async function attachUser(req, _res, next) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  req.user = null;
  if (token) {
    const session = await Session.findById(token).populate({
      path: "user",
      select: "username role group",
      populate: { path: "group", select: "apps" },
    });
    if (session && session.expiresAt > new Date()) req.user = session.user;
  }
  next();
}

// Apps que puede consultar un usuario normal (vacío si no tiene grupo). El admin no usa esto: lo ve todo.
export function allowedScenarioIds(user) {
  return new Set((user.group?.apps ?? []).map(String));
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

// Crea el admin a partir de APP_USER/APP_PASSWORD si todavía no existe ninguno
export async function bootstrapAdmin() {
  if (await User.exists({ role: "admin" })) return;
  const username = (process.env.APP_USER || "admin").toLowerCase();
  const password = process.env.APP_PASSWORD;
  if (!password) return; // en desarrollo sin contraseña: no se crea admin todavía
  await User.create({ username, passwordHash: hashPassword(password), role: "admin" });
  console.log(`Admin creado: ${username}`);
}
