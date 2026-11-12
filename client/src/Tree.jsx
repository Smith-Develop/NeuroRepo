import { useMemo } from "react";

export const PALETTE = ["#7aa2ff", "#c084fc", "#5eead4", "#facc15", "#f472b6", "#4ade80", "#fb923c", "#38bdf8"];
// Color guardado en cada rama (estable aunque se poden otras)
export const colorOf = (scenarios, id) => {
  const i = scenarios.findIndex((s) => s._id === id);
  return PALETTE[(scenarios[i]?.color ?? Math.max(i, 0)) % PALETTE.length];
};

const CX = 500, CY = 600, R1 = 200, R2 = 360, ROOT_Y = 990, GAP = 1.6;
const rad = (a) => (a * Math.PI) / 180;
const at = (a, r) => [CX + r * Math.cos(rad(a)), CY + r * Math.sin(rad(a))];
const pt = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Dendrograma radial: raíz abajo, ramas = escenarios, hojas = notas en un arco superior
function layout(scenarios, notes) {
  const groups = scenarios
    .map((s) => ({ ...s, color: colorOf(scenarios, s._id), notes: notes.filter((n) => n.scenario?._id === s._id) }))
    .filter((g) => g.notes.length);
  const leaves = groups.reduce((a, g) => a + g.notes.length, 0);
  const slots = leaves + GAP * Math.max(0, groups.length - 1);
  const span = Math.min(176, Math.max(50, slots * 10));
  const step = slots > 1 ? span / (slots - 1) : 0;
  let pos = 0;
  for (const g of groups) {
    g.leaves = g.notes.map((n) => ({ note: n, angle: -90 - span / 2 + step * pos++ }));
    pos += GAP - 1; // hueco entre ramas
    g.angle = g.leaves.reduce((a, l) => a + l.angle, 0) / g.leaves.length;
  }
  return { groups, leaves };
}

export default function Tree({ scenarios, notes, highlight, selectedId, freshId, onSelect }) {
  const { groups, leaves } = useMemo(() => layout(scenarios, notes), [scenarios, notes]);
  const dim = highlight && highlight.size > 0;
  const fontSize = leaves > 70 ? 8 : leaves > 35 ? 10 : 12;
  const labelLen = leaves > 70 ? 22 : 30;
  const showLabels = leaves <= 140;

  return (
    <svg className="tree" viewBox="-100 0 1200 1010" preserveAspectRatio="xMidYMid meet" role="img" aria-label={`Árbol de conocimiento con ${groups.length} ramas y ${leaves} notas`}>
      <defs>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="trunk" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#7aa2ff" stopOpacity=".15" />
          <stop offset="1" stopColor="#dbe4ff" />
        </linearGradient>
      </defs>

      {/* Tronco: varias hebras finas como en un árbol de luz */}
      <g filter="url(#glow)">
        {[-3, -1.5, 0, 1.5, 3].map((k) => (
          <path key={k} className="grow" pathLength="1" fill="none" stroke="url(#trunk)" strokeWidth={k === 0 ? 2.4 : 1}
            d={`M ${CX + k * 7} ${ROOT_Y} C ${CX + k * 4} 880, ${CX + k * 2} 700, ${CX} ${CY}`} />
        ))}
      </g>
      <text x={CX} y={ROOT_Y + 2} className="root-label" textAnchor="middle">MI CONOCIMIENTO</text>

      {groups.length === 0 && (
        <text x={CX} y={CY - 60} textAnchor="middle" className="empty-label">
          Cuéntale al chat lo que aprendiste y el árbol empezará a crecer
        </text>
      )}

      {groups.map((g) => {
        const B = at(g.angle, R1);
        const lit = !dim || g.notes.some((n) => highlight.has(n._id));
        const mid = (R1 + R2) / 2;
        return (
          <g key={g._id} className={`branch ${lit ? "" : "dimmed"}`} style={{ "--c": g.color }}>
            <path className="grow link" pathLength="1" filter="url(#glow)" strokeWidth="2.2"
              d={`M ${CX} ${CY} C ${CX} ${CY - R1 * 0.45}, ${pt(at(g.angle, R1 * 0.5))}, ${pt(B)}`} />
            {g.leaves.map(({ note, angle }) => {
              const on = !dim || highlight.has(note._id);
              return (
                <path key={note._id} className={`grow grow-late link ${on ? "" : "dimmed"}`} pathLength="1" strokeWidth="1.1"
                  d={`M ${pt(B)} C ${pt(at(g.angle, mid))}, ${pt(at(angle, mid))}, ${pt(at(angle, R2))}`} />
              );
            })}
            <text className="branch-label" transform={`translate(${pt(at(g.angle, R1 + 22))})`} textAnchor="middle">
              {short(g.name.toUpperCase(), 26)}
            </text>
          </g>
        );
      })}

      {groups.map((g) =>
        g.leaves.map(({ note, angle }) => {
          const [x, y] = at(angle, R2);
          const left = angle < -90;
          const on = !dim || highlight.has(note._id);
          const cls = ["leaf", on ? "" : "dimmed", dim && on ? "hit" : "", note._id === selectedId ? "selected" : "", note._id === freshId ? "fresh" : ""].join(" ");
          return (
            <g key={note._id} className={cls} style={{ "--c": g.color, transform: `translate(${x}px, ${y}px)` }}
              role="button" tabIndex={0} aria-label={`${note.title} (${g.name})`}
              onClick={() => onSelect(note)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(note))}>
              <title>{note.title}</title>
              <circle r="9" className="halo" />
              <circle r="3.6" className="dot" filter="url(#glow)" />
              {(showLabels || (dim && on)) && (
                <text transform={`rotate(${left ? angle + 180 : angle})`} x={left ? -10 : 10} dy="0.32em"
                  textAnchor={left ? "end" : "start"} fontSize={fontSize}>
                  {short(note.title, labelLen)}
                </text>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}
