import { useEffect, useState } from "react";
import { api } from "./api";

function AppMessages({ scenarios, onChanged }) {
  const [drafts, setDrafts] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  async function save(s) {
    setBusyId(s._id);
    setError("");
    try {
      await api.updateScenario(s._id, { blockedMessage: drafts[s._id] ?? s.blockedMessage ?? "" });
      onChanged();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card">
      <h2>Mensaje cuando una app está bloqueada</h2>
      <p className="hint">Lo ve un usuario sin permiso para esta app cuando pregunta algo que solo está ahí.</p>
      {error && <p className="error" role="alert">{error}</p>}
      {scenarios.length === 0 && <p className="hint">Todavía no hay apps creadas.</p>}
      <ul className="app-message-list">
        {scenarios.map((s) => (
          <li key={s._id}>
            <strong>{s.name}</strong>
            <textarea rows={2} value={drafts[s._id] ?? s.blockedMessage ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [s._id]: e.target.value }))}
              placeholder="Mensaje por defecto si lo dejas vacío" maxLength={300} />
            <button type="button" className="ghost small" onClick={() => save(s)} disabled={busyId === s._id}>
              {busyId === s._id ? "Guardando…" : "Guardar"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroupManager({ scenarios }) {
  const [groups, setGroups] = useState([]);
  const [name, setName] = useState("");
  const [apps, setApps] = useState(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api.groups().then(setGroups).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  function toggleApp(id) {
    setApps((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.createGroup({ name: name.trim(), apps: [...apps] });
      setName("");
      setApps(new Set());
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(g) {
    if (!confirm(`¿Borrar el grupo "${g.name}"? Sus usuarios se quedarán sin grupo.`)) return;
    setBusy(true);
    try {
      await api.deleteGroup(g._id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Grupos de acceso</h2>
      <p className="hint">Un usuario sin grupo no puede consultar ninguna app.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <form className="note-form" onSubmit={create}>
        <label htmlFor="gn">Nombre del grupo</label>
        <input id="gn" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
        <label>Apps permitidas</label>
        <div className="app-checks">
          {scenarios.map((s) => (
            <label key={s._id} className="app-check">
              <input type="checkbox" checked={apps.has(s._id)} onChange={() => toggleApp(s._id)} /> {s.name}
            </label>
          ))}
        </div>
        <div className="actions">
          <button disabled={busy || !name.trim()}>Crear grupo</button>
        </div>
      </form>
      <ul className="user-list">
        {groups.map((g) => (
          <li key={g._id}>
            <span>{g.name}</span>
            <span className="status-tag">{g.apps.map((a) => a.name).join(", ") || "sin apps"}</span>
            <button type="button" className="link" onClick={() => remove(g)}>Borrar</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Groups() {
  const [scenarios, setScenarios] = useState([]);
  const [error, setError] = useState("");
  const load = () => api.scenarios().then(setScenarios).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  return (
    <div className="panel">
      <h1>Grupos</h1>
      {error && <p className="error" role="alert">{error}</p>}
      <AppMessages scenarios={scenarios} onChanged={load} />
      <GroupManager scenarios={scenarios} />
    </div>
  );
}
