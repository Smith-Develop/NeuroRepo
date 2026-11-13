import { useEffect, useRef, useState } from "react";
import FlowchartEditor from "./FlowchartEditor";

// Piezas disponibles. title y scenario son obligatorias para poder guardar, pero se
// construyen igual que las demás: hay que arrastrarlas a la zona de construcción.
const PIECES = [
  { key: "title", label: "Título", color: "#7aa2ff" },
  { key: "scenario", label: "App", color: "#c084fc" },
  { key: "category", label: "Categoría", color: "#fb923c" },
  { key: "summary", label: "Resumen", color: "#5eead4" },
  { key: "keyPoints", label: "Puntos clave", color: "#facc15" },
  { key: "tags", label: "Etiquetas", color: "#f472b6" },
  { key: "related", label: "Depende de", color: "#4ade80" },
  { key: "steps", label: "Procedimiento", color: "#38bdf8" },
];
const EMPTY = { title: "", scenario: "", category: "", summary: "", keyPoints: "", tags: "", related: [], steps: [] };

function RelatedPicker({ notes, value, onChange }) {
  const [q, setQ] = useState("");
  const candidates = notes.filter((n) => !value.some((r) => r.note === n._id));
  const match = candidates.find((n) => n.title.toLowerCase() === q.trim().toLowerCase());
  function add() {
    if (!match) return;
    onChange([...value, { note: match._id, title: match.title, reason: "" }]);
    setQ("");
  }
  return (
    <>
      <div className="rel-add">
        <input list="lego-rel-list" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca una casuística por título…" />
        <datalist id="lego-rel-list">{candidates.map((n) => <option key={n._id} value={n.title} />)}</datalist>
        <button type="button" className="ghost small" disabled={!match} onClick={add}>Enlazar</button>
      </div>
      {value.length > 0 && (
        <ul className="rel-list">
          {value.map((r, i) => (
            <li key={r.note}>
              <span className="rel-title">{r.title}</span>
              <input value={r.reason} onChange={(e) => onChange(value.map((x, idx) => (idx === i ? { ...x, reason: e.target.value } : x)))}
                placeholder="¿Por qué dependen? (opcional)" maxLength={200} />
              <button type="button" className="link" onClick={() => onChange(value.filter((_, idx) => idx !== i))} aria-label={`Quitar enlace con ${r.title}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function PieceBlock({ pieceKey, value, onChange, onRemove, scenarios, notes }) {
  const meta = PIECES.find((p) => p.key === pieceKey);
  return (
    <div className="lego-block" style={{ "--c": meta.color }}>
      <div className="lego-block-head">
        <span>{meta.label}</span>
        <button type="button" className="link" onClick={onRemove} aria-label={`Quitar pieza ${meta.label}`}>×</button>
      </div>
      {pieceKey === "title" && (
        <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} placeholder="Título de la casuística" autoFocus />
      )}
      {pieceKey === "scenario" && (
        <>
          <input list="lego-scenarios" value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} placeholder="Nombre de la app" />
          <datalist id="lego-scenarios">{scenarios.map((s) => <option key={s._id} value={s.name} />)}</datalist>
        </>
      )}
      {pieceKey === "summary" && <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} maxLength={2000} placeholder="Resumen breve" />}
      {pieceKey === "keyPoints" && <textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} placeholder="Uno por línea" />}
      {pieceKey === "category" && <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={80} placeholder="p. ej. Errores, Usuarios…" />}
      {pieceKey === "tags" && <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Separadas por comas" />}
      {pieceKey === "related" && <RelatedPicker notes={notes} value={value} onChange={onChange} />}
      {pieceKey === "steps" && <FlowchartEditor value={value} onChange={onChange} />}
    </div>
  );
}

// Constructor manual: arma una casuística pieza a pieza, sin pasar por la IA.
export default function Builder({ scenarios, notes, busy, onSubmit, onCancel }) {
  const [placed, setPlaced] = useState([]);
  const [values, setValues] = useState(EMPTY);
  const [dragKey, setDragKey] = useState(null);
  const dropRef = useRef(null);
  const ghostRef = useRef(null);
  const lastPos = useRef({ x: 0, y: 0 });

  function onPieceDown(key, e) {
    lastPos.current = { x: e.clientX, y: e.clientY };
    setDragKey(key);
  }

  useEffect(() => {
    if (!dragKey) return;
    const moveGhost = (x, y) => { if (ghostRef.current) ghostRef.current.style.transform = `translate(${x}px, ${y}px)`; };
    moveGhost(lastPos.current.x, lastPos.current.y);
    function move(e) { lastPos.current = { x: e.clientX, y: e.clientY }; moveGhost(e.clientX, e.clientY); }
    function up() {
      const r = dropRef.current?.getBoundingClientRect();
      const { x, y } = lastPos.current;
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        setPlaced((p) => (p.includes(dragKey) ? p : [...p, dragKey]));
      }
      setDragKey(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragKey]);

  function removePiece(key) {
    setPlaced((p) => p.filter((k) => k !== key));
    setValues((s) => ({ ...s, [key]: key === "related" || key === "steps" ? [] : "" }));
  }

  const canSave = values.title.trim() && values.scenario.trim();

  function submit() {
    const keyPoints = values.keyPoints.split("\n").map((s) => s.replace(/^[-•*]\s*/, "").trim()).filter(Boolean);
    onSubmit({
      title: values.title,
      summary: values.summary,
      keyPoints,
      tags: values.tags.split(",").map((s) => s.trim()).filter(Boolean),
      category: values.category,
      scenario: values.scenario,
      relatedNotes: values.related.map((r) => ({ note: r.note, reason: r.reason })),
      steps: values.steps,
      raw: [values.title, values.summary, ...keyPoints].filter(Boolean).join("\n") || values.title,
    });
  }

  const dragMeta = dragKey && PIECES.find((p) => p.key === dragKey);

  return (
    <div className="lego-builder">
      <p className="hint">Arrastra las piezas a la zona de construcción para montar tu casuística, sin pasar por la IA.</p>
      <div className="lego-palette">
        {PIECES.filter((p) => !placed.includes(p.key)).map((p) => (
          <div key={p.key} className="lego-piece" style={{ "--c": p.color }} onPointerDown={(e) => onPieceDown(p.key, e)}>
            {p.label}
          </div>
        ))}
        {placed.length === PIECES.length && <p className="hint">Todas las piezas están colocadas.</p>}
      </div>

      <div className={`lego-drop ${dragKey ? "active" : ""}`} ref={dropRef}>
        {placed.length === 0 && <p className="hint">Arrastra aquí las piezas (empieza por Título y App)</p>}
        {placed.map((key) => (
          <PieceBlock key={key} pieceKey={key} value={values[key]} scenarios={scenarios} notes={notes}
            onChange={(v) => setValues((s) => ({ ...s, [key]: v }))} onRemove={() => removePiece(key)} />
        ))}
      </div>

      {dragMeta && (
        <div ref={ghostRef} className="lego-ghost" style={{ "--c": dragMeta.color }}>{dragMeta.label}</div>
      )}

      <div className="actions">
        {onCancel && <button type="button" className="ghost" onClick={onCancel} disabled={busy}>Descartar</button>}
        <button type="button" onClick={submit} disabled={busy || !canSave}>{busy ? "Guardando…" : "Guardar en la red"}</button>
      </div>
    </div>
  );
}
