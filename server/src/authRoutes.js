import { Router } from "express";
import mongoose from "mongoose";
import { User, Session, Group, ActivityLog, AppConfig } from "./models.js";
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, requireAdmin, sessionToken, clientIp, IPV4 } from "./auth.js";
import { logActivity } from "./activityLog.js";

const r = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v, max = Infinity) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const publicUser = (u) => ({ _id: u._id, name: u.name, dni: u.dni, role: u.role, canEditGuide: u.role === "admin" || Boolean(u.canEditGuide), canUseAdvanced: u.role === "admin" || Boolean(u.canUseAdvanced) });
const countAdmins = (excludeId) => User.countDocuments({ role: "admin", ...(excludeId ? { _id: { $ne: excludeId } } : {}) });

// Los usuarios normales entran solo con su DNI; el admin necesita además su contraseña.
// Si se manda un DNI de admin sin contraseña, se avisa con needsPassword para que el cliente pida el segundo campo.
r.post("/login", wrap(async (req, res) => {
  const dni = text(req.body?.dni, 40).toUpperCase();
  if (!dni) return res.status(400).json({ error: "Escribe tu DNI." });
  const user = await User.findOne({ dni });
  if (!user) return res.status(401).json({ error: "DNI no reconocido." });
  if (user.role !== "admin" && (await getLoginMode()) === "ip-only") {
    return res.status(403).json({ error: "Solo se puede entrar desde un ordenador asignado. Pide a Informática que asigne la IP de tu ordenador." });
  }
  if (user.role === "admin") {
    const password = text(req.body?.password, 200);
    if (!password) return res.status(401).json({ error: "Este DNI necesita contraseña.", needsPassword: true });
    if (!verifyPassword(password, user.passwordHash)) return res.status(401).json({ error: "Contraseña incorrecta." });
  }
  const { token, expiresAt } = await createSession(user);
  setSessionCookie(req, res, token, expiresAt);
  res.json({ user: publicUser(user) });
}));

r.post("/logout", wrap(async (req, res) => {
  const token = (req.headers.cookie || "").match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  if (token) await Session.deleteOne({ _id: decodeURIComponent(token) });
  clearSessionCookie(res);
  // Tras cerrar sesión no se vuelve a entrar solo por IP (si no, cerrar sesión no serviría de nada)
  // hasta que se pulse «Entrar con este ordenador» o se cierre el navegador
  res.cookie(NO_AUTO_COOKIE, "1", { httpOnly: true, sameSite: "lax" });
  res.status(204).end();
}));

// Sesión actual. Sin sesión, si la IP del ordenador está asignada a un usuario normal, entra solo.
// Devuelve también el modo de acceso y la IP, para que la pantalla de inicio sepa qué enseñar.
const NO_AUTO_COOKIE = "noauto";
const getLoginMode = async () => (await AppConfig.findById("singleton", "loginMode").lean())?.loginMode || "ip-or-dni";
async function loginByIp(req, res) {
  const ip = clientIp(req);
  const user = IPV4.test(ip) ? await User.findOne({ ips: ip, role: { $ne: "admin" } }) : null;
  if (!user) return null;
  const { token, expiresAt } = await createSession(user);
  setSessionCookie(req, res, token, expiresAt);
  res.clearCookie(NO_AUTO_COOKIE);
  req.user = user;
  await logActivity(req, "login.ip", `${user.name} (${user.dni}) desde ${ip}`);
  return user;
}
r.get("/me", wrap(async (req, res) => {
  if (req.user) return res.json({ user: publicUser(req.user) });
  const noAuto = /(?:^|;\s*)noauto=1/.test(req.headers.cookie || "");
  const user = noAuto ? null : await loginByIp(req, res);
  res.json({ user: user ? publicUser(user) : null, loginMode: await getLoginMode(), ip: clientIp(req) });
}));

// «Entrar con este ordenador» (después de cerrar sesión)
r.post("/login/ip", wrap(async (req, res) => {
  const user = await loginByIp(req, res);
  if (!user) return res.status(403).json({ error: `Este ordenador (IP ${clientIp(req)}) no está asignado a ningún usuario de DocuPaz.` });
  res.json({ user: publicUser(user) });
}));

// Modo de acceso (admin)
r.get("/settings/login", requireAdmin, wrap(async (req, res) => {
  res.json({ loginMode: await getLoginMode(), ip: clientIp(req) });
}));
r.put("/settings/login", requireAdmin, wrap(async (req, res) => {
  const loginMode = req.body?.loginMode === "ip-only" ? "ip-only" : "ip-or-dni";
  await AppConfig.updateOne({ _id: "singleton" }, { loginMode }, { upsert: true });
  await logActivity(req, "settings.login", loginMode === "ip-only" ? "solo por IP" : "por IP o DNI");
  res.json({ loginMode });
}));

// El admin cambia su propia contraseña; cierra el resto de sus sesiones abiertas.
r.post("/me/password", requireAdmin, wrap(async (req, res) => {
  const current = text(req.body?.current, 200);
  const next = text(req.body?.next, 200);
  if (next.length < 4) return res.status(400).json({ error: "La nueva contraseña necesita al menos 4 caracteres." });
  const user = await User.findById(req.user._id);
  if (!verifyPassword(current, user.passwordHash)) return res.status(400).json({ error: "La contraseña actual no es correcta." });
  user.passwordHash = hashPassword(next);
  await user.save();
  await Session.deleteMany({ user: user._id, _id: { $ne: sessionToken(req) } });
  await logActivity(req, "user.password-change", `${user.name} (${user.dni})`);
  res.status(204).end();
}));

// Gestión de usuarios: solo el admin. Puede haber varios admins (cada uno con su propia contraseña).
r.post("/users", requireAdmin, wrap(async (req, res) => {
  const name = text(req.body?.name, 120);
  const dni = text(req.body?.dni, 40).toUpperCase();
  if (!name || !dni) return res.status(400).json({ error: "Nombre y DNI son obligatorios." });
  if (await User.exists({ dni })) return res.status(400).json({ error: "Ya existe un usuario con ese DNI." });
  const role = req.body?.role === "admin" ? "admin" : "user";
  if (role === "admin") {
    const password = text(req.body?.password, 200);
    if (password.length < 4) return res.status(400).json({ error: "El admin necesita una contraseña de al menos 4 caracteres." });
    const user = await User.create({ name, dni, role, passwordHash: hashPassword(password) });
    await logActivity(req, "user.create", `${name} (${dni}) · admin`);
    return res.status(201).json(publicUser(user));
  }
  const group = mongoose.isValidObjectId(req.body?.group) ? req.body.group : null;
  const user = await User.create({ name, dni, role: "user", group });
  await logActivity(req, "user.create", `${name} (${dni})`);
  res.status(201).json(publicUser(user));
}));

r.get("/users", requireAdmin, wrap(async (req, res) => {
  res.json(await User.find({}, "name dni role group canEditGuide canUseAdvanced ips createdAt").sort({ createdAt: 1 }).populate("group", "name").lean());
}));

r.patch("/users/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).end();

  if (text(req.body?.name, 120)) user.name = text(req.body.name, 120);
  if (req.body?.group === null) user.group = null;
  else if (mongoose.isValidObjectId(req.body?.group)) user.group = req.body.group;

  if (typeof req.body?.canEditGuide === "boolean") user.canEditGuide = req.body.canEditGuide;
  if (typeof req.body?.canUseAdvanced === "boolean") user.canUseAdvanced = req.body.canUseAdvanced;
  if (Array.isArray(req.body?.ips)) {
    const ips = [...new Set(req.body.ips.map((ip) => text(ip, 15)).filter(Boolean))].slice(0, 10);
    const bad = ips.find((ip) => !IPV4.test(ip));
    if (bad) return res.status(400).json({ error: `«${bad}» no es una IP válida (p. ej. 10.35.16.120).` });
    const taken = ips.length ? await User.findOne({ _id: { $ne: user._id }, ips: { $in: ips } }, "name ips").lean() : null;
    if (taken) return res.status(409).json({ error: `La IP ${ips.find((ip) => taken.ips.includes(ip))} ya está asignada a ${taken.name}.` });
    user.ips = ips;
  }

  if (req.body?.role === "user" && user.role === "admin") {
    if ((await countAdmins(user._id)) < 1) return res.status(400).json({ error: "Debe quedar al menos un admin." });
    user.role = "user";
    user.passwordHash = null;
  } else if (req.body?.role === "admin" && user.role !== "admin") {
    const password = text(req.body?.password, 200);
    if (password.length < 4) return res.status(400).json({ error: "El admin necesita una contraseña de al menos 4 caracteres." });
    user.role = "admin";
    user.ips = []; // los admins nunca entran por IP
    user.passwordHash = hashPassword(password);
    user.group = null;
  } else if (user.role === "admin" && text(req.body?.password, 200)) {
    user.passwordHash = hashPassword(text(req.body.password, 200));
  }

  await user.save();
  await user.populate("group", "name");
  await logActivity(req, "user.update", `${user.name} (${user.dni})`);
  res.json({ _id: user._id, name: user.name, dni: user.dni, role: user.role, group: user.group, canEditGuide: user.canEditGuide, canUseAdvanced: user.canUseAdvanced, ips: user.ips });
}));

r.delete("/users/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).end();
  if (user.role === "admin" && (await countAdmins(user._id)) < 1) {
    return res.status(400).json({ error: "Debe quedar al menos un admin." });
  }
  await Session.deleteMany({ user: user._id });
  await user.deleteOne();
  await logActivity(req, "user.delete", `${user.name} (${user.dni})`);
  res.status(204).end();
}));

// Importación masiva: una línea por usuario "Nombre,DNI". Crea los nuevos y actualiza el nombre de los que ya existan.
r.post("/users/import", requireAdmin, wrap(async (req, res) => {
  const content = text(req.body?.text, 500_000);
  if (!content) return res.status(400).json({ error: "Manda el contenido del .txt." });
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let created = 0, updated = 0;
  const errors = [];
  for (const [i, line] of lines.entries()) {
    const [rawName, rawDni] = line.split(",");
    const name = text(rawName, 120);
    const dni = text(rawDni, 40).toUpperCase();
    if (!name || !dni) { errors.push({ line: i + 1, reason: "Formato esperado: Nombre,DNI" }); continue; }
    const existing = await User.findOne({ dni });
    if (existing) {
      if (existing.role !== "admin") { existing.name = name; await existing.save(); updated++; }
    } else {
      await User.create({ name, dni, role: "user" });
      created++;
    }
  }
  await logActivity(req, "user.import", `${created} creado(s), ${updated} actualizado(s), ${errors.length} con error`);
  res.json({ created, updated, skipped: errors.length, errors: errors.slice(0, 50) });
}));

// Grupos: limitan qué carpetas puede consultar un usuario; sin grupo = sin acceso a ninguna
r.post("/groups", requireAdmin, wrap(async (req, res) => {
  const name = text(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "Dale un nombre al grupo." });
  const folders = Array.isArray(req.body?.folders) ? [...new Set(req.body.folders.map((f) => text(f, 200)).filter(Boolean))] : [];
  if (await Group.exists({ name })) return res.status(400).json({ error: "Ya existe un grupo con ese nombre." });
  const group = await Group.create({ name, folders });
  await logActivity(req, "group.create", name);
  res.status(201).json(group);
}));

r.get("/groups", requireAdmin, wrap(async (req, res) => {
  res.json(await Group.find().sort({ createdAt: 1 }).lean());
}));

r.patch("/groups/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  if (text(req.body?.name, 80)) update.name = text(req.body.name, 80);
  if (Array.isArray(req.body?.folders)) update.folders = [...new Set(req.body.folders.map((f) => text(f, 200)).filter(Boolean))];
  const group = await Group.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" });
  if (!group) return res.status(404).end();
  await logActivity(req, "group.update", group.name);
  res.json(group);
}));

r.delete("/groups/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const group = await Group.findByIdAndDelete(req.params.id);
  if (!group) return res.status(404).end();
  await User.updateMany({ group: req.params.id }, { group: null });
  await logActivity(req, "group.delete", group.name);
  res.status(204).end();
}));

// Registro de actividad: quién añadió, editó o borró qué (solo admin)
r.get("/activity", requireAdmin, wrap(async (req, res) => {
  res.json(await ActivityLog.find().sort({ createdAt: -1 }).limit(500).lean());
}));

export default r;
