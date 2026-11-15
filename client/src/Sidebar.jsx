import Docu from "./Docu";
import { ChatIcon, FolderIcon, UsersIcon, ShieldIcon, ActivityIcon, LinkIcon } from "./icons";

const ITEMS = [
  { id: "chat", label: "Chat", Icon: ChatIcon },
  { id: "documentos", label: "Documentos", Icon: FolderIcon },
];
const ADMIN_ITEMS = [
  { id: "usuarios", label: "Usuarios", Icon: UsersIcon },
  { id: "grupos", label: "Grupos", Icon: ShieldIcon },
  { id: "registro", label: "Registro", Icon: ActivityIcon },
];

export default function Sidebar({ user, view, onNavigate, onLogout, onOpenLibrary }) {
  const initials = (user.name || "?").trim().slice(0, 2).toUpperCase();
  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="sidebar-brand">
        <Docu size={26} animated={false} />
        <span>Biblioteca</span>
      </div>
      <div className="sidebar-scroll">
        <div className="sidebar-section">Buscar</div>
        <ul className="sidebar-nav">
          {ITEMS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button type="button" className={view === id ? "on" : ""} onClick={() => onNavigate(id)}>
                <Icon /> <span>{label}</span>
              </button>
            </li>
          ))}
        </ul>
        {user.role === "admin" && (
          <>
            <div className="sidebar-section">Administración</div>
            <ul className="sidebar-nav">
              {ADMIN_ITEMS.map(({ id, label, Icon }) => (
                <li key={id}>
                  <button type="button" className={view === id ? "on" : ""} onClick={() => onNavigate(id)}>
                    <Icon /> <span>{label}</span>
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
      <div className="sidebar-foot">
        <div className="sidebar-user">
          <span className="avatar small avatar-user" aria-hidden="true">{initials}</span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.role === "admin" ? "Administrador" : "Usuario"}</small>
          </div>
        </div>
        <button type="button" className="ghost small" onClick={onLogout}>Cerrar sesión</button>
      </div>
    </nav>
  );
}
