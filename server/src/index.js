import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import routes from "./routes.js";
import authRoutes from "./authRoutes.js";
import { attachUser, requireAuth, bootstrapAdmin } from "./auth.js";
import { AIError } from "./ai.js";
import { scheduleIndexing } from "./indexer.js";

const app = express();
app.set("trust proxy", 1); // para que req.secure/X-Forwarded-Proto funcionen tras el proxy de Coolify

if (process.env.NODE_ENV === "production" && !(process.env.BOOTSTRAP_ADMIN_DNI && process.env.BOOTSTRAP_ADMIN_PASSWORD)) {
  console.error("Faltan BOOTSTRAP_ADMIN_DNI/BOOTSTRAP_ADMIN_PASSWORD: no arranco en producción sin forma de crear el primer admin.");
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

// Reintenta la conexión inicial a Mongo: justo al arrancar el contenedor, el contenedor de Mongo
// puede no estar aceptando conexiones todavía aunque Docker ya lo marque como "Started".
async function connectWithRetry(uri, attempts = 10, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await mongoose.connect(uri);
    } catch (e) {
      if (i === attempts) throw e;
      console.error(`Mongo no está listo todavía (intento ${i}/${attempts}): ${e.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

const PORT = process.env.PORT || 4000;
await connectWithRetry(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/notas-ia");
await bootstrapAdmin();
scheduleIndexing();
app.listen(PORT, () => console.log(`App en http://localhost:${PORT}`));
