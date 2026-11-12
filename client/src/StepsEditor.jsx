const TYPES = [
  ["inicio", "Inicio"],
  ["paso", "Paso"],
  ["decision", "Decisión"],
  ["fin", "Fin"],
];

// Editor del procedimiento (diagrama de flujo): pasos en orden, con rama "No" opcional en las decisiones.
// value: [{ type, text, noTarget? }] · onChange(nextValue)
export default function StepsEditor({ value, onChange }) {
  function update(i, patch) {
    onChange(value.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function add() {
    onChange([...value, { type: value.length === 0 ? "inicio" : "paso", text: "" }]);
  }
  function remove(i) {
    onChange(value.filter((_, idx) => idx !== i).map((s) => (s.noTarget === i ? { ...s, noTarget: undefined } : s)));
  }
  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div className="steps-editor">
      {value.map((s, i) => (
        <div key={i} className="step-row">
          <span className="step-num">{i + 1}</span>
          <select value={s.type} onChange={(e) => update(i, { type: e.target.value, noTarget: undefined })}>
            {TYPES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <input value={s.text} onChange={(e) => update(i, { text: e.target.value })} placeholder="Describe este paso" maxLength={300} />
          {s.type === "decision" && (
            <select value={s.noTarget ?? ""} onChange={(e) => update(i, { noTarget: e.target.value === "" ? undefined : Number(e.target.value) })}>
              <option value="">Si es «No», ir a…</option>
              {value.map((o, j) => (j !== i ? <option key={j} value={j}>{j + 1}. {o.text.slice(0, 30) || "(sin texto)"}</option> : null))}
            </select>
          )}
          <div className="step-actions">
            <button type="button" className="link" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
            <button type="button" className="link" onClick={() => move(i, 1)} disabled={i === value.length - 1} aria-label="Bajar">↓</button>
            <button type="button" className="link" onClick={() => remove(i)} aria-label="Quitar paso">×</button>
          </div>
        </div>
      ))}
      <button type="button" className="ghost small" onClick={add}>+ Añadir paso</button>
    </div>
  );
}
