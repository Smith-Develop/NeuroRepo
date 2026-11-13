import { useEffect, useRef, useState } from "react";
import { ROW_H, BOX_W, BOX_H, CX, SIDE_L, SIDE_R, TOP, yOf, targetsOf, shapePoints } from "./flowchartLayout";

const TYPES = [
  { key: "inicio", label: "Inicio" },
  { key: "paso", label: "Paso" },
  { key: "decision", label: "Decisión" },
  { key: "fin", label: "Fin" },
];

// Remapea yesTarget/noTarget cuando los pasos cambian de posición (insertar/quitar/reordenar).
// remap(oldIndex) -> newIndex | undefined (undefined = se quita la referencia, p. ej. si el paso desapareció)
function remapTargets(steps, remap) {
  return steps.map((s) => ({
    ...s,
    yesTarget: s.yesTarget != null ? remap(s.yesTarget) : undefined,
    noTarget: s.noTarget != null ? remap(s.noTarget) : undefined,
  }));
}

function insertStep(steps, at, type) {
  const shifted = remapTargets(steps, (t) => (t >= at ? t + 1 : t));
  return [...shifted.slice(0, at), { type, text: "" }, ...shifted.slice(at)];
}

function removeStep(steps, index) {
  const remap = (t) => (t === index ? undefined : t > index ? t - 1 : t);
  return remapTargets(steps.filter((_, i) => i !== index), remap);
}

function moveStep(steps, from, to) {
  const order = steps.map((_, i) => i);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const oldToNew = new Map(order.map((oldIdx, newIdx) => [oldIdx, newIdx]));
  return order.map((oldIdx) => {
    const s = steps[oldIdx];
    return {
      ...s,
      yesTarget: s.yesTarget != null ? oldToNew.get(s.yesTarget) : undefined,
      noTarget: s.noTarget != null ? oldToNew.get(s.noTarget) : undefined,
    };
  });
}

// Constructor visual del procedimiento: arrastra piezas de la paleta para añadir pasos,
// arrastra una caja para reordenarla, y arrastra desde un conector Sí/No hasta otra caja para enlazarlas.
export default function FlowchartEditor({ value, onChange }) {
  const steps = value;
  const [drag, setDrag] = useState(null);
  const svgRef = useRef(null);
  const ghostRef = useRef(null);

  function toSvg(clientX, clientY) {
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    return { x: vb.x + ((clientX - rect.left) / rect.width) * vb.width, y: vb.y + ((clientY - rect.top) / rect.height) * vb.height };
  }
  const slotAt = (y) => Math.max(0, Math.min(steps.length, Math.round((y - TOP) / ROW_H)));
  const boxAt = (x, y) => {
    if (x < CX - BOX_W / 2 - 20 || x > CX + BOX_W / 2 + 20) return null;
    const i = Math.round((y - TOP) / ROW_H);
    return i >= 0 && i < steps.length && Math.abs(y - (yOf(i) + BOX_H / 2)) < BOX_H ? i : null;
  };

  function startAdd(type, e) {
    e.preventDefault();
    setDrag({ kind: "add", type, cx: e.clientX, cy: e.clientY });
  }
  function startReorder(index, e) {
    e.preventDefault();
    e.stopPropagation();
    const p = toSvg(e.clientX, e.clientY);
    setDrag({ kind: "reorder", index, x: p.x, y: p.y });
  }
  function startConnect(from, branch, e) {
    e.preventDefault();
    e.stopPropagation();
    const p = toSvg(e.clientX, e.clientY);
    setDrag({ kind: "connect", from, branch, x: p.x, y: p.y });
  }

  useEffect(() => {
    if (!drag) return;
    function move(e) {
      if (drag.kind === "add") {
        if (ghostRef.current) ghostRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        return;
      }
      const p = toSvg(e.clientX, e.clientY);
      setDrag((d) => ({ ...d, x: p.x, y: p.y }));
    }
    function up(e) {
      const p = toSvg(e.clientX, e.clientY);
      if (drag.kind === "add") {
        onChange(insertStep(steps, slotAt(p.y), drag.type));
      } else if (drag.kind === "reorder") {
        const to = Math.max(0, Math.min(steps.length - 1, Math.round((p.y - TOP) / ROW_H)));
        if (to !== drag.index) onChange(moveStep(steps, drag.index, to));
      } else if (drag.kind === "connect") {
        const target = boxAt(p.x, p.y);
        if (target != null && target !== drag.from) {
          onChange(steps.map((s, i) => (i === drag.from ? { ...s, [drag.branch === "yes" ? "yesTarget" : "noTarget"]: target } : s)));
        }
      }
      setDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, steps]);

  function setText(i, t) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, text: t } : s)));
  }
  function setType(i, type) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, type, ...(type !== "decision" ? { yesTarget: undefined, noTarget: undefined } : {}) } : s)));
  }
  function clearBranch(i, branch) {
    onChange(steps.map((s, idx) => (idx === i ? { ...s, [branch === "yes" ? "yesTarget" : "noTarget"]: undefined } : s)));
  }

  const n = steps.length;
  const width = SIDE_R - SIDE_L + 60;
  const height = Math.max(ROW_H, yOf(Math.max(n - 1, 0)) + BOX_H + 50);
  const reorderIndex = drag?.kind === "reorder" ? drag.index : null;

  return (
    <div className="fc-editor">
      <p className="hint">Arrastra una pieza al lienzo para añadir un paso. En las decisiones, arrastra desde «Sí»/«No» hasta la caja de destino.</p>
      <div className="fc-palette">
        {TYPES.map((t) => (
          <div key={t.key} className={`fc-chip fc-chip-${t.key}`} onPointerDown={(e) => startAdd(t.key, e)}>{t.label}</div>
        ))}
      </div>

      <svg ref={svgRef} className="flowchart fc-canvas" viewBox={`${SIDE_L - 30} 0 ${width} ${height}`} role="img" aria-label="Editor del procedimiento">
        <defs>
          <marker id="fce-arrow-yes" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#4ade80" />
          </marker>
          <marker id="fce-arrow-no" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="#facc15" />
          </marker>
        </defs>

        {n === 0 && <text x={CX} y={TOP + 30} textAnchor="middle" className="empty-label" style={{ fontSize: 14 }}>Arrastra aquí la primera pieza</text>}

        {steps.map((s, i) => {
          if (s.type !== "decision") return null;
          const { yes, no } = targetsOf(steps, i);
          const y1 = yOf(i) + BOX_H / 2;
          return (
            <g key={`arrows-${i}`}>
              {yes != null && (
                <path className="fc-line fc-yes" markerEnd="url(#fce-arrow-yes)"
                  d={`M ${CX - BOX_W / 2} ${y1} C ${SIDE_L} ${y1}, ${SIDE_L} ${yOf(yes) + BOX_H / 2}, ${CX - BOX_W / 2} ${yOf(yes) + BOX_H / 2}`} />
              )}
              {no != null && (
                <path className="fc-line fc-no" markerEnd="url(#fce-arrow-no)"
                  d={`M ${CX + BOX_W / 2} ${y1} C ${SIDE_R} ${y1}, ${SIDE_R} ${yOf(no) + BOX_H / 2}, ${CX + BOX_W / 2} ${yOf(no) + BOX_H / 2}`} />
              )}
            </g>
          );
        })}
        {steps.map((s, i) => {
          if (s.type === "decision") return null;
          const { next } = targetsOf(steps, i);
          return next != null ? <line key={`l-${i}`} className="fc-line" x1={CX} y1={yOf(i) + BOX_H} x2={CX} y2={yOf(next)} markerEnd="url(#fce-arrow-yes)" /> : null;
        })}

        {drag?.kind === "connect" && (
          <line className={`fc-line fc-temp ${drag.branch === "yes" ? "fc-yes" : "fc-no"}`}
            x1={drag.branch === "yes" ? CX - BOX_W / 2 : CX + BOX_W / 2} y1={yOf(drag.from) + BOX_H / 2} x2={drag.x} y2={drag.y} />
        )}

        {steps.map((s, i) => (
          <g key={i} className={`fc-step fc-${s.type}`}
            transform={`translate(${CX - BOX_W / 2} ${i === reorderIndex ? drag.y - BOX_H / 2 : yOf(i)})`}
            style={i === reorderIndex ? { opacity: 0.85 } : undefined}>
            <g onPointerDown={(e) => startReorder(i, e)} style={{ cursor: "grab" }}>
              {s.type === "decision" ? <polygon points={shapePoints(s.type)} /> : <rect width={BOX_W} height={BOX_H} rx={s.type === "paso" ? 8 : BOX_H / 2} />}
            </g>
            <foreignObject width={BOX_W} height={BOX_H}>
              <div className="fc-text-wrap" xmlns="http://www.w3.org/1999/xhtml">
                <select value={s.type} onChange={(e) => setType(i, e.target.value)} onPointerDown={(e) => e.stopPropagation()}>
                  {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <input value={s.text} onChange={(e) => setText(i, e.target.value)} onPointerDown={(e) => e.stopPropagation()}
                  placeholder="Texto del paso" maxLength={300} />
              </div>
            </foreignObject>
            <circle className="fc-del" cx={BOX_W + 12} cy={0} r="9" onPointerDown={(e) => e.stopPropagation()} onClick={() => onChange(removeStep(steps, i))} />
            <text x={BOX_W + 12} y={3} textAnchor="middle" className="fc-del-x" onPointerDown={(e) => e.stopPropagation()} onClick={() => onChange(removeStep(steps, i))}>×</text>
            {s.type === "decision" && (
              <>
                <circle className="fc-handle yes" cx={0} cy={BOX_H / 2} r="8" onPointerDown={(e) => startConnect(i, "yes", e)} />
                <text x={-16} y={BOX_H / 2 + 4} textAnchor="end" className="fc-handle-label yes">Sí</text>
                <circle className="fc-handle no" cx={BOX_W} cy={BOX_H / 2} r="8" onPointerDown={(e) => startConnect(i, "no", e)} />
                <text x={BOX_W + 16} y={BOX_H / 2 + 4} textAnchor="start" className="fc-handle-label no">No</text>
                {s.yesTarget != null && <circle className="fc-handle-clear" cx={0} cy={BOX_H / 2} r="3" onClick={() => clearBranch(i, "yes")} />}
                {s.noTarget != null && <circle className="fc-handle-clear" cx={BOX_W} cy={BOX_H / 2} r="3" onClick={() => clearBranch(i, "no")} />}
              </>
            )}
          </g>
        ))}
      </svg>

      {drag?.kind === "add" && <div ref={ghostRef} className="fc-ghost">{TYPES.find((t) => t.key === drag.type)?.label}</div>}
    </div>
  );
}
