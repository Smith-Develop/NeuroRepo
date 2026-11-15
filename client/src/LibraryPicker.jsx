import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";
import { DbIcon, XIcon, HomeIcon, ChevronRightIcon, EditIcon, TrashIcon, PlusIcon, UploadIcon, RefreshIcon } from "./icons";

const join = (base, name) => (base ? `${base}/${name}` : name);

export default function LibraryPicker({ onClose }) {
  const [status, setStatus] = useState(null);
  const [path, setPath] = useState("");
  const [folders, setFolders] = useState([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
  // Mientras haya OCR pendiente, refresca el contador para ver cómo avanza la cola
  const ocrBusy = status?.ocr && status.ocrPending > 0;
  useEffect(() => {
    if (!ocrBusy) return;
    const t = setInterval(loadStatus, 5000);
    return () => clearInterval(t);
  }, [ocrBusy]);

  async function selectHere() {
    setBusy(true);
    setError("");
    try {
      const r = await api.selectLibrary(path);
      toast(`Biblioteca vinculada a /${path} · ${r.indexed} documento(s) indexado(s)`);
      await loadStatus();
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function reindex() {
    setBusy(true);
    setError("");
    try {
      const r = await api.reindexLibrary();
      toast(`Reindexado: ${r.indexed} documento(s)`);
      await loadStatus();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function createHere(e) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const created = newName.trim();
      await api.createFolder(path, created);
      setNewName("");
      await browse(path);
      await loadStatus();
      toast(`Carpeta ${created} creada`);
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
      toast(`Carpeta ${name} renombrada a ${next.trim()}`);
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
      toast(`Carpeta ${name} eliminada`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function uploadHere(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setBusy(true);
    setError("");
    try {
      const r = await api.uploadFiles(path, files);
      toast(`${r.uploaded} archivo(s) subido(s) a /${path}`);
      await loadStatus();
    } catch (e) { setError(e.message); } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const crumbs = path ? path.split("/") : [];

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="libT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dlg-head">
          <div className="fold-ic" style={{ background: "var(--accent-soft)", color: "var(--accent-2)" }}><DbIcon size={16} /></div>
          <div className="tt"><h3 id="libT">Vincular biblioteca</h3><p>Elige la carpeta del servidor que Docu debe indexar.</p></div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          {status && (
            <div className="status-box">
              <div><small>Carpeta activa</small><b>/{status.libraryPath || ""}</b></div>
              <div><small>Indexados</small><b>{status.totalDocuments}</b></div>
              <div><small>Última sync</small><b>{status.lastScanAt ? new Date(status.lastScanAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Nunca"}</b></div>
              <div title={status.ocrFailed ? `${status.ocrFailed} documento(s) no se pudieron leer con OCR` : undefined}>
                <small>OCR (escaneos)</small>
                <b>{!status.ocr ? "No disponible" : status.ocrPending ? `${status.ocrPending} en cola` : "Al día"}</b>
              </div>
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <div className="crumbs" style={{ margin: 0 }}>
            <button type="button" className="link" onClick={() => browse("")}><HomeIcon size={12} /> raíz</button>
            {crumbs.map((c, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ChevronRightIcon size={12} />
                <button type="button" className="link" onClick={() => browse(crumbs.slice(0, i + 1).join("/"))}>{c}</button>
              </span>
            ))}
          </div>
          <div className="folder-list">
            {folders.length === 0 && <div className="fr"><span className="help">Sin subcarpetas aquí.</span></div>}
            {folders.map((name) => (
              <div className="fr" key={name}>
                <span className="fold-ic" style={{ width: 26, height: 26 }}><DbIcon size={13} /></span>
                <button type="button" className="nm" style={{ textAlign: "left" }} onClick={() => browse(join(path, name))}>{name}</button>
                <span className="acts">
                  <button type="button" className="btn-icon sm" title="Renombrar" onClick={() => rename(name)} disabled={busy}><EditIcon size={14} /></button>
                  <button type="button" className="btn-icon sm" title="Eliminar" onClick={() => remove(name)} disabled={busy}><TrashIcon size={14} /></button>
                </span>
              </div>
            ))}
          </div>
          <form className="inline" onSubmit={createHere}>
            <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre de la nueva carpeta" maxLength={200} aria-label="Nueva carpeta" />
            <button type="submit" className="btn btn-secondary" disabled={busy || !newName.trim()}><PlusIcon size={14} />Crear</button>
          </form>
        </div>
        <div className="dlg-foot">
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={busy}><UploadIcon size={14} />Subir aquí</button>
          <input ref={fileRef} type="file" multiple hidden onChange={uploadHere} />
          <button type="button" className="btn btn-ghost" onClick={reindex} disabled={busy}><RefreshIcon size={14} />Reindexar</button>
          <span className="grow" />
          <button type="button" className="btn btn-primary" onClick={selectHere} disabled={busy}>Usar esta carpeta</button>
        </div>
      </div>
    </div>
  );
}
