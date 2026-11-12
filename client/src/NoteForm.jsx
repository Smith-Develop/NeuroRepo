import { useId, useState } from "react";

// Formulario para revisar/corregir lo que propuso la IA (o editar una nota guardada)
export default function NoteForm({ initial, scenarios, submitLabel, cancelLabel = "Descartar", onSubmit, onCancel, busy }) {
  const id = useId();
  const [f, setF] = useState({
    title: initial.title ?? "",
    summary: initial.summary ?? "",
    keyPoints: (initial.keyPoints ?? []).join("\n"),
    tags: (initial.tags ?? []).join(", "),
    scenario: initial.scenario?.name ?? initial.scenario ?? "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const isNew = f.scenario.trim() && !scenarios.some((s) => s.name.toLowerCase() === f.scenario.trim().toLowerCase());

  function submit(e) {
    e.preventDefault();
    onSubmit({
      title: f.title,
      summary: f.summary,
      keyPoints: f.keyPoints.split("\n").map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean),
      tags: f.tags.split(",").map((s) => s.trim()).filter(Boolean),
      scenario: f.scenario,
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
        Rama del árbol {isNew && <span className="badge">nueva rama</span>}
      </label>
      <input id={`${id}-r`} list={`${id}-list`} value={f.scenario} onChange={set("scenario")} required maxLength={80} />
      <datalist id={`${id}-list`}>{scenarios.map((s) => <option key={s._id} value={s.name} />)}</datalist>

      <div className="actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel} disabled={busy}>{cancelLabel}</button>}
        <button disabled={busy || !f.title.trim() || !f.scenario.trim()}>{busy ? "Guardando…" : submitLabel}</button>
      </div>
    </form>
  );
}
