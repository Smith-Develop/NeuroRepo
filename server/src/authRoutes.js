import { Router } from "express";
import mongoose from "mongoose";
import { User, Session, Group } from "./models.js";
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, requireAdmin } from "./auth.js";

const r = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v, max = Infinity) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const publicUser = (u) => ({ _id: u._id, name: u.name, dni: u.dni, role: u.role });

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

// Gestión de usuarios: solo el admin
r.post("/users", requireAdmin, wrap(async (req, res) => {
  const name = text(req.body?.name, 120);
  const dni = text(req.body?.dni, 40).toUpperCase();
  if (!name || !dni) return res.status(400).json({ error: "Nombre y DNI son obligatorios." });
  if (await User.exists({ dni })) return res.status(400).json({ error: "Ya existe un usuario con ese DNI." });
  const group = mongoose.isValidObjectId(req.body?.group) ? req.body.group : null;
  const user = await User.create({ name, dni, role: "user", group });
  res.status(201).json(publicUser(user));
}));

r.get("/users", requireAdmin, wrap(async (req, res) => {
  res.json(await User.find({}, "name dni role group createdAt").sort({ createdAt: 1 }).populate("group", "name").lean());
}));

r.patch("/users/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  if (text(req.body?.name, 120)) update.name = text(req.body.name, 120);
  if (req.body?.group === null) update.group = null;
  else if (mongoose.isValidObjectId(req.body?.group)) update.group = req.body.group;
  const user = await User.findOneAndUpdate({ _id: req.params.id, role: "user" }, update, { returnDocument: "after" })
    .select("name dni role group").populate("group", "name");
  user ? res.json(user) : res.status(404).end();
}));

r.delete("/users/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const user = await User.findOne({ _id: req.params.id, role: "user" });
  if (!user) return res.status(404).end();
  await Session.deleteMany({ user: user._id });
  await user.deleteOne();
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
  res.json({ created, updated, skipped: errors.length, errors: errors.slice(0, 50) });
}));

// Grupos: limitan qué carpetas puede consultar un usuario; sin grupo = sin acceso a ninguna
r.post("/groups", requireAdmin, wrap(async (req, res) => {
  const name = text(req.body?.name, 80);
  if (!name) return res.status(400).json({ error: "Dale un nombre al grupo." });
  const folders = Array.isArray(req.body?.folders) ? [...new Set(req.body.folders.map((f) => text(f, 200)).filter(Boolean))] : [];
  if (await Group.exists({ name })) return res.status(400).json({ error: "Ya existe un grupo con ese nombre." });
  const group = await Group.create({ name, folders });
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
  group ? res.json(group) : res.status(404).end();
}));

r.delete("/groups/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  await Group.deleteOne({ _id: req.params.id });
  await User.updateMany({ group: req.params.id }, { group: null });
  res.status(204).end();
}));

export default r;
