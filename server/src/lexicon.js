// Lo que la búsqueda necesita además de la pregunta: los sinónimos que mantienen los admins y el
// vocabulario conocido (palabras de la guía, de los nombres de archivo y carpetas, y de los
// sinónimos) para corregir erratas. Se recalcula como mucho cada VOCAB_TTL_MS, o al cambiar la guía
// o los sinónimos.
import { Document, SearchSettings } from "./models.js";
import { norm, parseSynonyms } from "./search.js";
import { guideEntries } from "./guide.js";

const VOCAB_TTL_MS = 10 * 60 * 1000;
export const SYNONYMS_MAX_CHARS = 50_000;
let lexicon = null;
let builtAt = 0;
let building = null;

export function invalidateLexicon() {
  lexicon = null;
}

export async function getSynonymsText() {
  return (await SearchSettings.findById("singleton").lean()) || { synonyms: "", updatedBy: "", updatedAt: null };
}

export async function saveSynonyms(text, user) {
  const saved = await SearchSettings.findOneAndUpdate(
    { _id: "singleton" },
    { synonyms: text, updatedBy: user?.name || "", updatedAt: new Date() },
    { upsert: true, new: true },
  ).lean();
  invalidateLexicon();
  return saved;
}

async function build() {
  const synonyms = parseSynonyms((await getSynonymsText()).synonyms);
  const words = new Set();
  const add = (t) => {
    for (const w of norm(t || "").split(/[^\p{L}\p{N}]+/u)) if (w.length >= 4 && w.length <= 30 && !/\d/.test(w)) words.add(w);
  };
  synonyms.flat().forEach(add);
  for (const e of await guideEntries()) add(e.hay);
  for await (const d of Document.find({}, { filename: 1, folder: 1 }).lean().cursor()) add(`${d.filename.replace(/\.[^.]+$/, "")} ${d.folder}`);
  return { synonyms, vocab: { words, stems: new Set([...words].map((w) => w.slice(0, 5))) } };
}

export async function getLexicon() {
  if (lexicon && Date.now() - builtAt < VOCAB_TTL_MS) return lexicon;
  building ||= build()
    .then((l) => { lexicon = l; builtAt = Date.now(); return l; })
    .finally(() => { building = null; });
  try {
    return await building;
  } catch {
    return { synonyms: [], vocab: null }; // la búsqueda sigue funcionando sin sinónimos ni correcciones
  }
}
