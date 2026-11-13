import { useEffect, useState } from "react";
import { api } from "./api";

const LABELS = {
  "document.upload": "Subió documento(s)",
  "folder.create": "Creó carpeta",
  "folder.rename": "Renombró carpeta",
  "folder.delete": "Borró carpeta",
  "folder.blocked-message": "Cambió el mensaje bloqueado de",
  "library.select": "Vinculó biblioteca",
  "user.create": "Creó usuario",
  "user.update": "Editó usuario",
  "user.delete": "Borró usuario",
  "user.import": "Importó usuarios",
  "group.create": "Creó grupo",
  "group.update": "Editó grupo",
  "group.delete": "Borró grupo",
};

export default function ActivityLog() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.activity().then(setItems).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="panel">
      <h1>Registro de actividad</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {items.length === 0 && !error && <p className="hint">Todavía no hay movimientos registrados.</p>}
      <ul className="activity-list">
        {items.map((it) => (
          <li key={it._id}>
            <time>{new Date(it.createdAt).toLocaleString()}</time>
            <span className="activity-actor">{it.actorName} <small>({it.actorDni})</small></span>
            <span className="activity-action">{LABELS[it.action] || it.action}</span>
            <span className="activity-target">{it.target}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
