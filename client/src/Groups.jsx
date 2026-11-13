import { useEffect, useState } from "react";
import { api } from "./api";

function FolderMessages({ folders, onChanged }) {
  const [drafts, setDrafts] = useState({});
  const [busyName, setBusyName] = useState(null);
  const [error, setError] = useState("");

  async function save(f) {
    setBusyName(f.folder);
    setError("");
    try {
      await api.updateFolder(f.folder, drafts[f.folder] ?? f.blockedMessage ?? "");
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyName(null);
    }
  }

  return (
    <div className="card">
      <h2>Mensaje cuando una carpeta está bloqueada</h2>
      <p className="hint">Lo ve un usuario sin permiso para esta carpeta cuando busca algo que solo está ahí.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {folders.length === 0 && <p className="hint">Todavía no hay carpetas indexadas.</p>}
      <ul className="app-message-list">
        {folders.map((f) => (
          <li key={f.folder}>
            <strong>{f.folder}</strong>
            <textarea rows={2} value={drafts[f.folder] ?? f.blockedMessage ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.folder]: e.target.value }))}
              placeholder="Mensaje por defecto si lo dejas vacío" maxLength={300} />
            <button type="button" className="ghost small" onClick={() => save(f)} disabled={busyName === f.folder}>
              {busyName === f.folder ? "Guardando…" : "Guardar"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupManager({ folders }) {
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.groups().then(setGroups).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  function toggleFolder(folder) {
    setPicked((s) => { const n = new Set(s); n.has(folder) ? n.delete(folder) : n.add(folder); return n; });
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createGroup({ name: name.trim(), folders: [...picked] });
      setName("");
      setPicked(new Set());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(g) {
    if (!confirm(`¿Borrar el grupo "${g.name}"? Sus usuarios se quedarán sin grupo.`)) return;
    setBusy(true);
    try {
      await api.deleteGroup(g._id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Grupos de acceso</h2>
      <p className="hint">Un usuario sin grupo no puede consultar ninguna carpeta.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <form className="note-form" onSubmit={create}>
        <label htmlFor="gn">Nombre del grupo</label>
        <input id="gn" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <label>Carpetas permitidas</label>
        <div className="app-checks">
          {folders.map((f) => (
            <label key={f.folder} className="app-check">
              <input type="checkbox" checked={picked.has(f.folder)} onChange={() => toggleFolder(f.folder)} /> {f.folder}
            </label>
          ))}
        </div>
        <div className="actions">
          <button disabled={busy || !name.trim()}>Crear grupo</button>
        </div>
      </form>
      <ul className="user-list">
        {groups.map((g) => (
          <li key={g._id}>
            <span>{g.name}</span>
            <span className="status-tag">{g.folders.join(", ") || "sin carpetas"}</span>
            <button type="button" className="link" onClick={() => remove(g)}>Borrar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Groups() {
  const [folders, setFolders] = useState([]);
  const [error, setError] = useState("");
  const load = () => api.folders().then(setFolders).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div className="panel">
      <h1>Grupos</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <FolderMessages folders={folders} onChanged={load} />
      <GroupManager folders={folders} />
    </div>
  );
}
