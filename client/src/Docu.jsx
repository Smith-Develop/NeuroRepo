// Mascota de la app: un "blob" con cara, pensado para una hoja/documento con personalidad.
// SVG + CSS puro (sin librerías de animación), respeta prefers-reduced-motion vía index.css.
export default function Docu({ size = 96, animated = true, mode = "idle" }) {
  const searching = mode === "loading";
  const cls = ["docu", animated && "docu-animated", searching && "docu-searching"].filter(Boolean).join(" ");
  return (
    <div className={cls} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100" className="docu-svg">
        <defs>
          <linearGradient id="docuBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e6c8ff" />
            <stop offset="55%" stopColor="#9b4dde" />
            <stop offset="100%" stopColor="#4a1b8a" />
          </linearGradient>
          <radialGradient id="docuGlow" cx="50%" cy="38%" r="55%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle className="docu-ring" cx="50" cy="52" r="46" fill="none" stroke="url(#docuBody)" strokeWidth="2" opacity="0.3" />
        <g className="docu-blob">
          <path d="M50 9c19 0 35 10 39 28 3 16-4 33-21 41-18 8-39 6-49-8C9 56 7 37 17 23 25 12 38 9 50 9Z" fill="url(#docuBody)" />
          <ellipse cx="48" cy="40" rx="34" ry="22" fill="url(#docuGlow)" />
        </g>
        <g className="docu-face">
          <ellipse className="docu-eye left" cx="38" cy="50" rx="4.2" ry="5.4" fill="#0b0d14" />
          <ellipse className="docu-eye right" cx="62" cy="50" rx="4.2" ry="5.4" fill="#0b0d14" />
          <path d="M39 63c4 4 17 4 21 0" stroke="#0b0d14" strokeWidth="3" strokeLinecap="round" fill="none" />
        </g>
      </svg>
      {searching && (
        <svg className="docu-magnifier" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <circle cx="10" cy="10" r="6.2" /><path d="M19 19l-4.8-4.8" />
        </svg>
      )}
    </div>
  );
}
