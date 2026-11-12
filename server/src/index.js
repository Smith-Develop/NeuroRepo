import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import routes from "./routes.js";
import authRoutes from "./authRoutes.js";
import { attachUser, requireAuth, bootstrapAdmin } from "./auth.js";
import { AIError } from "./ai.js";

const app = express();
app.set("trust proxy", 1); // para que req.secure/X-Forwarded-Proto funcionen tras el proxy de Coolify

if (!process.env.APP_PASSWORD && process.env.NODE_ENV === "production") {
  console.error("Falta APP_PASSWORD: no arranco en producción sin contraseña para crear el primer admin.");
  process.exit(1);
}

app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(attachUser);
app.use("/api", authRoutes);
app.use("/api", requireAuth, routes);

// En producción/Docker el servidor también sirve la web ya compilada
const dist = fileURLToPath(new URL("../../client/dist", import.meta.url));
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile("index.html", { root: dist }));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof AIError) return res.status(502).json({ error: err.message });
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT || 4000;
await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/notas-ia");
await bootstrapAdmin();
app.listen(PORT, () => console.log(`App en http://localhost:${PORT}`));
