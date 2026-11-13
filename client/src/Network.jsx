import { useMemo, useRef, useState } from "react";

// Paleta neón (cyberpunk). Debe tener PALETTE_SIZE (8) colores, como en server/src/routes.js.
export const PALETTE = ["#00e5ff", "#ff2bd6", "#39ff88", "#ffb000", "#a855f7", "#ff4d9e", "#3b82f6", "#d7ff2a"];
// Color guardado en cada app (estable aunque se poden otras)
export const colorOf = (scenarios, id) => {
  const i = scenarios.findIndex((s) => s._id === id);
  return PALETTE[(scenarios[i]?.color ?? Math.max(i, 0)) % PALETTE.length];
};

const CX = 600, CY = 600;
const RADIUS = [0, 190, 340, 470]; // radio por profundidad: raíz, app, categoría/nota, nota
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const polar = (angle, r) => [CX + r * Math.cos(angle), CY + r * Math.sin(angle)];

// Árbol radial: raíz -> apps -> categoría (solo si una app tiene más de una) -> casuísticas.
// Las apps con una sola categoría saltan ese nivel: sus notas cuelgan directo de la app.
function buildTree(scenarios, notes) {
  const root = { id: "root", label: "Mi conocimiento", children: [] };
  scenarios.forEach((s) => {
    const own = notes.filter((n) => n.scenario?._id === s._id);
    if (!own.length) return;
    const color = colorOf(scenarios, s._id);
    const appNode = { id: s._id, label: s.name, color, children: [] };
    const byCat = new Map();
    own.forEach((n) => {
      const cat = n.category || "";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(n);
    });
    const singleCat = byCat.size <= 1;
    byCat.forEach((catNotes, cat) => {
      const parent = singleCat
        ? appNode
        : (() => {
            const catNode = { id: `${s._id}:${cat}`, label: cat || "General", color, children: [] };
            appNode.children.push(catNode);
            return catNode;
          })();
      catNotes.forEach((n) => parent.children.push({ id: n._id, label: n.title, note: n, color, children: [] }));
    });
    root.children.push(appNode);
  });
  return root;
}

function countLeaves(node) {
  return node.children.length ? node.children.reduce((s, c) => s + countLeaves(c), 0) : 1;
}

// Reparte a cada rama un sector angular proporcional a cuántas hojas tiene (árbol radial "tidy").
function layout(root) {
  const nodes = [];
  function assign(node, a0, a1, depth, parent) {
    node.depth = depth;
    node.parent = parent;
    node.angle = (a0 + a1) / 2;
    [node.x, node.y] = depth === 0 ? [CX, CY] : polar(node.angle, RADIUS[Math.min(depth, RADIUS.length - 1)]);
    nodes.push(node);
    if (!node.children.length) return;
    const total = countLeaves(node);
    let a = a0;
    for (const child of node.children) {
      const span = (a1 - a0) * (countLeaves(child) / total);
      assign(child, a, a + span, depth + 1, node);
      a += span;
    }
  }
  assign(root, -Math.PI / 2, (3 * Math.PI) / 2, 0, null);
  return nodes;
}

const BRANCH_WIDTH = [0, 5, 3, 1.4];
const ZOOM_MIN = 0.3, ZOOM_MAX = 5;

export default function Network({ scenarios, notes, highlight, selectedId, freshId, onSelect }) {
  const { nodes, leaves, links, box } = useMemo(() => {
    const nodes = layout(buildTree(scenarios, notes));
    const leaves = nodes.filter((n) => n.note);
    const byNoteId = new Map(leaves.map((n) => [n.note._id, n]));
    const links = [];
    const seen = new Set();
    notes.forEach((n) => {
      (n.relatedNotes ?? []).forEach((rel) => {
        const otherId = rel.note?._id ?? rel.note;
        if (!byNoteId.has(n._id) || !byNoteId.has(otherId)) return;
        const key = [n._id, otherId].sort().join("|");
        if (seen.has(key)) return;
        seen.add(key);
        links.push([byNoteId.get(n._id), byNoteId.get(otherId)]);
      });
    });
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
    const pad = 90;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    return { nodes, leaves, links, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
  }, [scenarios, notes]);

  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef(null);
  const { x: vx, y: vy, w: vw, h: vh } = box;

  function zoomAt(px, py, factor) {
    setCam((c) => {
      const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.k * factor));
      const dk = k / c.k;
      return { k, x: c.x * dk + px * (1 - dk), y: c.y * dk + py * (1 - dk) };
    });
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const px = vx + ((e.clientX - rect.left) / rect.width) * vw;
    const py = vy + ((e.clientY - rect.top) / rect.height) * vh;
    zoomAt(px, py, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }
  function zoomButton(factor) {
    zoomAt(vx + vw / 2, vy + vh / 2, factor);
  }
  function resetView() {
    setCam({ x: 0, y: 0, k: 1 });
  }
  function onPanDown(e) {
    panRef.current = { startX: e.clientX, startY: e.clientY, cam };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPanMove(e) {
    if (!panRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scaleX = vw / rect.width, scaleY = vh / rect.height;
    const { startX, startY, cam: base } = panRef.current;
    setCam({ ...base, x: base.x + (e.clientX - startX) * scaleX, y: base.y + (e.clientY - startY) * scaleY });
  }
  function onPanUp() {
    panRef.current = null;
  }

  const dim = highlight && highlight.size > 0;
  const n = leaves.length;
  const fontSize = n > 70 ? 8 : n > 35 ? 10 : 12;
  const labelLen = n > 70 ? 20 : 30;
  const showLeafLabels = n <= 140;
  const gridSize = 2000;

  return (
    <div className="network-wrap">
      <svg className="tree cp-canvas" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={`Red de conocimiento con ${nodes.filter((x) => x.depth === 1).length} apps y ${n} casuísticas`} onWheel={onWheel}>
        <defs>
          <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-strong" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="10" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id="cp-grid" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#00e5ff" strokeWidth="1" />
          </pattern>
        </defs>

        <rect className="pan-surface" x={vx} y={vy} width={vw} height={vh}
          onPointerDown={onPanDown} onPointerMove={onPanMove} onPointerUp={onPanUp} onPointerLeave={onPanUp} />

        {n === 0 && (
          <text x={CX} y={CY - 20} textAnchor="middle" className="empty-label">
            Cuéntale al chat lo que aprendiste y la red empezará a crecer
          </text>
        )}

        <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
          <rect className="cp-grid" x={CX - gridSize / 2} y={CY - gridSize / 2} width={gridSize} height={gridSize} fill="url(#cp-grid)" />

          {nodes.filter((nd) => nd.parent).map((nd) => {
            const on = !dim || (nd.note ? highlight.has(nd.note._id) : true);
            const [mx, my] = polar(nd.parent.angle, RADIUS[Math.min(nd.depth, RADIUS.length - 1)]);
            return (
              <path key={`branch-${nd.id}`} className={`branch ${on ? "" : "dimmed"}`} style={{ "--c": nd.color }}
                strokeWidth={BRANCH_WIDTH[Math.min(nd.depth, BRANCH_WIDTH.length - 1)]}
                d={`M ${nd.parent.x} ${nd.parent.y} Q ${mx} ${my} ${nd.x} ${nd.y}`} />
            );
          })}

          {links.map(([a, b], i) => {
            const on = !dim || highlight.has(a.note._id) || highlight.has(b.note._id);
            return <path key={`syn-${i}`} className={`synapse ${on ? "" : "dimmed"}`}
              d={`M ${a.x} ${a.y} C ${(a.x + CX) / 2} ${(a.y + CY) / 2}, ${(b.x + CX) / 2} ${(b.y + CY) / 2}, ${b.x} ${b.y}`} />;
          })}

          {nodes.map((nd) => {
            if (nd.depth === 0) {
              return (
                <g key="root" className="cp-node cp-root" transform={`translate(${nd.x} ${nd.y})`}>
                  <circle r="30" className="cp-root-halo" filter="url(#glow-strong)" />
                  <circle r="16" className="cp-root-core" filter="url(#glow)" />
                </g>
              );
            }
            if (nd.note) return null; // las hojas se dibujan aparte, con su estado seleccionado/resaltado
            const lit = !dim || countLeafHighlight(nd, highlight);
            const label = nd.depth === 1 ? nd.label.toUpperCase() : nd.label;
            const away = Math.cos(nd.angle) < -0.15 ? "end" : Math.cos(nd.angle) > 0.15 ? "start" : "middle";
            const lx = Math.cos(nd.angle) * (nd.depth === 1 ? 24 : 16), ly = Math.sin(nd.angle) * (nd.depth === 1 ? 24 : 16);
            return (
              <g key={nd.id} className={`cp-node cp-depth-${nd.depth} ${lit ? "" : "dimmed"}`} style={{ "--c": nd.color }} transform={`translate(${nd.x} ${nd.y})`}>
                <circle r={nd.depth === 1 ? 17 : 9} className="cp-halo" filter="url(#glow-strong)" />
                <circle r={nd.depth === 1 ? 9 : 5} className="cp-core" filter="url(#glow)" />
                {(nd.depth === 1 || showLeafLabels) && (
                  <text x={lx} y={ly} dy="0.32em" textAnchor={away} className="cp-label">{short(label, nd.depth === 1 ? 26 : 22)}</text>
                )}
              </g>
            );
          })}

          {leaves.map((nd) => {
            const on = !dim || highlight.has(nd.note._id);
            const cls = ["leaf", on ? "" : "dimmed", dim && on ? "hit" : "", nd.note._id === selectedId ? "selected" : "", nd.note._id === freshId ? "fresh" : ""].join(" ");
            const away = Math.cos(nd.angle) < -0.1 ? "end" : Math.cos(nd.angle) > 0.1 ? "start" : "middle";
            const lx = Math.cos(nd.angle) * 12, ly = Math.sin(nd.angle) * 12;
            return (
              <g key={nd.id} className={cls} style={{ "--c": nd.color, transform: `translate(${nd.x}px, ${nd.y}px)` }}
                role="button" tabIndex={0} aria-label={`${nd.note.title} (${nd.color})`}
                onClick={() => onSelect(nd.note)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(nd.note))}>
                <title>{nd.note.title}</title>
                <circle r="9" className="halo" />
                <circle r="3.6" className="dot" filter="url(#glow)" />
                {(showLeafLabels || (dim && on)) && (
                  <text x={lx} y={ly} dy="0.32em" textAnchor={away} fontSize={fontSize}>{short(nd.note.title, labelLen)}</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="zoom-controls">
        <button type="button" onClick={() => zoomButton(1.25)} aria-label="Acercar">+</button>
        <button type="button" onClick={() => zoomButton(1 / 1.25)} aria-label="Alejar">−</button>
        <button type="button" onClick={resetView} aria-label="Restablecer zoom">⟲</button>
      </div>
    </div>
  );
}

function countLeafHighlight(node, highlight) {
  if (node.note) return highlight.has(node.note._id);
  return node.children.some((c) => countLeafHighlight(c, highlight));
}
