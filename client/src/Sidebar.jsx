import { useEffect, useState } from "react";
import { api } from "./api";
import Docu from "./Docu";
import { ChatIcon, FolderIcon, UsersIcon, ShieldIcon, ActivityIcon, LinkIcon, PlusIcon, LogoutIcon } from "./icons";

const ITEMS = [
  { id: "chat", label: "Asistente", Icon: ChatIcon },
  { id: "documentos", label: "Documentos", Icon: FolderIcon },
];
const ADMIN_ITEMS = [
  { id: "usuarios", label: "Usuarios", Icon: UsersIcon },
  { id: "grupos", label: "Grupos y permisos", Icon: ShieldIcon },
  { id: "registro", label: "Registro", Icon: ActivityIcon },
];

function syncLabel(date) {
  if (!date) return "todavía sin reindexar";
  const d = new Date(date);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `hoy ${time}` : d.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ` ${time}`;
}

export default function Sidebar({ user, view, documentCount, onNavigate, onLogout, onOpenLibrary }) {
  const [userCount, setUserCount] = useState(null);
  const [library, setLibrary] = useState(null);
  const isAdmin = user.role === "admin";
  const initials = (user.name || "?").trim().slice(0, 2).toUpperCase();

  useEffect(() => {
    if (!isAdmin) return;
    api.users().then((u) => setUserCount(u.length)).catch(() => {});
    api.library().then(setLibrary).catch(() => {});
  }, [isAdmin]);

  return (
    <aside className="sidebar" aria-label="Navegación principal">
      <div className="brand">
        <Docu size={32} />
        <span className="name">NeuroRepo<small>Biblioteca documental</small></span>
      </div>
      <button type="button" className="newsearch" onClick={() => onNavigate("chat")}>
        <PlusIcon className="sm" /> <span>Nueva búsqueda</span>
      </button>
      <div className="nav-scroll">
        <div className="nav-label">Buscar</div>
        <ul className="nav">
          {ITEMS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button type="button" className={view === id ? "on" : ""} onClick={() => onNavigate(id)}>
                <Icon /> <span>{label}</span>
                {id === "documentos" && <span className="count">{documentCount}</span>}
              </button>
            </li>
          ))}
        </ul>
        {isAdmin && (
          <>
            <div className="nav-label">Administración</div>
            <ul className="nav">
              {ADMIN_ITEMS.map(({ id, label, Icon }) => (
                <li key={id}>
                  <button type="button" className={view === id ? "on" : ""} onClick={() => onNavigate(id)}>
                    <Icon /> <span>{label}</span>
                    {id === "usuarios" && userCount !== null && <span className="count">{userCount}</span>}
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={onOpenLibrary}>
                  <LinkIcon /> <span>Vincular biblioteca</span>
                </button>
              </li>
            </ul>
          </>
        )}
      </div>
      {isAdmin && library && (
        <div className="lib-status">
          <div className="row"><span className="dot" />Biblioteca sincronizada</div>
          <p>{library.totalDocuments} documento(s) indexados · {syncLabel(library.lastScanAt)}</p>
          <div className="meter"><i /></div>
        </div>
      )}
      <div className="user-row">
        <span className="avatar sm">{initials}</span>
        <span className="who"><b>{user.name}</b><small>{isAdmin ? "Administrador" : "Usuario"}</small></span>
        <button type="button" className="btn-icon sm" title="Cerrar sesión" onClick={onLogout}><LogoutIcon /></button>
      </div>
    </aside>
  );
}
