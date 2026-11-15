import { useState } from "react";
import { api } from "./api";
import DocumentModal from "./DocumentModal";
import { toast } from "./toast";
import { EyeIcon, FolderIcon } from "./icons";

const BADGES = {
  ".pdf": { label: "PDF", color: "#d65a5a" },
  ".doc": { label: "DOC", color: "#4f7cf0" }, ".docx": { label: "DOC", color: "#4f7cf0" },
  ".xls": { label: "XLS", color: "#2fa86b" }, ".xlsx": { label: "XLS", color: "#2fa86b" }, ".csv": { label: "CSV", color: "#2fa86b" },
  ".txt": { label: "TXT", color: "#7a8296" }, ".md": { label: "MD", color: "#7a8296" },
  ".mp4": { label: "VID", color: "#9568e8" }, ".webm": { label: "VID", color: "#9568e8" }, ".mov": { label: "VID", color: "#9568e8" },
  ".mkv": { label: "VID", color: "#9568e8" }, ".m4v": { label: "VID", color: "#9568e8" },
  ".mp3": { label: "AUD", color: "#d89347" }, ".wav": { label: "AUD", color: "#d89347" }, ".m4a": { label: "AUD", color: "#d89347" },
  ".flac": { label: "AUD", color: "#d89347" }, ".ogg": { label: "AUD", color: "#d89347" },
};
export const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
export const TEXT_EXT = new Set([".txt", ".md"]);
export const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".mkv", ".m4v"]);
export const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".flac", ".ogg"]);
// Se puede abrir en el modal de vista previa (pdf, imagen o texto); vídeo/audio se reproducen
// directamente donde se muestren, sin necesidad de modal.
export const PREVIEWABLE = new Set([".pdf", ...IMAGE_EXT, ...TEXT_EXT]);
// Insignia (texto + color) en vez de un emoji: así no depende de que el sistema tenga una
// fuente de emojis a color (en varias máquinas Linux se ven como un garabato rojo/blanco).
export const badgeFor = (ext) => BADGES[ext] || { label: (ext || "").slice(1, 5).toUpperCase() || "FILE", color: "#5b6373" };

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Resalta en el fragmento las palabras de la búsqueda (ya viene escapado por si el nombre del
// archivo tuviera caracteres especiales): es solo un realce visual sobre el excerpt real del
// servidor, nunca contenido inventado.
function highlightExcerpt(text, terms) {
  let out = escapeHtml(text);
  terms.filter((t) => t.length > 2).forEach((t) => {
    const re = new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  });
  return out;
}

export function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

// Tarjeta de documento para el chat: fila compacta (icono · info · relevancia/acciones), al
// estilo de las tarjetas de resultado de búsqueda — las tarjetas grandes con miniatura son
// cosa del explorador (Explorer.jsx tiene sus propias FileRow/FileTile).
export default function DocumentCard({ doc, terms = [], maxScore }) {
  const [open, setOpen] = useState(false);
  const canPreview = PREVIEWABLE.has(doc.ext);
  const isVideo = VIDEO_EXT.has(doc.ext);
  const isAudio = AUDIO_EXT.has(doc.ext);
  const isMedia = isVideo || isAudio;
  const badge = badgeFor(doc.ext);
  const pct = typeof doc.score === "number" && maxScore > 0 ? Math.max(8, Math.round((doc.score / maxScore) * 100)) : null;

  function download() { toast(`Descargando ${doc.filename}`); }

  if (isMedia) {
    return (
      <div className="doc-media-card">
        <strong className="doc-name">{doc.filename}</strong>
        <small className="doc-path">{doc.folder || "/"} · {formatSize(doc.size)}</small>
        <div className="doc-media-wrap">
          {isVideo && <video controls preload="metadata" className="doc-media" src={api.viewUrl(doc._id)} />}
          {isAudio && <audio controls preload="metadata" className="doc-media" src={api.viewUrl(doc._id)} />}
          <a className="icon-btn media-dl" href={api.downloadUrl(doc._id)} title="Descargar" aria-label="Descargar" onClick={download}><DownloadIcon /></a>
        </div>
      </div>
    );
  }

  return (
    <div className="res">
      <span className="file-badge" style={{ background: badge.color }}>{badge.label}</span>
      <div className="info">
        <div className="t" title={doc.filename}>{doc.filename}</div>
        <div className="doc-path"><FolderIcon size={11} /> {doc.folder || "/"} · {formatSize(doc.size)}</div>
        {terms.length > 0 && doc.excerpt && (
          <p className="snip" dangerouslySetInnerHTML={{ __html: highlightExcerpt(doc.excerpt, terms) + "…" }} />
        )}
      </div>
      <div className="side">
        {pct !== null && (
          <div className="doc-score" title="Relevancia para tu búsqueda">
            <span className="bar"><i style={{ width: `${pct}%` }} /></span>{pct}%
          </div>
        )}
        <div className="doc-card-actions">
          <a className="icon-btn" href={api.downloadUrl(doc._id)} title="Descargar" aria-label="Descargar" onClick={download}><DownloadIcon /></a>
          {canPreview && <button type="button" className="btn-accent small" onClick={() => setOpen(true)}><EyeIcon size={13} /> Abrir</button>}
        </div>
      </div>
      {open && <DocumentModal doc={doc} onClose={() => setOpen(false)} />}
    </div>
  );
}
