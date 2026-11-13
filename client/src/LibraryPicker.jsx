import { useEffect, useRef, useState } from "react";
import { api } from "./api";

const join = (base, name) => (base ? `${base}/${name}` : name);

export default function LibraryPicker({ onClose }) {
  const [status, setStatus] = useState(null);
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fileRef = useRef(null);

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

  async function createHere(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.createFolder(path, newName.trim());
      setNewName("");
      await browse(path);
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function rename(name) {
    const next = prompt(`Nuevo nombre para «${name}»:`, name);
    if (!next || next.trim() === name) return;
    setBusy(true);
    setError("");
    try {
      await api.renameFolder(join(path, name), next.trim());
      await browse(path);
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function remove(name) {
    if (!confirm(`¿Borrar la carpeta «${name}» y todo su contenido? Esto no se puede deshacer.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteFolder(join(path, name));
      await browse(path);
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function uploadHere(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await api.uploadFiles(path, files);
      setNotice(`${r.uploaded} archivo(s) subido(s) a /${path}.`);
      await loadStatus();
    } catch (e) { setError(e.message); } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
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
              <li key={name} className="folder-row">
                <button type="button" className="ghost small" onClick={() => browse(join(path, name))}>📁 {name}</button>
                <span className="row-actions">
                  <button type="button" className="link" onClick={() => rename(name)} disabled={busy}>Renombrar</button>
                  <button type="button" className="link danger" onClick={() => remove(name)} disabled={busy}>Eliminar</button>
                </span>
              </li>
            ))}
          </ul>

          <form className="new-folder-row" onSubmit={createHere}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de la nueva carpeta" maxLength={200} />
            <button type="submit" className="ghost small" disabled={busy || !newName.trim()}>Crear carpeta</button>
          </form>

          <div className="actions">
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Subir archivos aquí</button>
            <input ref={fileRef} type="file" multiple hidden onChange={uploadHere} />
            <button type="button" className="ghost" onClick={reindex} disabled={busy}>Reindexar ahora</button>
            <button type="button" onClick={selectHere} disabled={busy}>Usar esta carpeta</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
