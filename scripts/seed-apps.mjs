// Vuelca en una instalación nueva (p. ej. Coolify) todas las apps y casuísticas de scripts/data/aplicaciones.json.
// Pensado para una base vacía: si ya hay notas con el mismo título, se duplicarán.
//
// Uso:
//   BASE_URL=https://tu-dominio.coolify APP_USER=admin APP_PASSWORD=tu-contraseña node scripts/seed-apps.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE_URL = (process.env.BASE_URL || "http://localhost:4000").replace(/\/$/, "");
const APP_USER = process.env.APP_USER || "admin";
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  console.error("Falta APP_PASSWORD (la contraseña del admin de ese despliegue).");
  process.exit(1);
}

const dataPath = fileURLToPath(new URL("./data/aplicaciones.json", import.meta.url));
const source = JSON.parse(readFileSync(dataPath, "utf8"));

// Normaliza lo exportado (con _id de Mongo, scenario/relatedNotes poblados) a lo que espera POST /notes
const notes = source.map((n) => ({
  title: n.title,
  category: n.category || "",
  scenario: n.scenario?.name || n.scenario,
  summary: n.summary || "",
  keyPoints: n.keyPoints || [],
  tags: n.tags || [],
  raw: n.raw || n.title,
  steps: n.steps || [],
  _deps: (n.relatedNotes || []).map((r) => ({ toTitle: r.note?.title, reason: r.reason || "" })).filter((d) => d.toTitle),
}));

let cookie = "";
async function api(path, opts = {}) {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  await api("/login", { method: "POST", body: { username: APP_USER, password: APP_PASSWORD } });
  console.log(`Conectado a ${BASE_URL} como ${APP_USER}.`);

  console.log(`Creando ${notes.length} notas…`);
  const idByTitle = new Map();
  for (const n of notes) {
    const { _deps, ...body } = n;
    const created = await api("/notes", { method: "POST", body });
    idByTitle.set(n.title, created._id);
  }

  console.log("Aplicando dependencias…");
  let depCount = 0;
  for (const n of notes) {
    const relatedNotes = n._deps
      .filter((d) => idByTitle.has(d.toTitle))
      .map((d) => ({ note: idByTitle.get(d.toTitle), reason: d.reason }));
    if (relatedNotes.length) {
      await api(`/notes/${idByTitle.get(n.title)}`, { method: "PATCH", body: { relatedNotes } });
      depCount += relatedNotes.length;
    }
  }

  console.log(`Listo: ${notes.length} notas creadas, ${depCount} dependencias aplicadas.`);
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
