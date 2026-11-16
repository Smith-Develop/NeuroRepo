import { useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { badgeFor, formatSize, formatDate, IMAGE_EXT, TEXT_EXT, VIDEO_EXT, AUDIO_EXT, OFFICE_EXT } from "./DocumentCard";
import { XIcon, DownloadIcon, HistoryIcon, RestoreIcon } from "./icons";
import { AppContext } from "./appContext";
import { toast } from "./toast";

// El HTML de Word/Excel viene del propio documento: se pinta en un iframe con sandbox="" (sin
// scripts, origen opaco) y una CSP que no deja cargar nada externo. Los colores se leen del tema.
function officeSrcDoc(html) {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
<style>
  body { margin: 0; padding: 24px 28px; background: ${v("--surface", "#110e15")}; color: ${v("--text-2", "#bdb5c6")};
    font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; }
  h1, h2, h3, h4, strong, b { color: ${v("--text", "#f3eff7")}; }
  a { color: ${v("--accent-2", "#c084fc")}; pointer-events: none; }
  img { max-width: 100%; height: auto; }
  table { border-collapse: collapse; font-size: 12.5px; }
  td, th { border: 1px solid ${v("--surface-4", "#262130")}; padding: 4px 8px; vertical-align: top; white-space: nowrap; }
  tr:first-child td { background: ${v("--surface-3", "#1e1a24")}; color: ${v("--text", "#f3eff7")}; font-weight: 600; }
</style></head><body>${html}</body></html>`;
}

const when = (d) => new Date(d).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Versiones anteriores (solo admin): las que se guardaron al sustituir el archivo subiendo otro igual
function VersionsPanel({ doc, onRestored }) {
  const [versions, setVersions] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.versions(doc._id).then(setVersions).catch((e) => setError(e.message)), [doc._id]);
  useEffect(() => { load(); }, [load]);

  async function restore(v) {
    if (!confirm(`¿Restaurar la versión del ${when(v.mtimeMs)}? Lo que hay ahora se guardará como otra versión.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.restoreVersion(v._id);
      toast("Versión restaurada");
      await load();
      onRestored();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="versions">
      <p className="hint">Cada vez que se sube un archivo con el mismo nombre, el anterior se guarda aquí (se conservan las 10 últimas).</p>
      {error && <p className="error" role="alert">{error}</p>}
      {versions === null ? <p className="hint">Cargando…</p>
        : versions.length === 0 ? <p className="hint">Este archivo todavía no tiene versiones anteriores.</p>
        : (
          <ul className="version-list">
            {versions.map((v) => (
              <li key={v._id}>
                <span className="fold-ic"><HistoryIcon size={15} /></span>
                <span className="vtx"><b>Versión del {when(v.mtimeMs)}</b><small>Sustituida el {when(v.createdAt)} por {v.byName} · {formatSize(v.size)}</small></span>
                <a className="btn-icon sm" href={api.versionDownloadUrl(v._id)} title="Descargar esta versión" aria-label="Descargar esta versión"><DownloadIcon size={15} /></a>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => restore(v)}><RestoreIcon size={14} />Restaurar</button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

// Visor en diálogo: pdf (iframe), imagen, texto (se lee aparte y se muestra con el estilo
// oscuro de la app), Word/Excel (HTML convertido en el servidor), vídeo/audio (reproductor).
export default function DocumentModal({ doc, onClose }) {
  const [text, setText] = useState(null);
  const [office, setOffice] = useState(null);
  const [sheet, setSheet] = useState(0);
  const [error, setError] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [rev, setRev] = useState(0); // sube al restaurar una versión, para volver a pedir el archivo
  const { user, reloadDocuments } = useContext(AppContext);
  const isAdmin = user?.role === "admin";
  const viewSrc = api.viewUrl(doc._id) + (rev ? `?r=${rev}` : "");
  const isPdf = doc.ext === ".pdf";
  const isImage = IMAGE_EXT.has(doc.ext);
  const isText = TEXT_EXT.has(doc.ext);
  const isOffice = OFFICE_EXT.has(doc.ext);
  const isVideo = VIDEO_EXT.has(doc.ext);
  const isAudio = AUDIO_EXT.has(doc.ext);
  const { label, cls } = badgeFor(doc.ext);

  useEffect(() => {
    if (!isOffice) return;
    let cancelled = false;
    setOffice(null);
    api.preview(doc._id)
      .then((p) => { if (!cancelled) setOffice(p); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [doc._id, isOffice, rev]);

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setText(null);
    fetch(viewSrc, { credentials: "include" })
      .then((r) => { if (!r.ok) throw new Error("No se pudo abrir el archivo."); return r.text(); })
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [viewSrc, isText]);

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Portal a <body>: abierto desde una tarjeta del chat, el modal quedaba dentro del mensaje, que tiene
  // animación (transform) y scroll propio y podía recortarlo o descolocarlo.
  return createPortal(
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="viewT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide">
        <div className="dlg-head" style={{ alignItems: "center" }}>
          <span className={`ftype sm ${cls}`}>{label}</span>
          <div className="tt">
            <h3 id="viewT">{doc.filename}</h3>
            <p>{doc.folder || "/"} · {formatSize(doc.size)}{doc.mtimeMs ? ` · Actualizado ${formatDate(doc.mtimeMs)}` : ""}</p>
          </div>
          {isAdmin && (
            <button type="button" className={`btn btn-ghost btn-sm${showVersions ? " on" : ""}`} onClick={() => setShowVersions((v) => !v)} aria-pressed={showVersions}>
              <HistoryIcon size={14} />{showVersions ? "Vista previa" : "Versiones"}
            </button>
          )}
          <a className="btn btn-secondary btn-sm" href={api.downloadUrl(doc._id)}><DownloadIcon size={14} />Descargar</a>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        {showVersions ? (
          <div className="viewer-body"><VersionsPanel doc={doc} onRestored={() => { setRev((r) => r + 1); reloadDocuments(); }} /></div>
        ) : (
        <div className="viewer-body">
          {isPdf && <iframe title={doc.filename} src={viewSrc} />}
          {isImage && <img src={viewSrc} alt={doc.filename} />}
          {isVideo && <video controls autoPlay src={viewSrc} />}
          {isAudio && <audio controls autoPlay src={viewSrc} />}
          {isText && (
            error ? <p className="error">{error}</p>
              : text === null ? <p className="hint">Cargando…</p>
              : <pre>{text}</pre>
          )}
          {isOffice && (
            error ? <p className="error">{error}</p>
              : office === null ? <p className="hint">Preparando vista previa…</p>
              : (
                <>
                  {office.sheets.length > 1 && (
                    <div className="seg viewer-tabs" role="tablist" aria-label="Hojas">
                      {office.sheets.map((s, i) => (
                        <button type="button" role="tab" key={s.name} aria-selected={i === sheet} className={i === sheet ? "on" : ""} onClick={() => setSheet(i)}>{s.name}</button>
                      ))}
                    </div>
                  )}
                  {office.truncated && <p className="hint viewer-note">Vista recortada a {office.maxRows} filas y {office.maxCols} columnas por hoja. Descarga el archivo para verlo completo.</p>}
                  <iframe title={doc.filename} sandbox="" className="office-frame" srcDoc={officeSrcDoc(office.sheets[sheet]?.html || "")} />
                </>
              )
          )}
          {!isPdf && !isImage && !isText && !isOffice && !isVideo && !isAudio && (
            <p className="hint">No hay vista previa para este tipo de archivo. Descárgalo para abrirlo.</p>
          )}
        </div>
        )}
      </div>
    </div>
  , document.body);
}
