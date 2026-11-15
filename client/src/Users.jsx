import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import RowMenu from "./RowMenu";
import Crumbs from "./Crumbs";
import { toast } from "./toast";
import { SearchIcon, ShieldIcon, TrashIcon, UserPlusIcon, UsersIcon, UploadIcon } from "./icons";

// Gestión de usuarios: solo el admin puede crear o borrar cuentas, y asignarles un grupo de acceso.
// Los usuarios normales no tienen contraseña (entran solo con su DNI); puede haber varios admins,
// cada uno con su propia contraseña.
export default function Users() {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [activity, setActivity] = useState([]);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => Promise.all([api.users(), api.groups()]).then(([u, g]) => { setItems(u); setGroups(g); }).catch((e) => setError(e.message));
  useEffect(() => { load(); api.activity().then(setActivity).catch(() => {}); }, []);

  function closeDialog() {
    setOpen(false);
    setName(""); setDni(""); setIsAdmin(false); setPassword("");
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createUser({ name: name.trim(), dni: dni.trim(), role: isAdmin ? "admin" : "user", password: isAdmin ? password : undefined });
      closeDialog();
      await load();
      toast(`Usuario ${name.trim()} creado`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

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
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const q = filter.trim().toLowerCase();
  const rows = items.filter((u) => !q || u.name.toLowerCase().includes(q) || u.dni.toLowerCase().includes(q));
  const admins = items.filter((u) => u.role === "admin").length;
  const noGroup = items.filter((u) => u.role !== "admin" && !u.group).length;
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const searchesToday = activity.filter((a) => a.action === "search.query" && sameDay(a.createdAt, Date.now())).length;
  const searchesYesterday = activity.filter((a) => a.action === "search.query" && sameDay(a.createdAt, Date.now() - 86400000)).length;
  const trend = searchesYesterday > 0 ? Math.round(((searchesToday - searchesYesterday) / searchesYesterday) * 100) : null;

  return (
    <div className="panel">
      <Crumbs items={["Administración", "Usuarios"]} />
      <div className="page-head">
        <div><h1>Usuarios</h1><p>Gestiona quién puede entrar y a qué grupo pertenece cada persona.</p></div>
        <div className="actions" style={{ margin: 0 }}>
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}><UploadIcon size={15} /> Importar .txt</button>
          <input ref={fileRef} type="file" accept=".txt" hidden onChange={importFile} />
          <button type="button" className="btn-accent" onClick={() => setOpen(true)}><UserPlusIcon size={15} /> Nuevo usuario</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <small>El .txt lleva una línea por usuario: «Nombre,DNI» (siempre crea usuarios normales).</small>

      <div className="stats">
        <div className="stat"><div className="k"><UsersIcon size={14} /> Usuarios</div><div className="v">{items.length}</div></div>
        <div className="stat"><div className="k"><ShieldIcon size={14} /> Administradores</div><div className="v">{admins}</div></div>
        <div className="stat"><div className="k">Sin grupo</div><div className="v">{noGroup}</div></div>
        <div className="stat">
          <div className="k"><SearchIcon size={14} /> Búsquedas hoy</div>
          <div className="v">{searchesToday}{trend !== null && <span style={{ fontSize: ".7rem", color: trend >= 0 ? "var(--ok)" : "var(--danger)", marginLeft: 6, fontWeight: 500 }}>{trend >= 0 ? "+" : ""}{trend}%</span>}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="input-icon"><SearchIcon size={15} /><input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar por nombre o DNI…" aria-label="Buscar usuarios" /></div>
      </div>

      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>Usuario</th><th>DNI</th><th>Rol</th><th>Grupo</th><th style={{ width: 40 }}></th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="muted">Nadie coincide con esa búsqueda.</td></tr>}
            {rows.map((u) => (
              <tr key={u._id}>
                <td><span className="tree-name"><span className="avatar small avatar-user">{u.name.trim().slice(0, 2).toUpperCase()}</span><span className="nm">{u.name}</span></span></td>
                <td className="muted">{u.dni}</td>
                <td>{u.role === "admin" ? <span className="folder-badge"><ShieldIcon size={12} /> Admin</span> : <span className="folder-badge">Usuario</span>}</td>
                <td>
                  {u.role === "admin"
                    ? <span className="muted">Acceso total</span>
                    : (
                      <select value={u.group?._id ?? ""} onChange={(e) => changeGroup(u, e.target.value)} disabled={busy} style={{ width: "auto" }}>
                        <option value="">Sin grupo</option>
                        {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
                      </select>
                    )}
                </td>
                <td>
                  <div className="row-end">
                    <RowMenu items={[
                      u.role === "admin"
                        ? { label: "Quitar admin", icon: ShieldIcon, onClick: () => removeAdmin(u) }
                        : { label: "Hacer admin", icon: ShieldIcon, onClick: () => makeAdmin(u) },
                      "-",
                      { label: "Borrar usuario", icon: TrashIcon, danger: true, onClick: () => remove(u) },
                    ]} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <div className="modal-backdrop" onClick={() => !busy && closeDialog()}>
          <form className="drawer" onClick={(e) => e.stopPropagation()} onSubmit={create}>
            <button type="button" className="close" onClick={closeDialog} aria-label="Cerrar">×</button>
            <h2>Nuevo usuario</h2>
            <p className="hint" style={{ textAlign: "left", marginBottom: 14 }}>El DNI será su usuario de acceso.</p>
            <div className="field">
              <label htmlFor="nn">Nombre y apellidos</label>
              <input id="nn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" required maxLength={120} />
            </div>
            <div className="field">
              <label htmlFor="nd">DNI</label>
              <input id="nd" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678A" required maxLength={40} />
            </div>
            <label className="check"><input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Dar permisos de administrador</label>
            {isAdmin && (
              <div className="field">
                <label htmlFor="npw">Contraseña del admin</label>
                <input id="npw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required />
              </div>
            )}
            <div className="actions">
              <button type="button" className="ghost" onClick={closeDialog}>Cancelar</button>
              <button type="submit" className="btn-accent" disabled={busy || !name.trim() || !dni.trim() || (isAdmin && password.length < 4)}>Crear usuario</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
