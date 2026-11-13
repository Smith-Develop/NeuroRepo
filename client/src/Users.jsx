import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Gestión de usuarios: solo el admin puede crear o borrar cuentas, y asignarles un grupo de acceso.
// Los usuarios normales no tienen contraseña (entran solo con su DNI); puede haber varios admins,
// cada uno con su propia contraseña.
export default function Users() {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = () => Promise.all([api.users(), api.groups()]).then(([u, g]) => { setItems(u); setGroups(g); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createUser({ name: name.trim(), dni: dni.trim(), role: isAdmin ? "admin" : "user", password: isAdmin ? password : undefined });
      setName("");
      setDni("");
      setIsAdmin(false);
      setPassword("");
      await load();
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

  return (
    <div className="panel">
      <h1>Usuarios</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <form className="note-form user-form" onSubmit={create}>
        <label htmlFor="nn">Nombre</label>
        <input id="nn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre y apellidos" required maxLength={120} />
        <label htmlFor="nd">DNI</label>
        <input id="nd" value={dni} onChange={(e) => setDni(e.target.value)} placeholder="12345678A" required maxLength={40} />
        <label className="app-check">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} /> Administrador
        </label>
        {isAdmin && (
          <>
            <label htmlFor="npw">Contraseña del admin</label>
            <input id="npw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required />
          </>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Importar .txt</button>
          <input ref={fileRef} type="file" accept=".txt" hidden onChange={importFile} />
          <button disabled={busy || !name.trim() || !dni.trim() || (isAdmin && password.length < 4)}>Crear usuario</button>
        </div>
        <small>El .txt lleva una línea por usuario: «Nombre,DNI» (siempre crea usuarios normales).</small>
      </form>
      <ul className="user-list">
        {items.map((u) => (
          <li key={u._id}>
            <span>{u.name}</span>
            <span className="status-tag">{u.dni} · {u.role === "admin" ? "admin" : "usuario"}</span>
            {u.role !== "admin" && (
              <select value={u.group?._id ?? ""} onChange={(e) => changeGroup(u, e.target.value)} disabled={busy}>
                <option value="">Sin grupo</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
              </select>
            )}
            <span className="row-actions">
              {u.role === "admin"
                ? <button type="button" className="link" onClick={() => removeAdmin(u)} disabled={busy}>Quitar admin</button>
                : <button type="button" className="link" onClick={() => makeAdmin(u)} disabled={busy}>Hacer admin</button>}
              <button type="button" className="link danger" onClick={() => remove(u)} disabled={busy}>Borrar</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
