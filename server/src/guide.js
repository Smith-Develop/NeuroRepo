// Guía rápida: apuntes cortos que mantienen los admins (procedimientos, rutas, teléfonos...) y que el
// chat consulta ANTES que la biblioteca. Vive en Mongo (no es un documento de la biblioteca, así que
// no aparece en «Documentos»), como un único texto que se edita tal cual, igual que un .txt.
//
// Formato: las entradas se separan con una línea de guiones o signos «=» (5 o más), como en el .txt
// original. La primera línea con texto es el título. Una entrada que empieza por «[solo admin]» solo
// la ven los administradores (para contraseñas y datos internos).
import { Guide, GuideVersion } from "./models.js";
import { norm, stemsOf } from "./search.js";

export const GUIDE_MAX_CHARS = 400_000; // por debajo del límite de 1 MB de express.json, con tildes incluidas
export const GUIDE_VERSIONS_MAX = 20;
const SEPARATOR = /^\s*[-=_]{5,}\s*$/m;
const ADMIN_TAG = /^\s*\[\s*solo\s+admin\s*\]\s*/i;

export function parseGuide(text) {
  return (text || "")
    .replace(/\r\n?/g, "\n")
    .split(new RegExp(SEPARATOR.source, "gm"))
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const adminOnly = ADMIN_TAG.test(block);
      const body = block.replace(ADMIN_TAG, "").trim();
      // Título: la primera línea con letras o números (sin viñetas ni guiones sueltos delante)
      const title = (body.split("\n").find((l) => /[\p{L}\p{N}]/u.test(l)) || "").trim().replace(/^[-•*·\s]+/, "").slice(0, 120);
      return { title, body, adminOnly, hay: norm(body), titleHay: norm(title) };
    });
}

// Entradas que responden a la pregunta: cuenta las raíces de la pregunta (mismo criterio que la
// búsqueda de documentos) que aparecen en cada entrada; suman además las del título y las palabras
// que aparecen enteras (así «centralita» gana a «centros»). Hace falta que coincida al menos la mitad
// de las raíces, y una segunda entrada solo sale si puntúa cerca de la primera.
export function searchGuide(entries, question, { isAdmin = false, max = 2 } = {}) {
  const stems = stemsOf(question);
  if (!stems.length) return [];
  const words = [...new Set(norm(question).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))];
  const needed = Math.max(1, Math.ceil(stems.length / 2));
  const ranked = entries
    .filter((e) => isAdmin || !e.adminOnly)
    .map((e) => {
      const hits = stems.filter((s) => e.hay.includes(s)).length;
      const inTitle = stems.filter((s) => e.titleHay.includes(s)).length;
      const whole = words.filter((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}($|[^\\p{L}\\p{N}])`, "u").test(e.hay)).length;
      return { e, hits, score: hits * 2 + inTitle + whole };
    })
    .filter((r) => r.hits >= needed)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score || 0;
  return ranked
    .filter((r) => r.score >= best * 0.75)
    .slice(0, max)
    .map(({ e, score }) => ({ title: e.title, body: e.body, adminOnly: e.adminOnly, score }));
}

// Caché en memoria del texto ya troceado: se invalida al guardar
let cache = null;
export async function guideEntries() {
  if (!cache) {
    const doc = await Guide.findById("singleton").lean();
    cache = parseGuide(doc?.text || "");
  }
  return cache;
}

export async function getGuide() {
  return (await Guide.findById("singleton").lean()) || { text: "", version: 0, updatedAt: null, updatedBy: "" };
}

// Guarda con control de versión (si otro admin la cambió entretanto, no se pisa: 409) y conserva la
// anterior en el historial (las GUIDE_VERSIONS_MAX últimas).
export async function saveGuide(text, expectedVersion, user) {
  const current = await getGuide();
  if ((current.version || 0) !== expectedVersion) return { conflict: true, current };
  if (current.text) {
    await GuideVersion.create({ text: current.text, savedAt: current.updatedAt || new Date(), savedBy: current.updatedBy || "" });
    const old = await GuideVersion.find({}, "_id").sort({ savedAt: -1 }).skip(GUIDE_VERSIONS_MAX).lean();
    if (old.length) await GuideVersion.deleteMany({ _id: { $in: old.map((v) => v._id) } });
  }
  const saved = await Guide.findOneAndUpdate(
    { _id: "singleton" },
    { text, version: (current.version || 0) + 1, updatedAt: new Date(), updatedBy: user?.name || "" },
    { upsert: true, new: true },
  ).lean();
  cache = null;
  return { saved };
}
