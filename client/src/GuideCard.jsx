import { useState } from "react";
import { BookIcon, ChevronDownIcon } from "./icons";

// Apunte de la Guía rápida que responde a la pregunta (en el chat, encima de los documentos)
export default function GuideCard({ entry }) {
  const long = entry.body.length > 700;
  const [open, setOpen] = useState(!long);
  return (
    <div className="guide-card">
      <div className="guide-head">
        <span className="ic"><BookIcon size={15} /></span>
        <span className="badge accent">Guía rápida</span>
        {entry.adminOnly && <span className="badge warn">Solo admin</span>}
      </div>
      <div className={`guide-body${open ? "" : " clamp"}`}>{entry.body}</div>
      {long && (
        <button type="button" className="btn btn-ghost btn-sm guide-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDownIcon size={14} style={{ transform: open ? "rotate(180deg)" : "none" }} />{open ? "Ver menos" : "Ver todo"}
        </button>
      )}
    </div>
  );
}
