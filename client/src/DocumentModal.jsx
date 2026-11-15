import { useEffect, useState } from "react";
import { api } from "./api";
import { badgeFor, formatSize, formatDate, IMAGE_EXT, TEXT_EXT, VIDEO_EXT, AUDIO_EXT } from "./DocumentCard";
import { XIcon, DownloadIcon } from "./icons";

// Visor en diálogo: pdf (iframe), imagen, texto (se lee aparte y se muestra con el estilo
// oscuro de la app), vídeo/audio (reproductor). El resto no debería abrir este modal.
export default function DocumentModal({ doc, onClose }) {
  const [text, setText] = useState(null);
  const [error, setError] = useState("");
  const isPdf = doc.ext === ".pdf";
  const isImage = IMAGE_EXT.has(doc.ext);
  const isText = TEXT_EXT.has(doc.ext);
  const isVideo = VIDEO_EXT.has(doc.ext);
  const isAudio = AUDIO_EXT.has(doc.ext);
  const { label, cls } = badgeFor(doc.ext);

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
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="viewT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide">
        <div className="dlg-head" style={{ alignItems: "center" }}>
          <span className={`ftype sm ${cls}`}>{label}</span>
          <div className="tt">
            <h3 id="viewT">{doc.filename}</h3>
            <p>{doc.folder || "/"} · {formatSize(doc.size)}{doc.mtimeMs ? ` · Actualizado ${formatDate(doc.mtimeMs)}` : ""}</p>
          </div>
          <a className="btn btn-secondary btn-sm" href={api.downloadUrl(doc._id)}><DownloadIcon size={14} />Descargar</a>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="viewer-body">
          {isPdf && <iframe title={doc.filename} src={api.viewUrl(doc._id)} />}
          {isImage && <img src={api.viewUrl(doc._id)} alt={doc.filename} />}
          {isVideo && <video controls autoPlay src={api.viewUrl(doc._id)} />}
          {isAudio && <audio controls autoPlay src={api.viewUrl(doc._id)} />}
          {isText && (
            error ? <p className="error">{error}</p>
              : text === null ? <p className="hint">Cargando…</p>
              : <pre>{text}</pre>
          )}
          {!isPdf && !isImage && !isText && !isVideo && !isAudio && (
            <p className="hint">No hay vista previa para este tipo de archivo. Descárgalo para abrirlo.</p>
          )}
        </div>
      </div>
    </div>
  );
}
