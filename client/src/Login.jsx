import { useState } from "react";
import { api } from "./api";

export default function Login({ onLogin }) {
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api.login(dni.trim(), needsPassword ? password : undefined);
      onLogin(user);
    } catch (err) {
      if (err.needsPassword) setNeedsPassword(true);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="avatar login-avatar" aria-hidden="true" />
        <h1>Biblioteca de documentos</h1>
        <p className="login-sub">Entra con tu DNI para buscar y consultar documentos.</p>
        <label htmlFor="d">DNI</label>
        <input id="d" value={dni} onChange={(e) => { setDni(e.target.value); setNeedsPassword(false); }} autoFocus required autoCapitalize="characters" />
        {needsPassword && (
          <>
            <label htmlFor="p">Contraseña</label>
            <input id="p" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy || !dni.trim() || (needsPassword && !password)}>{busy ? "Entrando…" : "Entrar"}</button>
      </form>
    </div>
  );
}
