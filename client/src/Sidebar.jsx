const ITEMS = [
  { id: "chat", label: "Chat", icon: "💬" },
  { id: "red", label: "Mapa", icon: "🕸️" },
];
const ADMIN_ITEMS = [
  { id: "sugerencias", label: "Sugerencias", icon: "📥" },
  { id: "usuarios", label: "Usuarios", icon: "👥" },
  { id: "grupos", label: "Grupos", icon: "🔒" },
];

export default function Sidebar({ user, view, onNavigate, onLogout, suggestionCount }) {
  const items = user.role === "admin" ? [...ITEMS, ...ADMIN_ITEMS] : ITEMS;
  return (
    <nav className="sidebar" aria-label="Navegación">
      <div className="sidebar-brand">
        <span className="sidebar-dot" aria-hidden="true" />
        Mi conocimiento
      </div>
      <ul className="sidebar-nav">
        {items.map((it) => (
          <li key={it.id}>
            <button type="button" className={view === it.id ? "on" : ""} onClick={() => onNavigate(it.id)}>
              <span aria-hidden="true">{it.icon}</span> {it.label}
              {it.id === "sugerencias" && suggestionCount > 0 && <span className="badge-count">{suggestionCount}</span>}
            </button>
          </li>
        ))}
      </ul>
      <div className="sidebar-foot">
        <div className="sidebar-user">
          <span className="avatar small" aria-hidden="true" />
          <div>
            <strong>{user.username}</strong>
            <small>{user.role === "admin" ? "Administrador" : "Usuario"}</small>
          </div>
        </div>
        <button type="button" className="ghost small" onClick={onLogout}>Cerrar sesión</button>
      </div>
    </nav>
  );
}
