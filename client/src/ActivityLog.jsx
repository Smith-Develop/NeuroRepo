import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import Crumbs from "./Crumbs";
import { EditIcon, EyeIcon, FolderIcon, LinkIcon, LockIcon, PlusIcon, SendIcon, ShieldIcon, TrashIcon, UploadIcon, UserPlusIcon } from "./icons";

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
  "search.query": "Buscó",
  "search.blocked": "Intentó consultar (bloqueado)",
  "access.request": "Solicitó acceso a",
};
const CATEGORY = (action) => action === "search.query" ? "view" : action === "search.blocked" ? "block" : "admin";
const ICON = {
  "document.upload": [UploadIcon, "info"], "folder.create": [PlusIcon, "acc"], "folder.rename": [EditIcon, "acc"],
  "folder.delete": [TrashIcon, ""], "folder.blocked-message": [ShieldIcon, "acc"], "library.select": [LinkIcon, "info"],
  "user.create": [UserPlusIcon, "acc"], "user.update": [EditIcon, "acc"], "user.delete": [TrashIcon, ""], "user.import": [UploadIcon, "info"],
  "group.create": [ShieldIcon, "acc"], "group.update": [EditIcon, "acc"], "group.delete": [TrashIcon, ""],
  "search.query": [EyeIcon, "ok"], "search.blocked": [LockIcon, "warn"], "access.request": [SendIcon, "warn"],
};
const FILTERS = [["all", "Todo"], ["view", "Consultas"], ["block", "Bloqueos"], ["admin", "Administración"]];

function dayLabel(date) {
  const d = new Date(date), today = new Date(), yest = new Date(Date.now() - 86400000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  if (sameDay(d, today)) return "Hoy";
  if (sameDay(d, yest)) return "Ayer";
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
}

export default function ActivityLog() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    api.activity().then(setItems).catch((e) => setError(e.message));
  }, []);

  const filtered = useMemo(() => items.filter((it) => filter === "all" || CATEGORY(it.action) === filter), [items, filter]);
  const groups = useMemo(() => {
    const out = [];
    let lastDay = null;
    for (const it of filtered) {
      const day = dayLabel(it.createdAt);
      if (day !== lastDay) { out.push({ day, items: [] }); lastDay = day; }
      out[out.length - 1].items.push(it);
    }
    return out;
  }, [filtered]);

  return (
    <div className="panel">
      <Crumbs items={["Administración", "Registro"]} />
      <div className="page-head">
        <div><h1>Registro de actividad</h1><p>Consultas, bloqueos y cambios de administración.</p></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="log-filters">
        {FILTERS.map(([key, label]) => (
          <button type="button" key={key} className={`folder-chip${filter === key ? " on" : ""}`} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>
      <div className="card">
        {items.length === 0 && !error && <p className="hint" style={{ padding: "18px" }}>Todavía no hay movimientos registrados.</p>}
        {items.length > 0 && filtered.length === 0 && <p className="hint" style={{ padding: "18px" }}>Nada coincide con este filtro.</p>}
        <div className="timeline">
          {groups.map((g) => (
            <div key={g.day}>
              <div className="tl-day">{g.day}</div>
              <ul className="activity-list">
                {g.items.map((it) => {
                  const [Icon, cls] = ICON[it.action] || [FolderIcon, ""];
                  return (
                    <li key={it._id}>
                      <span className={`activity-ic ${cls}`}><Icon size={14} /></span>
                      <span className="activity-body">
                        <span className="activity-actor">{it.actorName} <small>({it.actorDni})</small></span>{" "}
                        <span className="activity-action">{LABELS[it.action] || it.action}</span>{" "}
                        <span className="activity-target">{it.target}</span>
                      </span>
                      <time>{new Date(it.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</time>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
