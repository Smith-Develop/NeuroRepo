import { useState } from "react";
import { api } from "./api";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api.login(username.trim(), password);
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="avatar login-avatar" aria-hidden="true" />
        <h1>Mi conocimiento</h1>
        <p className="login-sub">Entra para hablar con tu base de conocimiento.</p>
        <label htmlFor="u">Usuario</label>
        <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        <label htmlFor="p">Contraseña</label>
        <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy || !username.trim() || !password}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
