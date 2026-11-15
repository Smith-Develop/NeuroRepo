import { useEffect, useState } from "react";
import { api } from "./api";

const LABELS = {
  "document.upload": "Subió documento(s) a",
  "folder.create": "Creó la carpeta",
  "folder.rename": "Renombró la carpeta",
  "folder.delete": "Borró la carpeta",
  "folder.blocked-message": "Cambió el mensaje bloqueado de",
  "library.select": "Vinculó biblioteca",
  "user.create": "creó el usuario",
  "user.update": "editó el usuario",
  "user.delete": "borró el usuario",
  "user.import": "importó usuarios",
  "group.create": "creó el grupo",
  "group.update": "editó el grupo",
  "group.delete": "borró el grupo",
  "search.query": "consultó",
  "search.blocked": "intentó consultar (bloqueado)",
  "access.request": "solicitó acceso a",
};

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(new Date(date), new Date(Date.now() - 86400000))) return "ayer";
  return new Date(date).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

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
            <time>{timeAgo(it.createdAt)}</time>
            <span className="activity-actor">{it.actorName} <small>({it.actorDni})</small></span>
            <span className="activity-action">{LABELS[it.action] || it.action}</span>
            <span className="activity-target">{it.target}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
