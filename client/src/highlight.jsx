// Resalta con <mark> las palabras del texto que empiezan por alguno de los términos de la búsqueda
// (las raíces que devuelve el servidor en `highlight`, sin tildes ni mayúsculas). Un término de 3
// letras (siglas como VPN) solo marca la palabra entera; uno de varias palabras, cada una de ellas.
const strip = (c) => c.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function Highlight({ text, terms }) {
  if (!text || !terms?.length) return text || null;
  const list = [...new Set(terms.flatMap((t) => t.split(" ")).filter((t) => t.length >= 3))];
  const out = [];
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const w = [...m[0]].map(strip).join("");
    if (!list.some((t) => (t.length <= 3 ? w === t : w.startsWith(t)))) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={m.index}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (!out.length) return text;
  out.push(text.slice(last));
  return out;
}
