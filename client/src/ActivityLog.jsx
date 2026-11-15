import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  HomeIcon, ChevronRightIcon, ActivityIcon, EyeIcon, LockIcon, ShieldIcon, UploadIcon, RefreshIcon,
  UserPlusIcon, UsersIcon, EditIcon, TrashIcon, LinkIcon, SendRequestIcon,
} from "./icons";

const META = {
  "document.upload": { label: "subió documento(s) a", k: "admin", Icon: UploadIcon, cls: "info" },
  "folder.create": { label: "creó la carpeta", k: "admin", Icon: ShieldIcon, cls: "acc" },
  "folder.rename": { label: "renombró la carpeta", k: "admin", Icon: EditIcon, cls: "acc" },
  "folder.delete": { label: "movió a la papelera la carpeta", k: "admin", Icon: TrashIcon, cls: "warn" },
  "document.delete": { label: "movió a la papelera", k: "admin", Icon: TrashIcon, cls: "warn" },
  "version.restore": { label: "restauró una versión anterior de", k: "admin", Icon: RefreshIcon, cls: "acc" },
  "trash.restore": { label: "recuperó de la papelera", k: "admin", Icon: RefreshIcon, cls: "acc" },
  "trash.purge": { label: "borró definitivamente", k: "admin", Icon: TrashIcon, cls: "warn" },
  "folder.blocked-message": { label: "cambió el mensaje bloqueado de", k: "admin", Icon: EditIcon, cls: "acc" },
  "library.select": { label: "vinculó biblioteca", k: "admin", Icon: LinkIcon, cls: "info" },
  "library.reindex": { label: "reindexó la biblioteca", k: "admin", Icon: RefreshIcon, cls: "info" },
  "user.create": { label: "creó el usuario", k: "admin", Icon: UserPlusIcon, cls: "acc" },
  "user.update": { label: "editó el usuario", k: "admin", Icon: EditIcon, cls: "acc" },
  "user.delete": { label: "borró el usuario", k: "admin", Icon: TrashIcon, cls: "warn" },
  "user.import": { label: "importó usuarios", k: "admin", Icon: UsersIcon, cls: "acc" },
  "user.password-change": { label: "cambió su contraseña", k: "admin", Icon: LockIcon, cls: "acc" },
  "user.password-reset": { label: "restableció la contraseña de", k: "admin", Icon: LockIcon, cls: "warn" },
  "group.create": { label: "creó el grupo", k: "admin", Icon: ShieldIcon, cls: "acc" },
  "group.update": { label: "editó el grupo", k: "admin", Icon: EditIcon, cls: "acc" },
  "group.delete": { label: "borró el grupo", k: "admin", Icon: TrashIcon, cls: "warn" },
  "search.query": { label: "consultó", k: "view", Icon: EyeIcon, cls: "ok" },
  "search.blocked": { label: "intentó consultar (bloqueado)", k: "block", Icon: LockIcon, cls: "warn" },
  "access.request": { label: "solicitó acceso a", k: "admin", Icon: SendRequestIcon, cls: "info" },
};
const FILTERS = [
  { id: "all", label: "Todo" },
  { id: "view", label: "Consultas", Icon: EyeIcon },
  { id: "block", label: "Bloqueos", Icon: LockIcon },
  { id: "admin", label: "Administración", Icon: ShieldIcon },
];

function dayLabel(date) {
  const d = new Date(date);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "long" });
}

export default function ActivityLog() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("all");

  useEffect(() => { api.activity().then(setItems).catch((e) => setError(e.message)); }, []);

  const filtered = useMemo(() => items.filter((it) => filter === "all" || (META[it.action]?.k || "admin") === filter), [items, filter]);

  let lastDay = "";
  return (
    <div className="page"><div className="page-inner" style={{ maxWidth: 860 }}>
      <div className="crumbs"><HomeIcon size={12} />Administración<ChevronRightIcon size={12} />Registro</div>
      <div className="page-head">
        <div><h1>Registro de actividad</h1><p>Consultas, accesos bloqueados y cambios de administración.</p></div>
      </div>
      <div className="toolbar">
        {FILTERS.map((f) => (
          <button type="button" key={f.id} className={`chip ${filter === f.id ? "on" : ""}`} onClick={() => setFilter(f.id)}>
            {f.Icon && <f.Icon size={13} />}{f.label}
          </button>
        ))}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <div className="timeline">
          {filtered.length === 0 && <div className="empty"><div className="ic"><ActivityIcon size={20} /></div><b>Sin actividad</b>No hay eventos de este tipo.</div>}
          {filtered.map((it) => {
            const day = dayLabel(it.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const meta = META[it.action] || { label: it.action, Icon: ActivityIcon, cls: "" };
            const time = new Date(it.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
            return (
              <div key={it._id}>
                {showDay && <div className="tl-day">{day}</div>}
                <div className="ev">
                  <span className={`ei ${meta.cls}`}><meta.Icon size={14} /></span>
                  <div className="tx"><b>{it.actorName}</b> {meta.label} <span className="obj">{it.target}</span></div>
                  <time>{time}</time>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div></div>
  );
}
