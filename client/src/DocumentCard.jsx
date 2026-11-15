import { useState } from "react";
import { api } from "./api";
import DocumentModal from "./DocumentModal";
import { toast } from "./toast";
import { EyeIcon, FolderIcon, ChevronRightIcon, DownloadIcon } from "./icons";

const LABELS = {
  ".pdf": "PDF", ".doc": "DOC", ".docx": "DOC", ".xls": "XLS", ".xlsx": "XLS", ".csv": "CSV",
  ".txt": "TXT", ".md": "MD", ".mp4": "VID", ".webm": "VID", ".mov": "VID", ".mkv": "VID", ".m4v": "VID",
  ".mp3": "AUD", ".wav": "AUD", ".m4a": "AUD", ".flac": "AUD", ".ogg": "AUD",
};
const CLASS = { ".pdf": "pdf", ".doc": "doc", ".docx": "doc", ".xls": "xls", ".xlsx": "xls", ".csv": "xls" };
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
export const TEXT_EXT = new Set([".txt", ".md"]);
export const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v"]);
export const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg"]);
// Word/Excel: el servidor los convierte a HTML (`GET /documents/:id/preview`). El .doc antiguo no.
export const OFFICE_EXT = new Set([".docx", ".xlsx", ".xls", ".csv"]);
// Se puede abrir en el modal de vista previa (pdf, imagen, texto, Word/Excel); vídeo/audio se
// reproducen directamente donde se muestren, sin necesidad de modal.
export const PREVIEWABLE = new Set([".pdf", ...IMAGE_EXT, ...TEXT_EXT, ...OFFICE_EXT]);
export const badgeFor = (ext) => ({ label: LABELS[ext] || (ext || "").slice(1, 5).toUpperCase() || "FILE", cls: CLASS[ext] || "other" });

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function formatDate(ms) {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}

// Fila de resultado (chat): insignia de tipo + nombre/ruta/fragmento y, al lado, relevancia
// (si la trae la búsqueda) y las acciones de abrir/descargar. Vídeo y audio se reproducen aquí
// mismo, en la propia fila, tal como pidió el cliente ("que se puedan reproducir desde el chat").
export default function DocumentCard({ doc, score, maxScore }) {
  const [open, setOpen] = useState(false);
  const canPreview = PREVIEWABLE.has(doc.ext);
  const isVideo = VIDEO_EXT.has(doc.ext);
  const isAudio = AUDIO_EXT.has(doc.ext);
  const { label, cls } = badgeFor(doc.ext);
  const pct = score && maxScore ? Math.max(8, Math.round(100 * score / maxScore)) : null;
  const pathParts = (doc.folder || "").split("/").filter(Boolean);

  function download() { toast(`Descargando ${doc.filename}`); }

  return (
    <div className="res">
      <span className={`ftype ${cls}`}>{label}</span>
      <div className="info">
        <div className="t" title={doc.filename}>{doc.filename}</div>
        <div className="path">
          <FolderIcon size={11} />
          {pathParts.map((p, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              {i > 0 && <ChevronRightIcon size={11} />}{p}
            </span>
          ))}
          {" · "}{formatSize(doc.size)}{doc.mtimeMs ? ` · ${formatDate(doc.mtimeMs)}` : ""}
        </div>
        {doc.excerpt && !isVideo && !isAudio && <div className="snip">{doc.excerpt}</div>}
        {isVideo && <div className="media"><video controls preload="metadata" src={api.viewUrl(doc._id)} /></div>}
        {isAudio && <div className="media"><audio controls preload="metadata" src={api.viewUrl(doc._id)} /></div>}
      </div>
      <div className="side">
        {pct !== null && (
          <div className="score" title="Relevancia"><span className="bar"><i style={{ width: `${pct}%` }} /></span>{pct}%</div>
        )}
        <div className="acts">
          <a className="btn-icon sm" href={api.downloadUrl(doc._id)} title="Descargar" aria-label="Descargar" onClick={download}><DownloadIcon size={15} /></a>
          {canPreview && <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><EyeIcon size={14} />Abrir</button>}
        </div>
      </div>
      {open && <DocumentModal doc={doc} onClose={() => setOpen(false)} />}
    </div>
  );
}
