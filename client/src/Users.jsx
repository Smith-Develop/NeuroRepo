import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";
import { UploadIcon, UserPlusIcon, UsersIcon, ShieldIcon, LockIcon, DotsIcon, TrashIcon, XIcon, HomeIcon, ChevronRightIcon } from "./icons";

const COLORS = ["", "c2", "c3", "c4"];
const initialsOf = (name) => (name || "?").trim().split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

function UserDialog({ groups, onClose, onCreated }) {
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
  const [group, setGroup] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createUser({ name: name.trim(), dni: dni.trim(), role: isAdmin ? "admin" : "user", group: isAdmin ? undefined : group || undefined, password: isAdmin ? password : undefined });
      toast(`Usuario ${name.trim()} creado`);
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="userT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <div className="dlg-head">
          <div className="tt"><h3 id="userT">Nuevo usuario</h3><p>El DNI será su usuario de acceso.</p></div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          <div className="field"><label htmlFor="uName">Nombre y apellidos</label><input className="input" id="uName" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="María López Ruiz" /></div>
          <div className="field"><label htmlFor="uDni">DNI / NIE</label><input className="input" id="uDni" required maxLength={40} value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678A" /></div>
          {!isAdmin && (
            <div className="field">
              <label htmlFor="uGroup">Grupo</label>
              <select className="select" id="uGroup" value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">Sin grupo</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
              </select>
            </div>
          )}
          <label className="check"><span className="switch"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /><span /></span>Dar permisos de administrador</label>
          {isAdmin && (
            <div className="field"><label htmlFor="uPw">Contraseña del admin</label><input className="input" id="uPw" type="password" minLength={4} required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="dlg-foot">
          <span className="help">Para altas masivas usa «Importar .txt» (Nombre,DNI por línea).</span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !dni.trim() || (isAdmin && password.length < 4)}>Crear usuario</button>
        </div>
      </form>
    </div>
  );
}

function UserMenu({ anchorRef, u, onClose, onMakeAdmin, onRemoveAdmin, onDelete }) {
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(8, r.right - 200), top: r.bottom + 6 });
  }, [anchorRef]);
  useEffect(() => {
    function onDoc(e) { if (!e.target.closest(".menu")) onClose(); }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [onClose]);
  if (!pos) return null;
  return (
    <div className="menu" style={{ left: pos.left, top: pos.top }} role="menu">
      {u.role === "admin"
        ? <button type="button" onClick={() => { onClose(); onRemoveAdmin(u); }}><ShieldIcon size={14} />Quitar administrador</button>
        : <button type="button" onClick={() => { onClose(); onMakeAdmin(u); }}><ShieldIcon size={14} />Hacer administrador</button>}
      <hr />
      <button type="button" className="danger" onClick={() => { onClose(); onDelete(u); }}><TrashIcon size={14} />Borrar usuario</button>
    </div>
  );
}

// Gestión de usuarios: solo el admin puede crear o borrar cuentas, y asignarles un grupo de acceso.
// Los usuarios normales no tienen contraseña (entran solo con su DNI); puede haber varios admins,
// cada uno con su propia contraseña.
export default function Users({ currentUser }) {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [menuFor, setMenuFor] = useState(null);
  const fileRef = useRef(null);
  const rowRefs = useRef({});

  const load = () => Promise.all([api.users(), api.groups()]).then(([u, g]) => { setItems(u); setGroups(g); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function changeGroup(u, group) {
    setBusy(true);
    try {
      await api.updateUser(u._id, { group: group || null });
      await load();
      const g = groups.find((x) => x._id === group);
      toast(`${u.name} → ${g ? g.name : "Sin grupo"}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function makeAdmin(u) {
    const pw = prompt(`Contraseña para el nuevo admin «${u.name}» (mín. 4 caracteres):`);
    if (!pw) return;
    setBusy(true);
    setError("");
    try {
      await api.updateUser(u._id, { role: "admin", password: pw });
      await load();
      toast(`Rol de ${u.name} actualizado`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeAdmin(u) {
    if (u.dni === currentUser?.dni) return toast("No puedes quitarte tu propio rol");
    if (!confirm(`¿Quitarle el rol de admin a «${u.name}»? Entrará solo con su DNI, sin contraseña.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.updateUser(u._id, { role: "user" });
      await load();
      toast(`Rol de ${u.name} actualizado`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u) {
    if (u.dni === currentUser?.dni) return toast("No puedes borrar tu propia cuenta");
    if (!confirm(`¿Borrar el usuario "${u.name}"?`)) return;
    setBusy(true);
    setError("");
    try {
      await api.deleteUser(u._id);
      await load();
      toast(`${u.name} eliminado`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const text = await file.text();
      const r = await api.importUsers(text);
      setNotice(`Importación: ${r.created} creado(s), ${r.updated} actualizado(s)${r.skipped ? `, ${r.skipped} línea(s) con error` : ""}.`);
      toast(`${r.created} usuario(s) importados`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const q = filter.trim().toLowerCase();
  const rows = items.filter((u) => !q || (u.name + u.dni).toLowerCase().includes(q));
  const admins = items.filter((u) => u.role === "admin").length;
  const noGroup = items.filter((u) => u.role !== "admin" && !u.group).length;

  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><HomeIcon size={12} />Administración<ChevronRightIcon size={12} />Usuarios</div>
      <div className="page-head">
        <div><h1>Usuarios</h1><p>Gestiona quién puede entrar y a qué grupo pertenece cada persona.</p></div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy}><UploadIcon size={14} />Importar .txt</button>
          <input ref={fileRef} type="file" accept=".txt" hidden onChange={importFile} />
          <button type="button" className="btn btn-primary" onClick={() => setDialogOpen(true)}><UserPlusIcon size={14} />Nuevo usuario</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="k"><UsersIcon size={14} />Usuarios</div><div className="v">{items.length}</div></div>
        <div className="stat"><div className="k"><ShieldIcon size={14} />Administradores</div><div className="v">{admins}</div></div>
        <div className="stat"><div className="k"><LockIcon size={14} />Sin grupo</div><div className="v">{noGroup}</div></div>
        <div className="stat"><div className="k"><ShieldIcon size={14} />Grupos</div><div className="v">{groups.length}</div></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <div className="toolbar">
        <div className="input-icon"><UsersIcon size={15} /><input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por nombre o DNI…" aria-label="Buscar usuarios" /></div>
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <table className="table">
          <thead><tr><th>Usuario</th><th className="hide-sm">DNI</th><th>Rol</th><th>Grupo</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5}><div className="empty"><div className="ic"><UsersIcon size={20} /></div><b>Nadie coincide</b>Revisa el nombre o el DNI.</div></td></tr>
            )}
            {rows.map((u, i) => (
              <tr key={u._id}>
                <td>
                  <span className="tree-name">
                    <span className={`avatar sm ${COLORS[i % COLORS.length]}`}>{initialsOf(u.name)}</span>
                    <b style={{ fontWeight: 500 }}>{u.name}</b>
                    {u.dni === currentUser?.dni && <span className="badge" style={{ height: 18, fontSize: 10.5, marginLeft: 6 }}>Tú</span>}
                  </span>
                </td>
                <td className="muted hide-sm" style={{ fontVariantNumeric: "tabular-nums" }}>{u.dni}</td>
                <td>{u.role === "admin" ? <span className="badge accent"><span className="dot" />Admin</span> : <span className="badge"><span className="dot" />Usuario</span>}</td>
                <td>
                  {u.role === "admin" ? <span className="badge accent"><ShieldIcon size={12} />Acceso total</span> : (
                    <>
                      <select className="select" style={{ height: 30, width: "auto", minWidth: 170, fontSize: 12.5 }} value={u.group?._id ?? ""} onChange={(e) => changeGroup(u, e.target.value)} disabled={busy} aria-label={`Grupo de ${u.name}`}>
                        <option value="">Sin grupo</option>
                        {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                      </select>
                      {!u.group && <span className="badge warn" style={{ marginLeft: 6 }} title="Sin grupo no puede consultar nada">Sin acceso</span>}
                    </>
                  )}
                </td>
                <td>
                  <button type="button" className="btn-icon sm" aria-label="Acciones" ref={(el) => (rowRefs.current[u._id] = el)}
                    onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === u._id ? null : u._id); }}><DotsIcon size={15} /></button>
                  {menuFor === u._id && (
                    <UserMenu anchorRef={{ current: rowRefs.current[u._id] }} u={u} onClose={() => setMenuFor(null)}
                      onMakeAdmin={makeAdmin} onRemoveAdmin={removeAdmin} onDelete={remove} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dialogOpen && (
        <UserDialog groups={groups} onClose={() => setDialogOpen(false)} onCreated={() => { setDialogOpen(false); load(); }} />
      )}
    </div></div>
  );
}
