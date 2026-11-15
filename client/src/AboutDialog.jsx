import { useEffect } from "react";
import Docu from "./Docu";
import { XIcon, LinkIcon } from "./icons";
import { version } from "../package.json";

const AUTHOR = "Smith Grisales";
const LINKEDIN = "https://www.linkedin.com/in/smith-develop";

// Componentes de código abierto que usa la app (cada uno con su licencia, que esta no modifica)
const THIRD_PARTY = [
  ["React", "MIT"], ["Vite", "MIT"], ["Express", "MIT"], ["Mongoose", "MIT"], ["Multer", "MIT"],
  ["CORS", "MIT"], ["pdf-parse", "MIT"], ["Mammoth", "BSD-2-Clause"], ["SheetJS", "Apache-2.0"],
  ["Tesseract OCR", "Apache-2.0"], ["Poppler (pdftoppm)", "GPL-2.0, como programa aparte"],
  ["MongoDB", "SSPL, como servicio aparte"], ["Ollama", "MIT"],
];

// Qwen 2.5 sale con Apache 2.0 salvo los tamaños 3B y 72B, que van con la Qwen Research License
function modelLicense(model = "") {
  if (/^qwen2\.5:(3b|72b)/.test(model)) return { text: "Qwen Research License: restringe el uso comercial", warn: true };
  if (/^qwen2\.5:/.test(model)) return { text: "Apache-2.0" };
  return { text: "consulta la licencia del modelo" };
}

export default function AboutDialog({ model, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const lic = modelLicense(model);
  const year = new Date().getFullYear();

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="aboutT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog about">
        <div className="dlg-head">
          <div className="tt"><h3 id="aboutT">Acerca de</h3></div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          <div className="about-hero">
            <Docu size={56} />
            <div>
              <b>NeuroRepo</b>
              <span>Biblioteca documental · versión {version}</span>
            </div>
          </div>
          <dl className="about-facts">
            <dt>Autor</dt><dd>{AUTHOR}</dd>
            <dt>Contacto</dt><dd><a href={LINKEDIN} target="_blank" rel="noopener noreferrer"><LinkIcon size={13} />linkedin.com/in/smith-develop</a></dd>
            <dt>Modelo de IA</dt><dd>{model || "—"}{model && <> · <span className={lic.warn ? "warn-text" : undefined}>{lic.text}</span></>}</dd>
          </dl>
          <p className="about-legal">
            © {year} {AUTHOR}. Todos los derechos reservados. NeuroRepo es software propietario: su uso solo está
            permitido con autorización del autor, y queda prohibido copiarlo, modificarlo o distribuirlo sin su
            permiso por escrito (ver el archivo LICENSE).
          </p>
          <details className="about-third">
            <summary>Componentes de terceros</summary>
            <p className="help">Se usan bajo sus propias licencias de código abierto, que esta licencia no modifica.</p>
            <ul>{THIRD_PARTY.map(([name, license]) => <li key={name}><span>{name}</span><span>{license}</span></li>)}</ul>
          </details>
        </div>
      </div>
    </div>
  );
}
