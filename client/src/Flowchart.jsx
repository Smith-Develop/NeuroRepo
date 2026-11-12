const ROW_H = 100;
const BOX_W = 220;
const BOX_H = 56;
const CX = 150;
const SIDE_X = CX + BOX_W / 2 + 60;

// Diagrama de flujo de solo lectura: pasos en columna, decisiones con una rama "No" lateral
// (hacia adelante o hacia atrás) que vuelve a unirse al paso que le indiques.
export default function Flowchart({ steps }) {
  if (!steps?.length) return null;
  const n = steps.length;
  const y = (i) => 30 + i * ROW_H;
  const width = SIDE_X + 50;
  const height = y(n - 1) + BOX_H + 30;

  return (
    <svg className="flowchart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Procedimiento paso a paso">
      <defs>
        <marker id="fc-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--line)" />
        </marker>
        <marker id="fc-arrow-no" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#facc15" />
        </marker>
      </defs>

      {steps.slice(0, -1).map((s, i) => (
        <line key={`l-${i}`} className="fc-line" x1={CX} y1={y(i) + BOX_H} x2={CX} y2={y(i + 1)} markerEnd="url(#fc-arrow)" />
      ))}
      {steps.map((s, i) => (s.type === "decision" && i < n - 1 ? (
        <text key={`si-${i}`} x={CX + 8} y={(y(i) + BOX_H + y(i + 1)) / 2} className="fc-branch-label">Sí</text>
      ) : null))}

      {steps.map((s, i) => {
        if (s.type !== "decision" || s.noTarget == null) return null;
        const y1 = y(i) + BOX_H / 2, y2 = y(s.noTarget) + BOX_H / 2;
        const x = CX + BOX_W / 2;
        return (
          <g key={`no-${i}`}>
            <path className="fc-line fc-no" d={`M ${x} ${y1} C ${SIDE_X} ${y1}, ${SIDE_X} ${y2}, ${x} ${y2}`} markerEnd="url(#fc-arrow-no)" />
            <text x={SIDE_X + 6} y={(y1 + y2) / 2} className="fc-branch-label no">No</text>
          </g>
        );
      })}

      {steps.map((s, i) => (
        <g key={i} className={`fc-step fc-${s.type}`} transform={`translate(${CX - BOX_W / 2} ${y(i)})`}>
          {s.type === "decision" ? (
            <polygon points={`${BOX_W / 2},0 ${BOX_W},${BOX_H / 2} ${BOX_W / 2},${BOX_H} 0,${BOX_H / 2}`} />
          ) : (
            <rect width={BOX_W} height={BOX_H} rx={s.type === "paso" ? 8 : BOX_H / 2} />
          )}
          <foreignObject width={BOX_W} height={BOX_H}>
            <div className="fc-text" xmlns="http://www.w3.org/1999/xhtml">{s.text}</div>
          </foreignObject>
        </g>
      ))}
    </svg>
  );
}
