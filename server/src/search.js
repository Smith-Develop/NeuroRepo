import { Document } from "./models.js";

// Reordena por cuántas palabras distintas de la pregunta aparecen (raíz de 5 letras, sin tildes)
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
// Palabras de relleno que no dicen QUÉ se busca: si contaran, un documento que dice "todos los
// talleres" adelantaría a los que de verdad hablan del tema ("Necesito todo lo de Servolab").
const STOP = new Set([
  "como", "cual", "cuales", "donde", "cuando", "para", "porque", "que", "necesito", "necesitamos", "busco", "buscar",
  "quiero", "queria", "tengo", "tiene", "tienen", "esta", "este", "esto", "estos", "estas", "sobre", "with",
  "todo", "toda", "todos", "todas", "dame", "puedes", "podrias", "saber", "relacionado", "relacionados", "relacionada",
  "referente", "informacion", "documento", "documentos", "documentacion", "archivo", "archivos", "cosas", "algo",
  "hola", "favor", "gracias", "existe", "hay",
]);

const stemsOf = (query) => [...new Set(norm(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)))];

function rerank(query, docs) {
  const stems = stemsOf(query);
  const hits = (d) => {
    const hay = norm([d.filename, d.folder, d.extractedText].join(" "));
    return stems.filter((s) => hay.includes(s)).length;
  };
  return docs.map((d) => ({ d, h: hits(d) })).sort((a, b) => b.h - a.h || b.d.score - a.d.score).map(({ d }) => d);
}

// Puntuación aproximada del mejor resultado, usada para decidir si hace falta el respaldo de IA
export function topScore(docs) {
  return docs[0]?.score ?? 0;
}

export async function searchDocuments(query, limit = 30) {
  // Una sola proyección: encadenar .select() después pisaría el $meta y dejaría "score" siempre undefined
  const found = await Document.find(
    { $text: { $search: query } },
    { filename: 1, ext: 1, folder: 1, topFolder: 1, size: 1, mtimeMs: 1, textOk: 1, hasText: 1, extractedText: 1, score: { $meta: "textScore" } },
  ).sort({ score: { $meta: "textScore" } }).limit(limit).lean();
  return rerank(query, found).map((d) => {
    const { extractedText, ...rest } = d;
    return { ...rest, excerpt: (extractedText || "").slice(0, 220).trim() };
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
