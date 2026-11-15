import { useEffect, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";
import { FolderIcon } from "./icons";

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
      toast(`Mensaje de ${f.folder} guardado`);
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
            <span className="folder-label"><FolderIcon size={15} /> {f.folder}</span>
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

function FolderChips({ folders, picked, onToggle }) {
  return (
    <div className="chip-grid">
      {folders.map((f) => {
        const on = picked.has(f.folder);
        return (
          <button type="button" key={f.folder} className={`folder-chip${on ? " on" : ""}`}
            aria-pressed={on} onClick={() => onToggle(f.folder)}>
            <FolderIcon size={13} /> {f.folder}
          </button>
        );
      })}
    </div>
  );
}

function GroupForm({ group, folders, onDone, onError }) {
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState(new Set(group?.folders ?? []));
  const [busy, setBusy] = useState(false);

  function toggle(folder) {
    setPicked((s) => { const n = new Set(s); n.has(folder) ? n.delete(folder) : n.add(folder); return n; });
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    onError("");
    try {
      const body = { name: name.trim(), folders: [...picked] };
      if (group) await api.updateGroup(group._id, body);
      else await api.createGroup(body);
      onDone();
      toast(group ? `Grupo ${body.name} actualizado` : `Grupo ${body.name} creado`);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="note-form" onSubmit={submit}>
      <label htmlFor="gn">Nombre del grupo</label>
      <input id="gn" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="p. ej. Recepción" />
      <div className="chip-grid-head">
        <label>Carpetas permitidas</label>
        {folders.length > 0 && (
          <span className="chip-grid-actions">
            <button type="button" className="link" onClick={() => setPicked(new Set(folders.map((f) => f.folder)))}>Marcar todas</button>
            <button type="button" className="link" onClick={() => setPicked(new Set())}>Ninguna</button>
          </span>
        )}
      </div>
      {folders.length === 0
        ? <p className="hint">Todavía no hay carpetas indexadas.</p>
        : <FolderChips folders={folders} picked={picked} onToggle={toggle} />}
      <div className="actions">
        {group && <button type="button" className="ghost" onClick={onDone} disabled={busy}>Cancelar</button>}
        <button type="submit" className="btn-accent" disabled={busy || !name.trim()}>{group ? "Guardar cambios" : "Crear grupo"}</button>
      </div>
    </form>
  );
}

function GroupCard({ group, editing, folders, onEdit, onDone, onError, onChanged }) {
  async function remove() {
    if (!confirm(`¿Borrar el grupo "${group.name}"? Sus usuarios se quedarán sin grupo.`)) return;
    try {
      await api.deleteGroup(group._id);
      onChanged();
      toast(`Grupo ${group.name} borrado`);
    } catch (e) {
      onError(e.message);
    }
  }

  if (editing) {
    return <li className="group-card"><GroupForm group={group} folders={folders} onDone={onDone} onError={onError} /></li>;
  }

  return (
    <li className="group-card">
      <div className="group-card-head">
        <strong>{group.name}</strong>
        <div className="group-card-actions">
          <button type="button" className="link" onClick={onEdit}>Editar</button>
          <button type="button" className="link danger" onClick={remove}>Borrar</button>
        </div>
      </div>
      <div className="group-folders">
        {group.folders.length === 0
          ? <span className="hint" style={{ margin: 0 }}>Sin carpetas asignadas</span>
          : group.folders.map((f) => <span key={f} className="folder-badge"><FolderIcon size={12} /> {f}</span>)}
      </div>
    </li>
  );
}

function GroupManager({ folders }) {
  const [groups, setGroups] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const load = () => api.groups().then(setGroups).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  function done() { setCreating(false); setEditingId(null); load(); }

  return (
    <div className="card">
      <h2>Grupos de acceso</h2>
      <p className="hint">Un usuario sin grupo no puede consultar ninguna carpeta. Toca las carpetas para permitirlas.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {!creating && (
        <div className="actions" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
          <button type="button" className="ghost small" onClick={() => setCreating(true)}>Nuevo grupo</button>
        </div>
      )}
      {creating && <GroupForm folders={folders} onDone={done} onError={setError} />}
      <ul className="group-list">
        {groups.length === 0 && <li className="hint">Todavía no hay grupos.</li>}
        {groups.map((g) => (
          <GroupCard key={g._id} group={g} editing={editingId === g._id} folders={folders}
            onEdit={() => setEditingId(g._id)} onDone={done} onChanged={load} onError={setError} />
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
