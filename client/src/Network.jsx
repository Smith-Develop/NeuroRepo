import { useMemo, useRef, useState } from "react";

export const PALETTE = ["#7aa2ff", "#c084fc", "#5eead4", "#facc15", "#f472b6", "#4ade80", "#fb923c", "#38bdf8"];
// Color guardado en cada app (estable aunque se poden otras)
export const colorOf = (scenarios, id) => {
  const i = scenarios.findIndex((s) => s._id === id);
  return PALETTE[(scenarios[i]?.color ?? Math.max(i, 0)) % PALETTE.length];
};

const CX = 500, CY = 500;
const HUB_BASE = 140, HUB_STEP = 70; // radio del anillo de apps según cuántas haya
const SAT_DIST = 70; // distancia ideal entre una casuística y su app
const LINK_DIST = 130; // distancia ideal entre dos casuísticas enlazadas (misma app o distinta)
const ITER = 160;
const short = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// hash estable de un ObjectId -> [0,1), para repartir el ángulo inicial sin azar
function seed(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

// Simulación de fuerzas minimalista (sin librería): repulsión entre casuísticas,
// resorte hacia su app y resorte en cada enlace cruzado. Las apps quedan fijas.
function simulate(sats, links) {
  const n = sats.length;
  if (!n) return sats;
  for (let it = 0; it < ITER; it++) {
    const fx = new Float64Array(n), fy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = sats[i].x - sats[j].x, dy = sats[i].y - sats[j].y;
        const d2 = dx * dx + dy * dy || 0.001;
        if (d2 > 220 * 220) continue; // alcance corto: no hace falta repeler lo ya lejano
        const d = Math.sqrt(d2), f = 900 / d2, ux = dx / d, uy = dy / d;
        fx[i] += ux * f; fy[i] += uy * f;
        fx[j] -= ux * f; fy[j] -= uy * f;
      }
      const s = sats[i], hx = s.hub.x - s.x, hy = s.hub.y - s.y;
      const hd = Math.sqrt(hx * hx + hy * hy) || 0.001;
      const hf = (hd - SAT_DIST) * 0.06;
      fx[i] += (hx / hd) * hf; fy[i] += (hy / hd) * hf;
    }
    for (const [a, b] of links) {
      const sa = sats[a], sb = sats[b];
      const dx = sb.x - sa.x, dy = sb.y - sa.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001;
      const f = (d - LINK_DIST) * 0.03, ux = dx / d, uy = dy / d;
      fx[a] += ux * f; fy[a] += uy * f;
      fx[b] -= ux * f; fy[b] -= uy * f;
    }
    for (let i = 0; i < n; i++) {
      sats[i].vx = (sats[i].vx + fx[i]) * 0.82;
      sats[i].vy = (sats[i].vy + fy[i]) * 0.82;
      sats[i].x += sats[i].vx; sats[i].y += sats[i].vy;
    }
  }
  return sats;
}

// Red: cada app es una neurona central; sus casuísticas son neuronas satélite a su alrededor;
// los enlaces entre casuísticas (de la misma app o de apps distintas) son sinapsis cruzadas.
function layout(scenarios, notes) {
  const hubs = scenarios
    .map((s) => ({ ...s, color: colorOf(scenarios, s._id), notes: notes.filter((n) => n.scenario?._id === s._id) }))
    .filter((h) => h.notes.length);

  const hubR = hubs.length <= 1 ? 0 : HUB_BASE + HUB_STEP * Math.sqrt(hubs.length);
  hubs.forEach((h, i) => {
    const a = (i / hubs.length) * Math.PI * 2 - Math.PI / 2;
    h.x = CX + hubR * Math.cos(a);
    h.y = CY + hubR * Math.sin(a);
  });

  const index = new Map();
  const sats = [];
  hubs.forEach((h) => {
    h.notes.forEach((note, i) => {
      const a = (i / h.notes.length) * Math.PI * 2 + seed(note._id) * Math.PI * 2;
      index.set(note._id, sats.length);
      sats.push({ id: note._id, note, hub: h, x: h.x + Math.cos(a) * SAT_DIST, y: h.y + Math.sin(a) * SAT_DIST, vx: 0, vy: 0 });
    });
  });

  const links = [];
  const seenLink = new Set();
  notes.forEach((n) => {
    (n.relatedNotes ?? []).forEach((rel) => {
      const otherId = rel.note?._id ?? rel.note;
      if (!index.has(n._id) || !index.has(otherId)) return;
      const key = [n._id, otherId].sort().join("|");
      if (seenLink.has(key)) return;
      seenLink.add(key);
      links.push([index.get(n._id), index.get(otherId)]);
    });
  });

  simulate(sats, links);
  // etiqueta de cada app en el lado contrario a donde quedaron sus casuísticas
  hubs.forEach((h) => {
    const own = sats.filter((s) => s.hub === h);
    const sum = own.reduce((a, s) => [a[0] + (s.x - h.x), a[1] + (s.y - h.y)], [0, 0]);
    h.labelAngle = own.length ? Math.atan2(sum[1], sum[0]) + Math.PI : -Math.PI / 2;
  });
  return { hubs, sats, links };
}

const ZOOM_MIN = 0.4, ZOOM_MAX = 4;

export default function Network({ scenarios, notes, highlight, selectedId, freshId, onSelect }) {
  const { hubs, sats, links, vx, vy, vw, vh } = useMemo(() => {
    const { hubs, sats, links } = layout(scenarios, notes);
    const xs = [CX, ...hubs.map((h) => h.x), ...sats.map((s) => s.x)];
    const ys = [CY, ...hubs.map((h) => h.y), ...sats.map((s) => s.y)];
    const pad = 90;
    const minX = Math.min(...xs) - pad, maxX = Math.max(...xs) + pad;
    const minY = Math.min(...ys) - pad, maxY = Math.max(...ys) + pad;
    return { hubs, sats, links, vx: minX, vy: minY, vw: maxX - minX, vh: maxY - minY };
  }, [scenarios, notes]);

  const [cam, setCam] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef(null);

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
  const n = sats.length;
  const fontSize = n > 70 ? 8 : n > 35 ? 10 : 12;
  const labelLen = n > 70 ? 22 : 30;
  const showLabels = n <= 140;

  return (
    <div className="network-wrap">
    <svg className="tree" viewBox={`${vx} ${vy} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet" role="img"
      aria-label={`Red de conocimiento con ${hubs.length} apps y ${n} casuísticas`} onWheel={onWheel}>
      <defs>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="glow-strong" x="-120%" y="-120%" width="340%" height="340%">
          <feGaussianBlur stdDeviation="9" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <rect className="pan-surface" x={vx} y={vy} width={vw} height={vh}
        onPointerDown={onPanDown} onPointerMove={onPanMove} onPointerUp={onPanUp} onPointerLeave={onPanUp} />

      {hubs.length === 0 && (
        <text x={CX} y={CY - 20} textAnchor="middle" className="empty-label">
          Cuéntale al chat lo que aprendiste y la red empezará a crecer
        </text>
      )}

      <g transform={`translate(${cam.x} ${cam.y}) scale(${cam.k})`}>
      {links.map(([a, b], i) => {
        const sa = sats[a], sb = sats[b];
        const on = !dim || highlight.has(sa.note._id) || highlight.has(sb.note._id);
        return <line key={i} className={`synapse ${on ? "" : "dimmed"}`} x1={sa.x} y1={sa.y} x2={sb.x} y2={sb.y} />;
      })}

      {sats.map((s) => {
        const on = !dim || highlight.has(s.note._id);
        return (
          <line key={`d-${s.id}`} className={`dendrite ${on ? "" : "dimmed"}`} style={{ "--c": s.hub.color }}
            x1={s.hub.x} y1={s.hub.y} x2={s.x} y2={s.y} />
        );
      })}

      {hubs.map((h) => {
        const lit = !dim || h.notes.some((n) => highlight.has(n._id));
        const lx = Math.cos(h.labelAngle) * 46, ly = Math.sin(h.labelAngle) * 46;
        const anchor = lx < -8 ? "end" : lx > 8 ? "start" : "middle";
        return (
          <g key={h._id} className={`hub ${lit ? "" : "dimmed"}`} style={{ "--c": h.color }} transform={`translate(${h.x} ${h.y})`}>
            <circle r="30" className="hub-halo" filter="url(#glow-strong)" />
            <circle r="11" className="hub-core" filter="url(#glow)" />
            <text x={lx} y={ly} dy="0.32em" textAnchor={anchor} className="hub-label">{short(h.name.toUpperCase(), 26)}</text>
          </g>
        );
      })}

      {sats.map((s) => {
        const on = !dim || highlight.has(s.note._id);
        const cls = ["leaf", on ? "" : "dimmed", dim && on ? "hit" : "", s.note._id === selectedId ? "selected" : "", s.note._id === freshId ? "fresh" : ""].join(" ");
        return (
          <g key={s.id} className={cls} style={{ "--c": s.hub.color, transform: `translate(${s.x}px, ${s.y}px)` }}
            role="button" tabIndex={0} aria-label={`${s.note.title} (${s.hub.name})`}
            onClick={() => onSelect(s.note)} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(s.note))}>
            <title>{s.note.title}</title>
            <circle r="9" className="halo" />
            <circle r="3.6" className="dot" filter="url(#glow)" />
            {(showLabels || (dim && on)) && (
              <text x="10" dy="0.32em" fontSize={fontSize}>{short(s.note.title, labelLen)}</text>
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
