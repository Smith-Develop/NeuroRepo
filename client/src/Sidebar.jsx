import Docu from "./Docu";
import { ChatIcon, FolderIcon, UsersIcon, ShieldIcon, ActivityIcon, LinkIcon, PlusIcon } from "./icons";

const ITEMS = [
  { id: "chat", label: "Asistente", Icon: ChatIcon },
  { id: "documentos", label: "Documentos", Icon: FolderIcon },
];
const ADMIN_ITEMS = [
  { id: "usuarios", label: "Usuarios", Icon: UsersIcon },
  { id: "grupos", label: "Grupos y permisos", Icon: ShieldIcon },
  { id: "registro", label: "Registro", Icon: ActivityIcon },
];

export default function Sidebar({ user, view, onNavigate, onLogout, onOpenLibrary, onNewSearch, docCount, libraryStatus }) {
  const initials = (user.name || "?").trim().slice(0, 2).toUpperCase();
  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="sidebar-brand">
        <Docu size={26} animated={false} />
        <span>Biblioteca</span>
      </div>
      <button type="button" className="newsearch" onClick={onNewSearch}>
        <PlusIcon /> <span>Nueva búsqueda</span> <span className="kbd">⌘K</span>
      </button>
      <div className="sidebar-scroll">
        <div className="sidebar-section">Buscar</div>
        <ul className="sidebar-nav">
          {ITEMS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button type="button" className={view === id ? "on" : ""} onClick={() => onNavigate(id)}>
                <Icon /> <span>{label}</span>
                {id === "documentos" && <span className="count">{docCount}</span>}
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
      {user.role === "admin" && (
        <div className="lib-status">
          <div className="row"><span className="dot" /> Biblioteca sincronizada</div>
          <p>
            {libraryStatus ? `${libraryStatus.totalDocuments} documentos indexados` : "Cargando estado…"}
            {libraryStatus?.lastScanAt ? ` · ${new Date(libraryStatus.lastScanAt).toLocaleString()}` : ""}
          </p>
          <div className="meter"><i style={{ width: libraryStatus ? "100%" : "35%" }} /></div>
        </div>
      )}
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
