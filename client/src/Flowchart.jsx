import { BOX_W, BOX_H, CX, SIDE_L, SIDE_R, yOf, targetsOf, shapePoints } from "./flowchartLayout";

function BranchArrow({ steps, from, to, side, label }) {
  if (to == null) return null;
  const y1 = yOf(from) + BOX_H / 2;
  const y2 = yOf(to) + BOX_H / 2;
  const x = side === "left" ? CX - BOX_W / 2 : CX + BOX_W / 2;
  const bump = side === "left" ? SIDE_L : SIDE_R;
  const marker = side === "left" ? "fc-arrow-yes" : "fc-arrow-no";
  return (
    <g>
      <path className={`fc-line ${side === "left" ? "fc-yes" : "fc-no"}`}
        d={`M ${x} ${y1} C ${bump} ${y1}, ${bump} ${y2}, ${x} ${y2}`} markerEnd={`url(#${marker})`} />
      <text x={bump + (side === "left" ? -6 : 6)} y={(y1 + y2) / 2} textAnchor={side === "left" ? "end" : "start"}
        className={`fc-branch-label ${side === "left" ? "yes" : "no"}`}>{label}</text>
    </g>
  );
}

// Diagrama de flujo de solo lectura: pasos en columna, las decisiones siempre muestran sus dos ramas
// (Sí a la izquierda, No a la derecha), que pueden avanzar, saltarse pasos o volver atrás (bucles).
export default function Flowchart({ steps }) {
  if (!steps?.length) return null;
  const n = steps.length;
  const width = SIDE_R - SIDE_L + 60;
  const height = yOf(n - 1) + BOX_H + 30;

  return (
    <svg className="flowchart" viewBox={`${SIDE_L - 30} 0 ${width} ${height}`} role="img" aria-label="Procedimiento paso a paso">
      <defs>
        <marker id="fc-arrow-yes" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#4ade80" />
        </marker>
        <marker id="fc-arrow-no" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="#facc15" />
        </marker>
      </defs>

      {steps.map((s, i) => {
        if (s.type === "decision") {
          const { yes, no } = targetsOf(steps, i);
          return (
            <g key={`arrows-${i}`}>
              <BranchArrow steps={steps} from={i} to={yes} side="left" label="Sí" />
              <BranchArrow steps={steps} from={i} to={no} side="right" label="No" />
            </g>
          );
        }
        const { next } = targetsOf(steps, i);
        return next != null ? (
          <line key={`l-${i}`} className="fc-line" x1={CX} y1={yOf(i) + BOX_H} x2={CX} y2={yOf(next)} markerEnd="url(#fc-arrow-yes)" />
        ) : null;
      })}

      {steps.map((s, i) => (
        <g key={i} className={`fc-step fc-${s.type}`} transform={`translate(${CX - BOX_W / 2} ${yOf(i)})`}>
          {s.type === "decision" ? (
            <polygon points={shapePoints(s.type)} />
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
