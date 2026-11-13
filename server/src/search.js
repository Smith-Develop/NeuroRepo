import { Document } from "./models.js";

// Reordena por cuántas palabras distintas de la pregunta aparecen (raíz de 5 letras, sin tildes)
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["como", "cual", "cuales", "donde", "cuando", "para", "porque", "que", "necesito", "busco", "quiero", "tengo", "esta", "este", "esto", "sobre", "with"]);

function rerank(query, docs) {
  const stems = [...new Set(norm(query).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
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
    { filename: 1, ext: 1, folder: 1, topFolder: 1, size: 1, mtimeMs: 1, textOk: 1, extractedText: 1, score: { $meta: "textScore" } },
  ).sort({ score: { $meta: "textScore" } }).limit(limit).lean();
  return rerank(query, found).map((d) => {
    const { extractedText, ...rest } = d;
    return { ...rest, excerpt: (extractedText || "").slice(0, 220).trim() };
  });
}
