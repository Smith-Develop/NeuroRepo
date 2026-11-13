import { useEffect, useState } from "react";
import { api } from "./api";

const join = (base, name) => (base ? `${base}/${name}` : name);

export default function LibraryPicker({ onClose }) {
  const [status, setStatus] = useState(null);
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function loadStatus() {
    try { setStatus(await api.library()); } catch (e) { setError(e.message); }
  }
  async function browse(p) {
    setError("");
    try {
      const r = await api.browseLibrary(p);
      setPath(r.path);
      setFolders(r.folders);
    } catch (e) { setError(e.message); }
  }

  useEffect(() => { loadStatus(); browse(""); }, []);

  async function selectHere() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api.selectLibrary(path);
      setNotice(`Biblioteca vinculada. ${r.indexed} documento(s) indexado(s).`);
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function reindex() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api.reindexLibrary();
      setNotice(`Reindexado. ${r.indexed} documento(s) encontrados.`);
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const crumbs = path ? path.split("/") : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <aside className="drawer" aria-label="Vincular biblioteca" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Cerrar">×</button>
        <div className="drawer-inner">
          <h2>Vincular biblioteca</h2>
          {status && (
            <p className="hint">
              Carpeta activa: <strong>/{status.libraryPath || ""}</strong> · {status.totalDocuments} documento(s) indexados
              {status.lastScanAt ? ` · última reindexación: ${new Date(status.lastScanAt).toLocaleString()}` : ""}
            </p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="notice" role="status">{notice}</p>}

          <div className="breadcrumbs">
            <button type="button" className="link" onClick={() => browse("")}>raíz</button>
            {crumbs.map((c, i) => (
              <span key={i}> / <button type="button" className="link" onClick={() => browse(crumbs.slice(0, i + 1).join("/"))}>{c}</button></span>
            ))}
          </div>

          <ul className="folder-browser">
            {folders.length === 0 && <li className="hint">Sin subcarpetas aquí.</li>}
            {folders.map((name) => (
              <li key={name}>
                <button type="button" className="ghost small" onClick={() => browse(join(path, name))}>📁 {name}</button>
              </li>
            ))}
          </ul>

          <div className="actions">
            <button type="button" className="ghost" onClick={reindex} disabled={busy}>Reindexar ahora</button>
            <button type="button" onClick={selectHere} disabled={busy}>Usar esta carpeta</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
