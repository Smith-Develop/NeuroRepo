import { useId, useMemo, useState } from "react";

// Formulario para revisar/corregir lo que propuso la IA (o editar una nota guardada)
export default function NoteForm({ initial, scenarios, notes = [], submitLabel, cancelLabel = "Descartar", onSubmit, onCancel, busy }) {
  const id = useId();
  const [f, setF] = useState({
    title: initial.title ?? "",
    summary: initial.summary ?? "",
    keyPoints: (initial.keyPoints ?? []).join("\n"),
    tags: (initial.tags ?? []).join(", "),
    scenario: initial.scenario?.name ?? initial.scenario ?? "",
  });
  const [related, setRelated] = useState(
    (initial.relatedNotes ?? []).map((r) => ({ note: r.note?._id ?? r.note, title: r.note?.title ?? "", reason: r.reason ?? "" })),
  );
  const [relQuery, setRelQuery] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isNew = f.scenario.trim() && !scenarios.some((s) => s.name.toLowerCase() === f.scenario.trim().toLowerCase());

  const candidates = useMemo(
    () => notes.filter((n) => n._id !== initial._id && !related.some((r) => r.note === n._id)),
    [notes, initial._id, related],
  );
  const match = candidates.find((n) => n.title.toLowerCase() === relQuery.trim().toLowerCase());

  function addRelated() {
    if (!match) return;
    setRelated([...related, { note: match._id, title: match.title, reason: "" }]);
    setRelQuery("");
  }
  const setReason = (i) => (e) => setRelated(related.map((r, idx) => (idx === i ? { ...r, reason: e.target.value } : r)));
  const removeRelated = (i) => () => setRelated(related.filter((_, idx) => idx !== i));

  function submit(e) {
    e.preventDefault();
    onSubmit({
      title: f.title,
      summary: f.summary,
      keyPoints: f.keyPoints.split("\n").map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean),
      tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
      scenario: f.scenario,
      relatedNotes: related.map((r) => ({ note: r.note, reason: r.reason })),
    });
  }

  return (
    <form className="note-form" onSubmit={submit}>
      <label htmlFor={`${id}-t`}>Título</label>
      <input id={`${id}-t`} value={f.title} onChange={set("title")} required maxLength={200} />

      <label htmlFor={`${id}-s`}>Resumen</label>
      <textarea id={`${id}-s`} rows={3} value={f.summary} onChange={set("summary")} maxLength={2000} />

      <label htmlFor={`${id}-k`}>Puntos clave <small>(uno por línea)</small></label>
      <textarea id={`${id}-k`} rows={4} value={f.keyPoints} onChange={set("keyPoints")} />

      <label htmlFor={`${id}-g`}>Etiquetas <small>(separadas por comas)</small></label>
      <input id={`${id}-g`} value={f.tags} onChange={set("tags")} />

      <label htmlFor={`${id}-r`}>
        App {isNew && <span className="badge">nueva app</span>}
      </label>
      <input id={`${id}-r`} list={`${id}-list`} value={f.scenario} onChange={set("scenario")} required maxLength={80} />
      <datalist id={`${id}-list`}>{scenarios.map((s) => <option key={s._id} value={s.name} />)}</datalist>

      <label htmlFor={`${id}-rel`}>Depende de <small>(otras casuísticas, de esta app o de otra)</small></label>
      <div className="rel-add">
        <input id={`${id}-rel`} list={`${id}-rel-list`} value={relQuery} onChange={(e) => setRelQuery(e.target.value)}
          placeholder="Busca una casuística por título…" />
        <datalist id={`${id}-rel-list`}>{candidates.map((n) => <option key={n._id} value={n.title} />)}</datalist>
        <button type="button" className="ghost small" disabled={!match} onClick={addRelated}>Enlazar</button>
      </div>
      {related.length > 0 && (
        <ul className="rel-list">
          {related.map((r, i) => (
            <li key={r.note}>
              <span className="rel-title">{r.title}</span>
              <input value={r.reason} onChange={setReason(i)} placeholder="¿Por qué dependen? (opcional)" maxLength={200} />
              <button type="button" className="link" onClick={removeRelated(i)} aria-label={`Quitar enlace con ${r.title}`}>×</button>
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
        <button disabled={busy || !f.title.trim() || !f.scenario.trim()}>{busy ? "Guardando…" : submitLabel}</button>
      </div>
    </form>
  );
}
