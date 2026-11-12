import { Router } from "express";
import mongoose from "mongoose";
import { User, Session, Suggestion } from "./models.js";
import { hashPassword, verifyPassword, createSession, setSessionCookie, clearSessionCookie, requireAuth, requireAdmin } from "./auth.js";

const r = Router();
const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const text = (v, max = Infinity) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const publicUser = (u) => ({ _id: u._id, username: u.username, role: u.role });

r.post("/login", wrap(async (req, res) => {
  const username = text(req.body?.username, 80).toLowerCase();
  const password = text(req.body?.password, 200);
  const user = username && (await User.findOne({ username }));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Usuario o contraseña incorrectos." });
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
  const username = text(req.body?.username, 80).toLowerCase();
  const password = text(req.body?.password, 200);
  if (!username || password.length < 4) return res.status(400).json({ error: "Usuario y contraseña (mín. 4 caracteres) son obligatorios." });
  if (await User.exists({ username })) return res.status(400).json({ error: "Ya existe ese usuario." });
  const user = await User.create({ username, passwordHash: hashPassword(password), role: "user" });
  res.status(201).json(publicUser(user));
}));

r.get("/users", requireAdmin, wrap(async (req, res) => {
  res.json(await User.find({}, "username role createdAt").sort({ createdAt: 1 }).lean());
}));

r.delete("/users/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const user = await User.findOne({ _id: req.params.id, role: "user" });
  if (!user) return res.status(404).end();
  await Session.deleteMany({ user: user._id });
  await user.deleteOne();
  res.status(204).end();
}));

// Sugerencias: cualquier persona logueada manda, solo el admin las revisa
r.post("/suggestions", requireAuth, wrap(async (req, res) => {
  const t = text(req.body?.text, 4000);
  if (!t) return res.status(400).json({ error: "Escribe algo antes de enviarlo." });
  const kind = req.body?.kind === "cambio" ? "cambio" : "nota";
  const note = mongoose.isValidObjectId(req.body?.note) ? req.body.note : undefined;
  const suggestion = await Suggestion.create({ text: t, kind, note, author: req.user._id });
  res.status(201).json(suggestion);
}));

r.get("/suggestions", requireAdmin, wrap(async (req, res) => {
  res.json(
    await Suggestion.find().sort({ createdAt: -1 }).limit(200)
      .populate("author", "username").populate("note", "title").lean(),
  );
}));

r.patch("/suggestions/:id", requireAdmin, wrap(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
  const update = {};
  if (["pendiente", "resuelta", "descartada"].includes(req.body?.status)) update.status = req.body.status;
  if (mongoose.isValidObjectId(req.body?.note)) update.note = req.body.note;
  const s = await Suggestion.findByIdAndUpdate(req.params.id, update, { returnDocument: "after" })
    .populate("author", "username").populate("note", "title");
  s ? res.json(s) : res.status(404).end();
}));

export default r;
