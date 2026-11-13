const ITEMS = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "documentos", label: "Documentos", icon: "🗂️" },
];
const ADMIN_ITEMS = [
  { id: "usuarios", label: "Usuarios", icon: "👥" },
  { id: "grupos", label: "Grupos", icon: "🔒" },
  { id: "registro", label: "Registro", icon: "🧾" },
];

export default function Sidebar({ user, view, onNavigate, onLogout, onOpenLibrary }) {
  const items = user.role === "admin" ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS;
  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="sidebar-brand">
        <span className="sidebar-dot" aria-hidden="true" />
        Biblioteca
      </div>
      <ul className="sidebar-nav">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className={view === it.id ? "on" : ""} onClick={() => onNavigate(it.id)}>
              <span aria-hidden="true">{it.icon}</span> {it.label}
            </button>
          </li>
        ))}
        {user.role === "admin" && (
          <li>
            <button type="button" onClick={onOpenLibrary}>
              <span aria-hidden="true">📎</span> Vincular biblioteca
            </button>
          </li>
        )}
      </ul>
      <div className="sidebar-foot">
        <div className="sidebar-user">
          <span className="avatar small" aria-hidden="true" />
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
