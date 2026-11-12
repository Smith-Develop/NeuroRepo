import { useEffect, useState } from "react";
import { api } from "./api";

// Gestión de usuarios: solo el admin puede crear o borrar cuentas
export default function Users() {
  const [items, setItems] = useState([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.users().then(setItems).catch((e) => setError(e.message));
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
            {u.role !== "admin" && <button type="button" className="link" onClick={() => remove(u)}>Borrar</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
