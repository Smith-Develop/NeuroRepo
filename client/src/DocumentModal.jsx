import { useEffect, useState } from "react";
import { api } from "./api";
import { badgeFor, IMAGE_EXT, TEXT_EXT, VIDEO_EXT, AUDIO_EXT } from "./DocumentCard";

// Vista previa de un documento: pdf (iframe), imagen, texto (se lee aparte y se muestra con
// el estilo oscuro de la app), vídeo/audio (reproductor). El resto no debería abrir este modal.
export default function DocumentModal({ doc, onClose }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState("");
  const isPdf = doc.ext === ".pdf";
  const isImage = IMAGE_EXT.has(doc.ext);
  const isText = TEXT_EXT.has(doc.ext);
  const isVideo = VIDEO_EXT.has(doc.ext);
  const isAudio = AUDIO_EXT.has(doc.ext);

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    fetch(api.viewUrl(doc._id), { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error("No se pudo abrir el archivo."); return r.text(); })
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [doc._id, isText]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="drawer preview-drawer" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="close" onClick={onClose} aria-label="Cerrar">×</button>
        <h2 className="preview-title">
          <span className="file-badge file-badge-inline" style={{ background: badgeFor(doc.ext).color }}>{badgeFor(doc.ext).label}</span>
          {doc.filename}
        </h2>
        <div className="preview-body">
          {isPdf && <iframe title={doc.filename} src={api.viewUrl(doc._id)} className="preview-frame" />}
          {isImage && <img src={api.viewUrl(doc._id)} alt={doc.filename} className="preview-image" />}
          {isVideo && <video controls autoPlay className="preview-media" src={api.viewUrl(doc._id)} />}
          {isAudio && <audio controls autoPlay className="preview-media" src={api.viewUrl(doc._id)} />}
          {isText && (
            error ? <p className="error">{error}</p>
              : text === null ? <p className="hint">Cargando…</p>
              : <pre className="preview-text">{text}</pre>
          )}
          {!isPdf && !isImage && !isText && !isVideo && !isAudio && (
            <p className="hint">No hay vista previa para este tipo de archivo. Descárgalo para abrirlo.</p>
          )}
        </div>
        <div className="actions">
          <a className="ghost small" href={api.downloadUrl(doc._id)}>Descargar</a>
        </div>
      </div>
    </div>
  );
}
