// Guía rápida: fichas cortas (procedimientos, altas de aplicaciones, contactos, accesos...) que
// mantienen los admins y los usuarios con permiso de edición, y que el chat consulta ANTES que la
// biblioteca. Vive en Mongo (GuideEntry), no en la biblioteca, así que no sale en «Documentos».
//
// Antes era un único texto (`Guide`); la primera vez se trocea en fichas (migrateLegacyGuide). El
// mismo formato de texto sirve para importar y exportar: fichas separadas por una línea de guiones o
// «=» (5 o más); la primera línea con texto es «Categoría · Título» (o solo el título); «[solo admin]»
// delante la reserva a los administradores; las líneas «Etiqueta: valor» conocidas pasan a los campos
// de su tipo (ver FIELD_LABELS).
import { Guide, GuideEntry, GuideEntryHistory } from "./models.js";
import { norm, queryConcepts, conceptIn, wholeWordIn, stemsOf, editDistance, SHORT_STOP } from "./search.js";

export const GUIDE_MAX_CHARS = 400_000; // importación de texto (por debajo del límite de express.json)
export const ENTRY_HISTORY_MAX = 20; // versiones anteriores que se guardan de cada ficha
export const TYPES = ["nota", "aplicacion", "procedimiento", "contacto", "acceso"];
export const DEFAULT_CATEGORIES = ["Red", "Aplicaciones", "Altas de aplicaciones", "Correo", "Instalaciones", "Soporte", "Contactos", "Accesos"];
const SEPARATOR = /^\s*[-=_]{5,}\s*$/m;
const ADMIN_TAG = /^\s*\[\s*solo\s+admin\s*\]\s*/i;
const EXPORT_SEPARATOR = "-".repeat(100);

// Campos de texto de cada tipo, con su etiqueta en el texto exportado y otras formas de escribirla
const FIELD_LABELS = {
  aplicacion: [
    ["acceso", "Acceso permitido a", []],
    ["url", "Dirección", ["direccion web", "url", "enlace"]],
    ["tramite", "Cómo se tramita el alta", ["como se tramita", "tramite"]],
    ["pide", "Cómo se pide", []],
    ["solicita", "Quién lo solicita", ["quien lo pide", "quien lo solicita", "lo solicita"]],
    ["observaciones", "Observaciones", []],
  ],
  contacto: [
    ["nombre", "Nombre", []],
    ["telefono", "Teléfono", ["extension", "movil", "telefono / extension", "extension / movil", "telefonos"]],
    ["correo", "Correo", ["email", "e-mail", "correo electronico"]],
  ],
};
const GROUP_LABELS = ["grupos del directorio activo", "grupos ad", "grupos", "como se da el acceso"];
const labelKey = (s) => norm(s).replace(/\s+/g, " ").trim();
const clip = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim().slice(0, max) : "");
const list = (v, maxItems, maxLen) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\n,]/) : [])
    .map((x) => clip(String(x ?? ""), maxLen))
    .filter(Boolean)
    .slice(0, maxItems);

// --- Ficha → texto -------------------------------------------------------------------------------
export const headingOf = (e) => (e.category ? `${e.category} · ${e.title}` : e.title);

// Cuerpo de la ficha (sin el título): lo que se ve en el chat, lo que se busca y lo que se exporta
export function renderBody(e) {
  const f = e.fields || {};
  const parts = [];
  const lines = [];
  for (const [key, label] of FIELD_LABELS[e.type] || []) {
    if (key === "observaciones" && f.grupos?.length) lines.push(groupLines(f.grupos));
    if (f[key]) lines.push(`${label}: ${f[key]}`);
  }
  if (lines.length) parts.push(lines.join("\n"));
  if (e.content?.trim()) parts.push(e.content.trim());
  if (e.type === "procedimiento" && f.pasos?.length) parts.push(f.pasos.map((p, i) => `${i + 1}. ${p.replace(/\n/g, "\n   ")}`).join("\n"));
  return parts.join("\n\n");
}
const groupLines = (grupos) => `Grupos del directorio activo (añadir al usuario o al equipo):\n${grupos.map((g) => `- ${g}`).join("\n")}`;

export function exportText(entries) {
  return entries
    .map((e) => {
      const head = `${e.adminOnly ? "[solo admin] " : ""}${headingOf(e)}`;
      const kw = e.keywords?.length ? `\nPalabras clave: ${e.keywords.join(", ")}` : "";
      return `${head}${kw}\n\n${renderBody(e)}`.trim();
    })
    .join(`\n\n${EXPORT_SEPARATOR}\n\n`) + "\n";
}

// --- Texto → fichas ------------------------------------------------------------------------------
function labelOf(line) {
  const m = line.match(/^\s*([^:\n]{3,70}?)\s*:\s*(.*)$/);
  if (!m || /^[a-z]$/i.test(m[1]) || /^https?$/i.test(m[1])) return null; // «G:\...» o «http://»
  return { key: labelKey(m[1]), value: m[2].trim() };
}
function fieldFor(type, key) {
  for (const [field, label, aliases] of FIELD_LABELS[type]) if (labelKey(label) === key || aliases.includes(key)) return field;
  return null;
}

// Pasos numerados al final del texto («1. ...», «2) ...», con líneas sangradas de continuación):
// {intro, pasos} o null si no los hay o si después de ellos sigue habiendo texto.
function splitSteps(lines) {
  const first = lines.findIndex((l) => /^\s*1[.)]\s+\S/.test(l));
  if (first < 0) return null;
  const pasos = [];
  for (const l of lines.slice(first)) {
    const m = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (m) pasos.push(m[1].trim());
    else if (!l.trim()) continue;
    else if (/^\s+\S/.test(l) || /^\s*[-•*]\s+/.test(l)) pasos[pasos.length - 1] += `\n${l.trim()}`;
    else return null;
  }
  return pasos.length >= 2 ? { intro: lines.slice(0, first).join("\n").trim(), pasos } : null;
}

// Un bloque de texto (una ficha) → {type, category, title, keywords, content, fields, adminOnly}
export function parseBlock(block) {
  const adminOnly = ADMIN_TAG.test(block);
  const lines = block.replace(ADMIN_TAG, "").split("\n");
  // Título: la primera línea con letras o números (sin viñetas ni guiones sueltos delante)
  const h = lines.findIndex((l) => /[\p{L}\p{N}]/u.test(l));
  const heading = (lines[h] || "").trim().replace(/^[-•*·\s]+/, "");
  let rest = lines.slice(h + 1);
  const dot = heading.indexOf(" · ");
  const category = dot > 0 ? heading.slice(0, dot).trim().slice(0, 100) : "";
  const title = (dot > 0 ? heading.slice(dot + 3) : heading).trim().slice(0, 150);
  let keywords = [];
  const kwLine = rest.findIndex((l) => l.trim());
  if (kwLine >= 0 && /^\s*palabras clave\s*:/i.test(rest[kwLine])) {
    keywords = list(rest[kwLine].replace(/^\s*palabras clave\s*:/i, ""), 20, 40);
    rest = rest.filter((_, i) => i !== kwLine);
  }
  const base = { category, title, keywords, adminOnly };
  const raw = rest.join("\n").trim();
  // Accesos y credenciales: siempre solo admin y el texto tal cual
  if (adminOnly) return { ...base, type: "acceso", content: raw, fields: {} };

  // Aplicación o contacto: líneas «Etiqueta: valor» conocidas (el resto queda como texto)
  for (const type of ["aplicacion", "contacto"]) {
    const fields = {};
    const grupos = [];
    const other = [];
    let inGroups = false;
    let hits = 0;
    for (const line of rest) {
      const lab = labelOf(line);
      const field = lab && fieldFor(type, lab.key);
      if (field && !fields[field]) { fields[field] = lab.value; hits++; inGroups = false; continue; }
      if (type === "aplicacion" && lab && GROUP_LABELS.includes(lab.key.replace(/\s*\(.*\)$/, ""))) {
        inGroups = true;
        hits++;
        if (lab.value && !/directorio activo/i.test(lab.value)) grupos.push(...list(lab.value, 100, 120));
        continue;
      }
      const item = inGroups && line.match(/^\s*[-•*]\s+(.+)$/);
      if (item) { if (!/^(y|o|e)$/i.test(item[1].trim())) grupos.push(item[1].trim()); continue; }
      inGroups = false;
      other.push(line);
    }
    const ok = type === "aplicacion" ? hits >= 1 : fields.nombre && (fields.telefono || fields.correo);
    if (ok) {
      if (grupos.length) fields.grupos = grupos;
      return { ...base, type, content: other.join("\n").replace(/\n{3,}/g, "\n\n").trim(), fields };
    }
  }
  const steps = splitSteps(rest);
  if (steps) return { ...base, type: "procedimiento", content: steps.intro, fields: { pasos: steps.pasos } };
  return { ...base, type: "nota", content: raw, fields: {} };
}

export function parseGuideText(text) {
  return (text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(new RegExp(SEPARATOR.source, "gm"))
    .map((b) => b.trim())
    .filter((b) => /[\p{L}\p{N}]/u.test(b))
    .map(parseBlock)
    .filter((e) => e.title);
}

// --- Validación de lo que llega del formulario ---------------------------------------------------
// Devuelve la ficha limpia o {error}. Las de tipo «acceso» siempre son solo admin.
export function sanitizeEntry(input) {
  const type = TYPES.includes(input?.type) ? input.type : "nota";
  const title = clip(input?.title, 150).replace(/\s+/g, " ");
  if (!title) return { error: "La ficha necesita un título." };
  const f = input?.fields || {};
  const fields = {};
  for (const [key] of FIELD_LABELS[type] || []) if (clip(f[key], 2000)) fields[key] = clip(f[key], 2000);
  if (type === "aplicacion") { const g = list(f.grupos, 100, 120); if (g.length) fields.grupos = g; }
  if (type === "procedimiento") { const p = list(Array.isArray(f.pasos) ? f.pasos : [], 60, 2000); if (p.length) fields.pasos = p; }
  return {
    type,
    category: clip(input?.category, 100).replace(/\s+/g, " "),
    title,
    keywords: [...new Set(list(input?.keywords, 20, 40))],
    content: clip(input?.content, 20_000),
    fields,
    adminOnly: type === "acceso" || Boolean(input?.adminOnly),
  };
}

// --- Duplicados ----------------------------------------------------------------------------------
export const titleKey = (e) => `${labelKey(e.category || "")}|${labelKey(e.title || "")}`;
const urlKey = (u) => norm(u || "").replace(/^\s*https?:\/\//, "").replace(/^www\./, "").replace(/[/#?\s]+$/, "");

// Raíces del título, incluidas las siglas de 3 letras («SMS», «VPN»)
const titleStems = (t) => [...new Set([...stemsOf(t), ...norm(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length === 3 && !SHORT_STOP.has(w))])];
function similarTitle(a, b) {
  const na = labelKey(a);
  const nb = labelKey(b);
  if (!na || !nb) return false;
  if (na === nb || (na.length >= 5 && nb.includes(na)) || (nb.length >= 5 && na.includes(nb))) return true;
  if (Math.min(na.length, nb.length) >= 6 && editDistance(na, nb, 2) <= 2) return true;
  const sa = titleStems(a);
  const sb = new Set(titleStems(b));
  if (!sa.length || !sb.size) return false;
  const common = sa.filter((s) => sb.has(s)).length;
  return common / new Set([...sa, ...sb]).size >= 0.5;
}

// Avisos mientras se rellena el formulario: misma categoría y título (bloquea al guardar), títulos
// parecidos, grupos del directorio activo o direcciones que ya están en otras fichas.
export function checkDuplicates(entry, others) {
  const key = titleKey(entry);
  const brief = (o) => ({ _id: o._id, title: o.title, category: o.category });
  const same = others.find((o) => titleKey(o) === key);
  const similar = others.filter((o) => o !== same && similarTitle(entry.title, o.title)).slice(0, 5).map(brief);
  const grupos = (entry.fields?.grupos || []).map((g) => ({
    value: g,
    entries: others.filter((o) => (o.fields?.grupos || []).some((x) => labelKey(x) === labelKey(g))).map(brief),
  })).filter((x) => x.entries.length);
  const u = urlKey(entry.fields?.url);
  const url = u ? others.filter((o) => urlKey(o.fields?.url) === u).map(brief) : [];
  return { same: same ? brief(same) : null, similar, grupos, url };
}

// --- Búsqueda (chat) -----------------------------------------------------------------------------
export function toSearchEntry(e) {
  const body = renderBody(e);
  const titleHay = norm(`${e.category || ""} ${e.title} ${(e.keywords || []).join(" ")}`);
  return { _id: e._id, title: e.title, category: e.category || "", type: e.type, body, adminOnly: e.adminOnly, titleHay, hay: `${titleHay} ${norm(body)}` };
}
// Compatibilidad (tests): texto → entradas listas para buscar
export const parseGuide = (text) => parseGuideText(text).map(toSearchEntry);

// Fichas que responden a la pregunta: cuenta los conceptos de la pregunta (raíz, sinónimos y
// erratas corregidas, ver search.js) que aparecen en cada ficha; los que están en el título, la
// categoría o las palabras clave suman el doble, y las palabras enteras un punto más (así
// «centralita» gana a «centros»). Hace falta que coincida al menos la mitad de los conceptos, y una
// segunda ficha solo sale si puntúa cerca de la primera.
export function searchGuide(entries, question, { isAdmin = false, max = 2, lexicon = null } = {}) {
  const concepts = queryConcepts(question, lexicon || {});
  if (!concepts.length) return [];
  const needed = Math.max(1, Math.ceil(concepts.length / 2));
  const ranked = entries
    .filter((e) => isAdmin || !e.adminOnly)
    .map((e) => {
      const hits = concepts.filter((c) => conceptIn(c, e.hay)).length;
      const inTitle = concepts.filter((c) => conceptIn(c, e.titleHay)).length;
      const whole = concepts.filter((c) => wholeWordIn(c, e.hay)).length;
      return { e, hits, score: hits * 2 + inTitle * 2 + whole };
    })
    .filter((r) => r.hits >= needed)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score || 0;
  return ranked
    .filter((r) => r.score >= best * 0.75)
    .slice(0, max)
    .map(({ e, score }) => ({ _id: e._id, title: e.title, category: e.category, type: e.type, body: e.body, adminOnly: e.adminOnly, score }));
}

// --- Persistencia --------------------------------------------------------------------------------
// La guía antigua (un único texto) se trocea en fichas una sola vez; el texto se queda en `Guide`
// como copia.
let migrating = null;
export function migrateLegacyGuide() {
  migrating ||= (async () => {
    const legacy = await Guide.findOneAndUpdate({ _id: "singleton", migratedAt: null, text: { $ne: "" } }, { migratedAt: new Date() }).lean();
    if (!legacy?.text) return 0;
    const t0 = Date.now();
    const docs = parseGuideText(legacy.text).map((e, i) => ({ ...e, createdBy: legacy.updatedBy || "", updatedBy: legacy.updatedBy || "", createdAt: new Date(t0 + i), updatedAt: new Date(t0 + i) }));
    if (docs.length) await GuideEntry.insertMany(docs, { timestamps: false });
    console.log(`Guía rápida: ${docs.length} fichas creadas a partir del texto anterior.`);
    return docs.length;
  })().finally(() => { migrating = null; });
  return migrating;
}

// Orden de la guía: categorías por orden de aparición (la primera ficha de cada una) y dentro de
// cada categoría, por fecha de creación (así se conserva el orden del .txt importado)
export function orderEntries(entries) {
  const sorted = [...entries].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const catOrder = new Map();
  for (const e of sorted) if (!catOrder.has(labelKey(e.category))) catOrder.set(labelKey(e.category), catOrder.size);
  return sorted.sort((a, b) => catOrder.get(labelKey(a.category)) - catOrder.get(labelKey(b.category)));
}

export async function allEntries({ isAdmin = true } = {}) {
  await migrateLegacyGuide();
  return orderEntries(await GuideEntry.find(isAdmin ? {} : { adminOnly: false }).lean());
}

// Caché en memoria de las fichas listas para buscar: se invalida en cada cambio
let cache = null;
export async function guideEntries() {
  if (!cache) cache = (await allEntries()).map(toSearchEntry);
  return cache;
}
export function invalidateGuide() {
  cache = null;
}

// Guarda la versión anterior de una ficha en su historial (las ENTRY_HISTORY_MAX últimas)
export async function snapshot(entry, action, by) {
  const { _id, __v, ...snap } = entry;
  await GuideEntryHistory.create({
    entryId: _id,
    snapshot: snap,
    action,
    savedAt: action === "delete" ? new Date() : entry.updatedAt || new Date(),
    savedBy: action === "delete" ? by : entry.updatedBy || "",
  });
  const old = await GuideEntryHistory.find({ entryId: _id }, "_id").sort({ savedAt: -1 }).skip(ENTRY_HISTORY_MAX).lean();
  if (old.length) await GuideEntryHistory.deleteMany({ _id: { $in: old.map((h) => h._id) } });
}
