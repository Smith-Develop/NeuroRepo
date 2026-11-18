import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import Docu from "./Docu";
import { toast } from "./toast";
import { getTheme, setTheme } from "./theme";
import { ChatIcon, FolderIcon, UsersIcon, ShieldIcon, ActivityIcon, LinkIcon, PlusIcon, LogoutIcon, KeyIcon, XIcon, SunIcon, InfoIcon, StarIcon, BookIcon } from "./icons";
import { listConversations, onHistoryChange } from "./chatHistory";
import AboutDialog from "./AboutDialog";

const ITEMS = [
  { id: "chat", label: "Asistente", Icon: ChatIcon },
  { id: "documentos", label: "Documentos", Icon: FolderIcon },
  { id: "favoritos", label: "Favoritos", Icon: StarIcon },
];
const ADMIN_ITEMS = [
  { id: "usuarios", label: "Usuarios", Icon: UsersIcon },
  { id: "grupos", label: "Grupos y permisos", Icon: ShieldIcon },
  { id: "guia", label: "Guía rápida", Icon: BookIcon },
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

export default function Sidebar({ user, view, documentCount, favoriteCount, conversationId, onNewSearch, onOpenConversation, onDeleteConversation, onNavigate, onLogout, onOpenLibrary }) {
  const [conversations, setConversations] = useState(() => listConversations(user._id));
  useEffect(() => {
    const refresh = () => setConversations(listConversations(user._id));
    refresh();
    return onHistoryChange(refresh);
  }, [user._id]);
  const [userCount, setUserCount] = useState(null);
  const [library, setLibrary] = useState(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [light, setLight] = useState(() => getTheme() === "light");
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
        <span className="name">DocuPaz<small>Biblioteca documental</small></span>
      </div>
      <button type="button" className="newsearch" onClick={onNewSearch}>
        <PlusIcon className="sm" /> <span>Nueva búsqueda</span>
      </button>
      <div className="nav-scroll">
        <div className="nav-label">Buscar</div>
        <ul className="nav">
          {(!isAdmin && user.canEditGuide ? [...ITEMS, { id: "guia", label: "Guía rápida", Icon: BookIcon }] : ITEMS).map(({ id, label, Icon }) => (
            <li key={id}>
              <button type="button" className={view === id ? "on" : ""} onClick={() => onNavigate(id)}>
                <Icon /> <span>{label}</span>
                {id === "documentos" && <span className="count">{documentCount}</span>}
                {id === "favoritos" && favoriteCount > 0 && <span className="count">{favoriteCount}</span>}
              </button>
            </li>
          ))}
        </ul>
        {conversations.length > 0 && (
          <>
            <div className="nav-label">Historial</div>
            <ul className="nav history">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button type="button" className={c.id === conversationId ? "on" : ""} onClick={() => onOpenConversation(c.id)} title={c.title}>
                    <ChatIcon /> <span className="hist-t">{c.title}</span>
                  </button>
                  <button type="button" className="btn-icon sm hist-del" onClick={() => onDeleteConversation(c.id)} title="Borrar del historial" aria-label={`Borrar «${c.title}» del historial`}>
                    <XIcon size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
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
              <li>
                <button type="button" onClick={() => setAboutOpen(true)}>
                  <InfoIcon /> <span>Acerca de</span>
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
      <label className="check theme-toggle">
        <span className="lbl"><SunIcon /> Modo claro</span>
        <span className="switch">
          <input type="checkbox" checked={light} onChange={(e) => { setTheme(e.target.checked ? "light" : "dark"); setLight(e.target.checked); }} />
          <span />
        </span>
      </label>
      <div className="user-row">
        <span className="avatar sm">{initials}</span>
        <span className="who"><b>{user.name}</b><small>{isAdmin ? "Administrador" : "Usuario"}</small></span>
        {isAdmin && <button type="button" className="btn-icon sm" title="Cambiar contraseña" onClick={() => setPwOpen(true)}><KeyIcon /></button>}
        <button type="button" className="btn-icon sm" title="Cerrar sesión" onClick={onLogout}><LogoutIcon /></button>
      </div>
      {pwOpen && createPortal(<PasswordDialog onClose={() => setPwOpen(false)} />, document.body)}
      {aboutOpen && createPortal(<AboutDialog model={library?.model} onClose={() => setAboutOpen(false)} />, document.body)}
    </aside>
  );
}

function PasswordDialog({ onClose }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = again && next !== again;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.changePassword(current, next);
      toast("Contraseña cambiada");
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pwT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <div className="dlg-head">
          <div className="tt"><h3 id="pwT">Cambiar contraseña</h3><p>Se cerrarán tus otras sesiones abiertas.</p></div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          <div className="field"><label htmlFor="pwCur">Contraseña actual</label><input className="input" id="pwCur" type="password" required autoFocus value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
          <div className="field"><label htmlFor="pwNew">Nueva contraseña</label><input className="input" id="pwNew" type="password" required minLength={4} value={next} onChange={(e) => setNext(e.target.value)} /></div>
          <div className="field"><label htmlFor="pwAgain">Repite la nueva</label><input className="input" id="pwAgain" type="password" required value={again} onChange={(e) => setAgain(e.target.value)} /></div>
          {mismatch && <p className="error">Las contraseñas no coinciden.</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="dlg-foot">
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !current || next.length < 4 || next !== again}>Guardar</button>
        </div>
      </form>
    </div>
  );
}
