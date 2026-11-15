import { useEffect, useRef, useState } from "react";
import { DotsIcon } from "./icons";

// Menú contextual ("⋯") para acciones de fila en tablas (Usuarios). Se posiciona con CSS
// relativo al botón (sin medir el viewport en JS): simple y suficiente para listas cortas.
export default function RowMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (!ref.current?.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="row-menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label="Acciones" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <DotsIcon />
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it, i) => it === "-"
            ? <hr key={i} />
            : (
              <button type="button" key={it.label} role="menuitem" className={it.danger ? "danger" : ""} disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick(); }}>
                {it.icon && <it.icon size={14} />} {it.label}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
