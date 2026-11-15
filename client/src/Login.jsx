import { useState } from "react";
import { api } from "./api";
import Docu from "./Docu";
import { ActivityIcon, SearchIcon, ShieldIcon } from "./icons";

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
      <div className="login-art">
        <div className="login-grid-bg" />
        <div className="login-art-brand">
          <Docu size={34} />
          <span>Biblioteca<small>Gestor documental</small></span>
        </div>
        <div className="login-quote">
          <div className="halo"><Docu size={72} /></div>
          <h2>Encuentra cualquier documento en segundos.</h2>
          <p>Busca por nombre, tema o palabras clave y obtén el archivo correcto, con los permisos de tu grupo.</p>
        </div>
        <div className="login-feat">
          <span><SearchIcon size={16} /> Búsqueda por nombre, tema o contenido</span>
          <span><ShieldIcon size={16} /> Acceso por grupos y carpetas</span>
          <span><ActivityIcon size={16} /> Registro de cada consulta</span>
        </div>
      </div>
      <div className="login-form-side">
        <form className="login-card" onSubmit={submit}>
          <h1>Inicia sesión</h1>
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
          <p className="login-legal">¿Problemas para entrar? Contacta con el administrador.</p>
        </form>
      </div>
    </div>
  );
}
