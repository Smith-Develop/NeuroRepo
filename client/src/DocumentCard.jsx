import { api } from "./api";

const ICONS = { ".pdf": "📕", ".doc": "📘", ".docx": "📘", ".xls": "📗", ".xlsx": "📗", ".csv": "📗", ".txt": "📄", ".md": "📄" };
export const INLINE = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
export const iconFor = (ext) => ICONS[ext] || "📎";

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentCard({ doc }) {
  const canPreview = INLINE.has(doc.ext);
  return (
    <div className="doc-card">
      <span className="doc-icon" aria-hidden="true">{iconFor(doc.ext)}</span>
      <div className="doc-info">
        <strong className="doc-name">{doc.filename}</strong>
        <small className="doc-path">{doc.folder || "/"} · {formatSize(doc.size)}</small>
        {doc.excerpt && <p className="doc-excerpt">{doc.excerpt}…</p>}
      </div>
      <div className="doc-actions">
        {canPreview && (
          <a className="ghost small" href={api.viewUrl(doc._id)} target="_blank" rel="noreferrer">Ver</a>
        )}
        <a className="ghost small" href={api.downloadUrl(doc._id)}>Descargar</a>
      </div>
    </div>
  );
}
