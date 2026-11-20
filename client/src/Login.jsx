import { useState } from "react";
import { api } from "./api";
import Docu from "./Docu";
import { SearchIcon, ShieldIcon, ActivityIcon } from "./icons";

// Acceso: los usuarios normales entran solos desde un ordenador con IP asignada (lo resuelve /me). Si no,
// según el modo: «ip-or-dni» → escribiendo el DNI; «ip-only» → solo los admins, con su contraseña.
export default function Login({ onLogin, loginMode = "ip-or-dni", ip }) {
  const ipOnly = loginMode === "ip-only";
  const [adminForm, setAdminForm] = useState(false);
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

  async function enterWithThisComputer() {
    setBusy(true);
    setError("");
    try {
      const { user } = await api.loginIp();
      onLogin(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  const showForm = !ipOnly || adminForm;

  return (
    <div className="login" role="dialog" aria-modal="true" aria-labelledby="loginT">
      <div className="art">
        <div className="grid-bg" />
        <div className="brand" style={{ padding: 0 }}>
          <Docu size={34} />
          <span className="name">DocuPaz<small>Biblioteca documental</small></span>
        </div>
        <div className="quote">
          <Docu size={72} />
          <h2>Encuentra cualquier documento en segundos.</h2>
          <p>Pregunta a Docu como hablarías con un compañero y obtén el archivo correcto, con los permisos de tu equipo.</p>
        </div>
        <div className="feat">
          <span><SearchIcon /> Búsqueda por nombre, tema o contenido</span>
          <span><ShieldIcon /> Acceso por grupos y carpetas</span>
          <span><ActivityIcon /> Registro de cada consulta</span>
        </div>
      </div>
      <div className="form-side">
        <form onSubmit={submit}>
          <h1 id="loginT">{showForm ? (ipOnly ? "Acceso de administrador" : "Inicia sesión") : "No tienes permiso"}</h1>
          {!showForm && (
            <>
              <p className="lead">
                Este ordenador{ip ? <> (IP <b>{ip}</b>)</> : ""} no tiene acceso a DocuPaz. Si deberías poder entrar,
                pide a Informática que asigne esta IP a tu usuario.
              </p>
              {error && <p className="error" role="alert">{error}</p>}
              <button type="button" className="btn btn-primary btn-lg" onClick={enterWithThisComputer} disabled={busy}>
                {busy ? "Comprobando…" : "Volver a intentarlo con este ordenador"}
              </button>
              <button type="button" className="link" style={{ alignSelf: "center" }} onClick={() => { setAdminForm(true); setError(""); }}>Entrar como administrador</button>
            </>
          )}
          {showForm && <>
          <p className="lead">{ipOnly ? "Solo los administradores entran con DNI y contraseña." : "Entra con tu DNI para buscar y consultar documentos."}</p>
          <div className="field">
            <label htmlFor="d">DNI / NIE</label>
            <input className="input" id="d" style={{ height: 42 }} value={dni}
              onChange={(e) => { setDni(e.target.value); setNeedsPassword(false); setError(""); }}
              autoFocus required autoCapitalize="characters" placeholder="11111111A" autoComplete="username" />
          </div>
          {needsPassword && (
            <div className="field">
              <label htmlFor="p">Contraseña</label>
              <input className="input" id="p" style={{ height: 42 }} type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required autoFocus autoComplete="current-password" />
            </div>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-lg" disabled={busy || !dni.trim() || (needsPassword && !password)}>
            {busy ? "Entrando…" : "Entrar"}
          </button>
          {ipOnly
            ? <button type="button" className="link" style={{ alignSelf: "center" }} onClick={() => { setAdminForm(false); setError(""); }}>Volver</button>
            : <button type="button" className="link" style={{ alignSelf: "center" }} onClick={enterWithThisComputer} disabled={busy}>Entrar con este ordenador</button>}
          </>}
          <p className="legal">¿Problemas para entrar? Contacta con el equipo de sistemas.</p>
          <p className="legal copyright">© {new Date().getFullYear()} Smith Grisales · Todos los derechos reservados</p>
        </form>
      </div>
    </div>
  );
}
