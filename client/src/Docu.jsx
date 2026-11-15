// Mascota de la app: un "blob" con cara. SVG + CSS puro (sin librerías de animación), con las
// mismas clases que el prototipo (.docu, .anim, .blob, .eye, .searching, .lens) para reutilizar
// tal cual sus animaciones (float/breathe/blink/bob/look/lens) definidas en index.css.
export default function Docu({ size = 96, animated = true, mode = "idle" }) {
  const searching = mode === "loading";
  const cls = ["docu", animated && "anim", searching && "searching"].filter(Boolean).join(" ");
  return (
    <span className={cls} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <defs>
          <linearGradient id="docuBody" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ead4ff" />
            <stop offset="55%" stopColor="#9b4dde" />
            <stop offset="100%" stopColor="#4a1b8a" />
          </linearGradient>
          <radialGradient id="docuGlow" cx=".35" cy=".25" r=".5">
            <stop offset="0" stopColor="#fff" stopOpacity=".7" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g className="blob">
          <path d="M50 9c19 0 35 10 39 28 3 16-4 33-21 41-18 8-39 6-49-8C9 56 7 37 17 23 25 12 38 9 50 9Z" fill="url(#docuBody)" />
          <path d="M50 9c19 0 35 10 39 28 3 16-4 33-21 41-18 8-39 6-49-8C9 56 7 37 17 23 25 12 38 9 50 9Z" fill="url(#docuGlow)" />
        </g>
        <ellipse className="eye" cx="38" cy="50" rx="4.4" ry="5.6" fill="#120a1c" />
        <ellipse className="eye" cx="62" cy="50" rx="4.4" ry="5.6" fill="#120a1c" />
        <circle cx="39.4" cy="48.3" r="1.3" fill="#fff" />
        <circle cx="63.4" cy="48.3" r="1.3" fill="#fff" />
        <path d="M40 63c4 4 16 4 20 0" stroke="#120a1c" strokeWidth="3" strokeLinecap="round" fill="none" />
        <ellipse cx="29" cy="60" rx="5" ry="3" fill="#f0abfc" opacity=".35" />
        <ellipse cx="71" cy="60" rx="5" ry="3" fill="#f0abfc" opacity=".35" />
      </svg>
      {searching && (
        <svg className="lens" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10" cy="10" r="6" fill="rgba(255,255,255,.25)" stroke="#f3eff7" strokeWidth="2.4" />
          <path d="m14.5 14.5 6 6" stroke="#f3eff7" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
