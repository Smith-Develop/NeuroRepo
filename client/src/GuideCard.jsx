import { useState } from "react";
import { BookIcon, ChevronDownIcon } from "./icons";
import { Highlight } from "./highlight";

const TYPE_LABEL = { aplicacion: "Aplicación", procedimiento: "Procedimiento", contacto: "Contacto", acceso: "Acceso" };

// Ficha de la Guía rápida que responde a la pregunta (en el chat, encima de los documentos), con
// las palabras de la pregunta resaltadas
export default function GuideCard({ entry, highlight }) {
  const long = entry.body.length > 700;
  const [open, setOpen] = useState(!long);
  // Conversaciones guardadas antes de las fichas: el título iba dentro del cuerpo
  const title = entry.body.startsWith(entry.title) ? "" : entry.title;
  return (
    <div className="guide-card">
      <div className="guide-head">
        <span className="ic"><BookIcon size={15} /></span>
        <span className="badge accent">Guía rápida</span>
        {entry.category && <span className="badge">{entry.category}</span>}
        {TYPE_LABEL[entry.type] && <span className="badge">{TYPE_LABEL[entry.type]}</span>}
        {entry.adminOnly && <span className="badge warn">Solo admin</span>}
      </div>
      {title && <div className="guide-title"><Highlight text={title} terms={highlight} /></div>}
      <div className={`guide-body${open ? "" : " clamp"}`}><Highlight text={entry.body} terms={highlight} /></div>
      {long && (
        <button type="button" className="btn btn-ghost btn-sm guide-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <ChevronDownIcon size={14} style={{ transform: open ? "rotate(180deg)" : "none" }} />{open ? "Ver menos" : "Ver todo"}
        </button>
      )}
    </div>
  );
}
