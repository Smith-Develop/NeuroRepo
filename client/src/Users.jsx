import { useEffect, useRef, useState } from "react";
import { api } from "./api";

// Gestión de usuarios: solo el admin puede crear o borrar cuentas, y asignarles un grupo de acceso.
// Los usuarios normales no tienen contraseña: entran solo con su DNI.
export default function Users() {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
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
      await api.createUser({ name: name.trim(), dni: dni.trim() });
      setName("");
      setDni("");
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

  async function remove(u) {
    if (!confirm(`¿Borrar el usuario "${u.name}"?`)) return;
    setBusy(true);
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
        <div className="actions">
          <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>Importar .txt</button>
          <input ref={fileRef} type="file" accept=".txt" hidden onChange={importFile} />
          <button disabled={busy || !name.trim() || !dni.trim()}>Crear usuario</button>
        </div>
        <small>El .txt lleva una línea por usuario: «Nombre,DNI».</small>
      </form>
      <ul className="user-list">
        {items.map((u) => (
          <li key={u._id}>
            <span>{u.name}</span>
            <span className="status-tag">{u.dni}</span>
            {u.role !== "admin" && (
              <select value={u.group?._id ?? ""} onChange={(e) => changeGroup(u, e.target.value)} disabled={busy}>
                <option value="">Sin grupo</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
              </select>
            )}
            {u.role !== "admin" && (
              <span className="row-actions">
                <button type="button" className="link danger" onClick={() => remove(u)}>Borrar</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
