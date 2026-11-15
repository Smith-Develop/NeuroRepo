import { useEffect, useState } from "react";
import { api } from "./api";
import Crumbs from "./Crumbs";
import { toast } from "./toast";
import { EditIcon, FolderIcon, PlusIcon, ShieldIcon, TrashIcon } from "./icons";

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
      <div className="card-head">
        <div><h2>Mensaje de carpeta bloqueada</h2><p>Lo verá quien busque algo que solo existe en una carpeta sin permiso.</p></div>
      </div>
      {error && <p className="error" role="alert" style={{ margin: "10px 18px 0" }}>{error}</p>}
      {folders.length === 0 && <p className="hint" style={{ padding: "14px 18px" }}>Todavía no hay carpetas indexadas.</p>}
      <ul className="app-message-list">
        {folders.map((f) => (
          <li key={f.folder}>
            <span className="folder-label"><FolderIcon size={15} filled /> {f.folder}</span>
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

function GroupDialog({ group, folders, onClose, onSaved, onError }) {
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
      onSaved();
      toast(group ? `Grupo ${body.name} actualizado` : `Grupo ${body.name} creado`);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="close" onClick={onClose} aria-label="Cerrar">×</button>
        <h2>{group ? "Editar grupo" : "Nuevo grupo"}</h2>
        <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>Elige qué carpetas podrán consultar sus miembros.</p>
        <div className="field">
          <label htmlFor="gn">Nombre del grupo</label>
          <input id="gn" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} placeholder="p. ej. Recepción" />
        </div>
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
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="submit" className="btn-accent" disabled={busy || !name.trim()}>{group ? "Guardar cambios" : "Crear grupo"}</button>
        </div>
      </form>
    </div>
  );
}

function GroupCard({ group, users, onEdit, onError, onChanged }) {
  const members = users.filter((u) => u.group?._id === group._id);
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
  return (
    <li className="group-card">
      <div className="group-card-head">
        <span className="group-card-icon"><ShieldIcon size={16} /></span>
        <div>
          <strong>{group.name}</strong>
          <small>{members.length} miembro{members.length !== 1 ? "s" : ""} · {group.folders.length} carpeta{group.folders.length !== 1 ? "s" : ""}</small>
        </div>
        <div className="group-card-actions">
          <button type="button" className="icon-btn" title="Editar" onClick={onEdit}><EditIcon size={14} /></button>
          <button type="button" className="icon-btn" title="Borrar" onClick={remove}><TrashIcon size={14} /></button>
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
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null); // null | "new" | group object

  const load = () => Promise.all([api.groups(), api.users()]).then(([g, u]) => { setGroups(g); setUsers(u); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  function closeDialog() { setDialog(null); }
  function saved() { closeDialog(); load(); }

  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Grupos de acceso</h2><p>Un usuario sin grupo no puede consultar ninguna carpeta.</p></div>
        <button type="button" className="btn-accent small" onClick={() => setDialog("new")}><PlusIcon size={14} /> Nuevo grupo</button>
      </div>
      {error && <p className="error" role="alert" style={{ margin: "10px 18px 0" }}>{error}</p>}
      <ul className="group-list">
        {groups.length === 0 && <li className="hint" style={{ padding: "14px 18px" }}>Todavía no hay grupos.</li>}
        {groups.map((g) => (
          <GroupCard key={g._id} group={g} users={users} onEdit={() => setDialog(g)} onChanged={load} onError={setError} />
        ))}
      </ul>
      {dialog && (
        <GroupDialog group={dialog === "new" ? null : dialog} folders={folders} onClose={closeDialog} onSaved={saved} onError={setError} />
      )}
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
      <Crumbs items={["Administración", "Grupos y permisos"]} />
      <div className="page-head">
        <div><h1>Grupos y permisos</h1><p>Elige qué carpetas puede consultar cada grupo.</p></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="two-col">
        <GroupManager folders={folders} />
        <FolderMessages folders={folders} onChanged={load} />
      </div>
    </div>
  );
}
