import { useEffect, useState } from "react";
import { api } from "./api";

// Contraseña aleatoria legible (sin caracteres que se confunden: 0/O, 1/l/I)
function randomPassword(length = 14) {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// Gestión de usuarios: solo el admin puede crear o borrar cuentas, y asignarles un grupo de acceso
export default function Users() {
  const [items, setItems] = useState([]);
  const [groups, setGroups] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(null); // id del usuario cuya contraseña se está cambiando
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => Promise.all([api.users(), api.groups()]).then(([u, g]) => { setItems(u); setGroups(g); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createUser({ username: username.trim(), password });
      setUsername("");
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
      await api.updateUserGroup(u._id, group || null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function startReset(u) {
    setResetting(u._id);
    setNewPassword("");
    setNotice("");
    setError("");
  }

  async function resetPassword(e, u) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { closedSessions } = await api.resetPassword(u._id, newPassword);
      setNotice(`Contraseña de «${u.username}» cambiada.${closedSessions ? ` Se cerraron ${closedSessions} sesión(es) abiertas.` : ""} Pásale la nueva contraseña por un canal seguro.`);
      setResetting(null);
      setNewPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(u) {
    if (!confirm(`¿Borrar el usuario "${u.username}"?`)) return;
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

  return (
    <div className="panel">
      <h1>Usuarios</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <form className="note-form user-form" onSubmit={create}>
        <label htmlFor="nu">Nuevo usuario</label>
        <input id="nu" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="nombre de usuario" required maxLength={80} />
        <label htmlFor="np">Contraseña</label>
        <input id="np" type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={4} required />
        <div className="actions">
          <button disabled={busy || !username.trim() || password.length < 4}>Crear usuario</button>
        </div>
      </form>
      <ul className="user-list">
        {items.map((u) => (
          <li key={u._id}>
            <span>{u.username}</span>
            <span className="status-tag">{u.role}</span>
            {u.role !== "admin" && (
              <select value={u.group?._id ?? ""} onChange={(e) => changeGroup(u, e.target.value)} disabled={busy}>
                <option value="">Sin grupo</option>
                {groups.map((g) => <option key={g._id} value={g._id}>{g.name}</option>)}
              </select>
            )}
            <span className="row-actions">
              <button type="button" className="link" onClick={() => (resetting === u._id ? setResetting(null) : startReset(u))}>
                {resetting === u._id ? "Cancelar" : "Resetear contraseña"}
              </button>
              {u.role !== "admin" && <button type="button" className="link danger" onClick={() => remove(u)}>Borrar</button>}
            </span>
            {resetting === u._id && (
              <form className="reset-form" onSubmit={(e) => resetPassword(e, u)}>
                <label htmlFor={`rp-${u._id}`}>Nueva contraseña para «{u.username}»</label>
                <div className="reset-row">
                  {/* Visible a propósito: el admin tiene que poder copiarla y dársela al usuario */}
                  <input id={`rp-${u._id}`} type="text" autoComplete="new-password" spellCheck={false} value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} minLength={4} maxLength={200} required autoFocus />
                  <button type="button" className="ghost" onClick={() => setNewPassword(randomPassword())}>Generar</button>
                  <button disabled={busy || newPassword.trim().length < 4}>Guardar</button>
                </div>
                <small>Mínimo 4 caracteres. Al guardar se cerrarán las sesiones abiertas de este usuario.</small>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
