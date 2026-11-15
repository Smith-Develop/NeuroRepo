import { useEffect, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";
import { FolderIcon, ShieldIcon, EditIcon, TrashIcon, XIcon, PlusIcon, HomeIcon, ChevronRightIcon } from "./icons";

const COLORS = ["", "c2", "c3", "c4"];
const initialsOf = (name) => (name || "?").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

function GroupDialog({ group, folders, onClose, onDone }) {
  const [name, setName] = useState(group?.name ?? "");
  const [picked, setPicked] = useState(new Set(group?.folders ?? []));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggle(folder) {
    setPicked((s) => { const n = new Set(s); n.has(folder) ? n.delete(folder) : n.add(folder); return n; });
  }
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = { name: name.trim(), folders: [...picked] };
      if (group) await api.updateGroup(group._id, body);
      else await api.createGroup(body);
      toast(group ? `Grupo ${body.name} actualizado` : `Grupo ${body.name} creado`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="grpT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <div className="dlg-head">
          <div className="tt"><h3 id="grpT">{group ? "Editar grupo" : "Nuevo grupo"}</h3><p>Elige qué carpetas podrán consultar sus miembros.</p></div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          <div className="field"><label htmlFor="gName">Nombre del grupo</label><input className="input" id="gName" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="p. ej. Recepción" /></div>
          <div className="field">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="label">Carpetas permitidas</span>
              <span style={{ display: "flex", gap: 4 }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(folders.map((f) => f.folder)))}>Todas</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Ninguna</button>
              </span>
            </div>
            {folders.length === 0 ? <p className="hint help">Todavía no hay carpetas indexadas.</p> : (
              <div className="followups">
                {folders.map((f) => (
                  <button type="button" key={f.folder} className={`chip ${picked.has(f.folder) ? "on" : ""}`} aria-pressed={picked.has(f.folder)} onClick={() => toggle(f.folder)}>
                    <FolderIcon size={13} />{f.folder}
                  </button>
                ))}
              </div>
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="dlg-foot">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{group ? "Guardar cambios" : "Crear grupo"}</button>
        </div>
      </form>
    </div>
  );
}

export default function Groups() {
  const [folders, setFolders] = useState([]);
  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null); // null | "new" | group
  const [drafts, setDrafts] = useState({});
  const [savingMsg, setSavingMsg] = useState(null);

  const load = () => Promise.all([api.folders(), api.groups(), api.users()])
    .then(([f, g, u]) => { setFolders(f); setGroups(g); setUsers(u); })
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function removeGroup(g) {
    if (!confirm(`¿Borrar el grupo "${g.name}"? Sus usuarios se quedarán sin grupo.`)) return;
    try {
      await api.deleteGroup(g._id);
      toast(`Grupo ${g.name} borrado`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveMessage(f) {
    setSavingMsg(f.folder);
    try {
      await api.updateFolder(f.folder, drafts[f.folder] ?? f.blockedMessage ?? "");
      toast(`Mensaje de ${f.folder} guardado`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingMsg(null);
    }
  }

  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><HomeIcon size={12} />Administración<ChevronRightIcon size={12} />Grupos y permisos</div>
      <div className="page-head">
        <div><h1>Grupos y permisos</h1><p>Un usuario sin grupo no puede consultar ninguna carpeta.</p></div>
        <div className="actions"><button type="button" className="btn btn-primary" onClick={() => setDialog("new")}><PlusIcon size={14} />Nuevo grupo</button></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="two">
        <div className="card">
          <div className="card-head">
            <div><h2>Grupos de acceso</h2><p>Carpetas que puede consultar cada grupo.</p></div>
            <span className="badge">{groups.length} grupo{groups.length === 1 ? "" : "s"}</span>
          </div>
          {groups.length === 0 && <div className="empty"><div className="ic"><ShieldIcon size={20} /></div><b>Aún no hay grupos</b>Crea uno para dar acceso a carpetas.</div>}
          {groups.map((g) => {
            const members = users.filter((u) => u.group?._id === g._id);
            return (
              <div className="group" key={g._id}>
                <div className="hd">
                  <span className="gi"><ShieldIcon size={16} /></span>
                  <div><b>{g.name}</b><small>{members.length} miembro{members.length === 1 ? "" : "s"} · {g.folders.length} carpeta{g.folders.length === 1 ? "" : "s"}</small></div>
                  {members.length > 0 && (
                    <span className="stack" style={{ marginLeft: "auto" }}>
                      {members.slice(0, 3).map((u, i) => <span key={u._id} className={`avatar sm ${COLORS[i % COLORS.length]}`} title={u.name}>{initialsOf(u.name)}</span>)}
                    </span>
                  )}
                  <div className="acts" style={{ marginLeft: 8 }}>
                    <button type="button" className="btn-icon sm" title="Editar" onClick={() => setDialog(g)}><EditIcon size={15} /></button>
                    <button type="button" className="btn-icon sm" title="Borrar" onClick={() => removeGroup(g)}><TrashIcon size={15} /></button>
                  </div>
                </div>
                <div className="fl">
                  {g.folders.length === 0 ? <span className="badge warn">Sin carpetas</span> : g.folders.map((f) => <span key={f} className="badge"><FolderIcon size={11} />{f}</span>)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="card">
          <div className="card-head"><div><h2>Mensaje de carpeta bloqueada</h2><p>Lo verá quien busque algo que solo existe en una carpeta sin permiso.</p></div></div>
          {folders.length === 0 && <div className="empty"><div className="ic"><FolderIcon size={20} /></div><b>Sin carpetas</b>Todavía no hay carpetas indexadas.</div>}
          {folders.map((f) => (
            <div className="msgset" key={f.folder}>
              <div className="hd"><FolderIcon size={14} filled />{f.folder}</div>
              <textarea className="textarea" rows={2} value={drafts[f.folder] ?? f.blockedMessage ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [f.folder]: e.target.value }))}
                placeholder="Mensaje por defecto: «No tienes permiso para consultar esta carpeta.»" maxLength={300} />
              <div className="ft">
                <span className="help">{f.blockedMessage ? "Personalizado" : "Usa el mensaje por defecto"}</span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={savingMsg === f.folder} onClick={() => saveMessage(f)}>Guardar</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {dialog && (
        <GroupDialog group={dialog === "new" ? null : dialog} folders={folders} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />
      )}
    </div></div>
  );
}
