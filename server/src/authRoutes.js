import { Router } from "express";
import mongoose from "mongoose";
import { User, Session, Group, ActivityLog } from "./models.js";
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, requireAdmin } from "./auth.js";
import { logActivity } from "./activityLog.js";

const r = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v, max = Infinity) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const publicUser = (u) => ({ _id: u._id, name: u.name, dni: u.dni, role: u.role });
const countAdmins = (excludeId) => User.countDocuments({ role: "admin", ...(excludeId ? { _id: { $ne: excludeId } } : {}) });

// Los usuarios normales entran solo con su DNI; el admin necesita además su contraseña.
// Si se manda un DNI de admin sin contraseña, se avisa con needsPassword para que el cliente pida el segundo campo.
r.post("/login", wrap(async (req, res) => {
  const dni = text(req.body?.dni, 40).toUpperCase();
  if (!dni) return res.status(400).json({ error: "Escribe tu DNI." });
  const user = await User.findOne({ dni });
  if (!user) return res.status(401).json({ error: "DNI no reconocido." });
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
  res.status(204).end();
}));

r.get("/me", wrap(async (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
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
  res.json(await User.find({}, "name dni role group createdAt").sort({ createdAt: 1 }).populate("group", "name").lean());
}));

r.patch("/users/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).end();

  if (text(req.body?.name, 120)) user.name = text(req.body.name, 120);
  if (req.body?.group === null) user.group = null;
  else if (mongoose.isValidObjectId(req.body?.group)) user.group = req.body.group;

  if (req.body?.role === "user" && user.role === "admin") {
    if ((await countAdmins(user._id)) < 1) return res.status(400).json({ error: "Debe quedar al menos un admin." });
    user.role = "user";
    user.passwordHash = null;
  } else if (req.body?.role === "admin" && user.role !== "admin") {
    const password = text(req.body?.password, 200);
    if (password.length < 4) return res.status(400).json({ error: "El admin necesita una contraseña de al menos 4 caracteres." });
    user.role = "admin";
    user.passwordHash = hashPassword(password);
    user.group = null;
  } else if (user.role === "admin" && text(req.body?.password, 200)) {
    user.passwordHash = hashPassword(text(req.body.password, 200));
  }

  await user.save();
  await user.populate("group", "name");
  await logActivity(req, "user.update", `${user.name} (${user.dni})`);
  res.json({ _id: user._id, name: user.name, dni: user.dni, role: user.role, group: user.group });
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
