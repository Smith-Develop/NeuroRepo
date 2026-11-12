import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { existsSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import routes from "./routes.js";
import { AIError } from "./ai.js";

const app = express();

// Contraseña de acceso (HTTP Basic). Obligatoria al exponer la app en internet.
const USER = process.env.APP_USER || "admin";
const PASSWORD = process.env.APP_PASSWORD;
if (!PASSWORD && process.env.NODE_ENV === "production") {
  console.error("Falta APP_PASSWORD: no arranco en producción sin contraseña.");
  process.exit(1);
}
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
if (PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization || "").split(" ");
    const [u, ...rest] = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":") : [];
    if (u !== undefined && same(u, USER) && same(rest.join(":"), PASSWORD)) return next();
    res.set("WWW-Authenticate", 'Basic realm="Mi conocimiento", charset="UTF-8"').status(401).send("Acceso restringido");
  });
}
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", routes);

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
app.listen(PORT, () => console.log(`App en http://localhost:${PORT}`));
