import { Document } from "./models.js";

// Reordena por cuántas palabras distintas de la pregunta aparecen (raíz de 5 letras, sin tildes)
export const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Palabras de relleno que no dicen QUÉ se busca: si contaran, un documento que dice "todos los
// talleres" adelantaría a los que de verdad hablan del tema ("Necesito todo lo de Servolab").
const STOP = new Set([
  "como", "cual", "cuales", "donde", "cuando", "para", "porque", "que", "necesito", "necesitamos", "busco", "buscar",
  "quiero", "queria", "tengo", "tiene", "tienen", "esta", "este", "esto", "estos", "estas", "sobre", "with",
  "todo", "toda", "todos", "todas", "dame", "puedes", "podrias", "saber", "relacionado", "relacionados", "relacionada",
  "referente", "informacion", "documento", "documentos", "documentacion", "archivo", "archivos", "cosas", "algo",
  "hola", "favor", "gracias", "existe", "hay", "hago", "hacer", "puedo", "debo", "quien", "quiere", "desde", "hasta", "puede", "pueden", "tambien",
]);

export const stemsOf = (query) => [...new Set(norm(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
// Palabras de 3 letras que no dicen nada; el resto (VPN, SMS, APM...) cuenta como palabra entera
export const SHORT_STOP = new Set(["que", "con", "del", "los", "las", "una", "uno", "por", "mas", "sin", "son", "sus", "hay", "muy", "ese", "esa", "eso", "mis", "tus", "les", "nos", "ver", "doy", "dar", "pon", "cual", "the", "and", "for"]);
const SPLIT = /[^\p{L}\p{N}]+/u;
const wordRe = (w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u");

// --- Sinónimos y erratas ---------------------------------------------------------------------------
// Sinónimos: una línea por grupo de términos equivalentes, separados por comas («vpn, forticlient,
// acceso remoto»). Las líneas que empiezan por # son comentarios.
export function parseSynonyms(text) {
  return (text || "")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .map((l) => [...new Set(l.split(/[,;]/).map((t) => norm(t).replace(/\s+/g, " ").trim()).filter((t) => t.length >= 2))])
    .filter((g) => g.length >= 2);
}

// Distancia de edición (Levenshtein) con corte: devuelve max + 1 en cuanto se pasa de max
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Palabras conocidas a 1 (o 2, si es larga) letras de distancia de una que no lo es: «impresroa» →
// «impresora». Solo para palabras que no están en el vocabulario.
function corrections(word, vocab) {
  if (word.length < 5 || /\d/.test(word) || vocab.words.has(word)) return [];
  // Si la raíz ya es conocida, la búsqueda por raíz la encuentra: solo se completa la palabra para $text
  const sameStem = vocab.stems.has(word.slice(0, 5));
  const max = word.length >= 8 ? 2 : 1;
  let best = max + 1;
  let found = [];
  for (const v of vocab.words) {
    if (Math.abs(v.length - word.length) > max || (sameStem && !v.startsWith(word.slice(0, 5)))) continue;
    const d = editDistance(word, v, max);
    if (d < best) { best = d; found = [v]; } else if (d === best && d <= max && found.length < 3) found.push(v);
  }
  return best <= max ? found : [];
}

const altOf = (term) => {
  if (term.includes(" ")) return { s: term, whole: false };
  if (term.length <= 3) return { s: term, whole: true };
  return { s: term.slice(0, 5), whole: false };
};

// La pregunta como lista de "conceptos": cada palabra con contenido, con sus alternativas (raíz de
// 5 letras; sinónimos; correcciones de erratas). Un concepto cuenta si aparece cualquiera de ellas.
// `expand` son las palabras completas que se añaden a la búsqueda $text de Mongo.
export function queryConcepts(question, { synonyms = [], vocab = null } = {}) {
  const q = norm(question || "").replace(/\s+/g, " ").trim();
  const concepts = [];
  const byKey = new Map();
  for (const w of q.split(SPLIT).filter(Boolean)) {
    let base;
    if (w.length >= 4 && !STOP.has(w)) base = { s: w.slice(0, 5), whole: false };
    else if (w.length === 3 && !SHORT_STOP.has(w) && !/^\d+$/.test(w)) base = { s: w, whole: true };
    else continue;
    if (byKey.has(base.s)) continue;
    const c = { word: w, alts: [base], expand: [] };
    for (const g of synonyms) {
      if (g.some((t) => !t.includes(" ") && (t === w || (w.length >= 4 && t.length >= 4 && t.slice(0, 5) === base.s)))) {
        c.alts.push(...g.map(altOf));
        c.expand.push(...g.filter((t) => t !== w));
      }
    }
    if (vocab && !base.whole) {
      for (const v of corrections(w, vocab)) { c.alts.push(altOf(v)); c.expand.push(v); }
    }
    byKey.set(base.s, c);
    concepts.push(c);
  }
  // Sinónimos de varias palabras («acceso remoto»): si la frase está en la pregunta, sus alternativas
  // se suman a los conceptos de esas palabras
  for (const g of synonyms) {
    for (const t of g) {
      if (!t.includes(" ") || !` ${q} `.includes(` ${t} `)) continue;
      for (const c of concepts) if (t.split(" ").includes(c.word)) { c.alts.push(...g.map(altOf)); c.expand.push(...g.filter((x) => x !== t)); }
    }
  }
  for (const c of concepts) {
    const seen = new Set();
    c.alts = c.alts.filter((a) => !seen.has(a.s) && seen.add(a.s)).map((a) => ({ ...a, re: a.whole ? wordRe(a.s) : null }));
    c.expand = [...new Set(c.expand)];
  }
  return concepts;
}

export const conceptIn = (c, hay) => c.alts.some((a) => (a.whole ? a.re.test(hay) : hay.includes(a.s)));
export const wholeWordIn = (c, hay) => c.word.length >= 4 && wordRe(c.word).test(hay);
// Lo que el cliente resalta con <mark> (raíces y siglas; un término de 3 letras, solo palabra entera)
export const highlightTerms = (concepts) => [...new Set(concepts.flatMap((c) => c.alts.map((a) => a.s)))];
export const expandedQuery = (question, concepts) => [question, ...concepts.flatMap((c) => c.expand)].join(" ");

function rerank(concepts, docs) {
  // Coincidir en el nombre, la carpeta, el resumen o sus palabras clave pesa el doble que solo en el
  // contenido. `matched` = conceptos distintos de la pregunta que aparecen en algún sitio.
  return docs
    .map((d) => {
      const head = norm(`${d.filename} ${d.folder} ${d.summary || ""} ${(d.summaryKeywords || []).join(" ")}`);
      const all = `${head} ${norm(d.extractedText || "")}`;
      const matched = concepts.filter((c) => conceptIn(c, all)).length;
      const inHead = concepts.filter((c) => conceptIn(c, head)).length;
      return { d: { ...d, matched, conceptCount: concepts.length }, h: matched + inHead };
    })
    .sort((a, b) => b.h - a.h || b.d.score - a.d.score)
    .map(({ d }) => d);
}

// Un documento cuenta como relacionado si tiene al menos la mitad de lo que se pregunta (el mismo
// criterio que la guía rápida): así no salen documentos que solo comparten una palabra suelta.
export const isRelevant = (d) => !d.conceptCount || d.matched >= Math.ceil(d.conceptCount / 2);

// Puntuación aproximada del mejor resultado, usada para decidir si hace falta el respaldo de IA
export function topScore(docs) {
  return docs[0]?.score ?? 0;
}

// Párrafo (o frase) del documento que mejor responde: el que contiene más conceptos de la pregunta,
// ampliado con lo que le sigue hasta ~size caracteres. Sin coincidencias, el principio del texto.
export function bestSnippet(text, concepts, size = 300) {
  const clean = (text || "").replace(/\r/g, "");
  if (!clean.trim()) return "";
  const segs = clean.split(/\n+|(?<=[.!?;])\s+(?=\p{Lu})/u).map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean);
  let bestI = -1;
  let bestH = 0;
  segs.forEach((t, i) => {
    const h = concepts.reduce((acc, c) => acc + (conceptIn(c, norm(t)) ? 1 : 0), 0);
    if (h > bestH) { bestH = h; bestI = i; }
  });
  if (bestI < 0) return clean.replace(/\s+/g, " ").trim().slice(0, 220);
  let out = segs[bestI];
  if (out.length > size * 1.6) {
    // Párrafo muy largo: el trozo alrededor de la primera coincidencia
    const n = norm(out);
    const pos = Math.min(...concepts.flatMap((c) => c.alts.map((a) => n.indexOf(a.s))).filter((p) => p >= 0));
    const from = Math.max(0, pos - 80);
    return `${from > 0 ? "…" : ""}${out.slice(from, from + size).trim()}…`;
  }
  for (let j = bestI + 1; j < segs.length && out.length < size; j++) out += ` ${segs[j]}`;
  if (bestI > 0 && out.length < size * 0.6) out = `${segs[bestI - 1]} ${out}`;
  return out.length > size * 1.6 ? `${out.slice(0, size * 1.6).trim()}…` : out;
}

// lexicon: {synonyms, vocab} de lexicon.js (opcional). Devuelve los documentos con `excerpt` = el
// párrafo que mejor responde.
export async function searchDocuments(query, limit = 30, lexicon = null) {
  const concepts = queryConcepts(query, lexicon || {});
  // Una sola proyección: encadenar .select() después pisaría el $meta y dejaría "score" siempre undefined
  const found = await Document.find(
    { $text: { $search: expandedQuery(query, concepts) } },
    { filename: 1, ext: 1, folder: 1, topFolder: 1, size: 1, mtimeMs: 1, textOk: 1, hasText: 1, extractedText: 1, summary: 1, summaryKeywords: 1, score: { $meta: "textScore" } },
  ).sort({ score: { $meta: "textScore" } }).limit(limit).lean();
  return rerank(concepts, found).map((d) => {
    const { extractedText, ...rest } = d;
    return { ...rest, excerpt: bestSnippet(extractedText, concepts) };
  });
}

// Fragmentos del texto de un documento más relacionados con la pregunta (para el modo avanzado):
// trozos de ~size caracteres puntuados por cuántas raíces de la pregunta contienen, en el orden
// en que aparecen en el documento, sin pasar de maxChars en total.
export function bestPassages(query, text, maxChars = 1500, size = 600) {
  if (!text?.trim()) return "(Sin texto extraído: puede ser un documento escaneado o una imagen. Solo se conoce su nombre.)";
  const stems = stemsOf(query);
  const chunks = [];
  for (let i = 0; i < text.length; i += size) chunks.push({ i, t: text.slice(i, i + size) });
  const scored = chunks.map((c) => {
    const n = norm(c.t);
    return { ...c, h: stems.reduce((acc, s) => acc + (n.includes(s) ? 1 : 0), 0) };
  });
  const picked = scored.filter((c) => c.h > 0).sort((a, b) => b.h - a.h || a.i - b.i).slice(0, Math.max(1, Math.floor(maxChars / size)));
  const chosen = picked.length ? picked : scored.slice(0, 1); // sin coincidencias: el principio del documento
  return chosen.sort((a, b) => a.i - b.i).map((c) => c.t.replace(/\s+/g, " ").trim()).join(" […] ");
}
