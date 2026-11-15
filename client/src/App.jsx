import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Chat from "./Chat";
import Explorer from "./Explorer";
import Login from "./Login";
import Sidebar from "./Sidebar";
import Users from "./Users";
import Groups from "./Groups";
import ActivityLog from "./ActivityLog";
import LibraryPicker from "./LibraryPicker";
import Toaster from "./Toaster";

// Carpetas de primer nivel visibles para el usuario actual, derivadas de lo que ya devolvió
// GET /documents (que el servidor filtra por permisos): evita un endpoint nuevo solo para esto.
function allowedFolders(documents) {
  return [...new Set(documents.map((d) => d.topFolder || d.folder?.split("/")[0]).filter(Boolean))].sort();
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [view, setView] = useState("chat");
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState(null);
  const [chatKey, setChatKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setDocuments(await api.documents());
    } catch (e) { setError(e.message); }
  }, []);
  const loadLibraryStatus = useCallback(async () => {
    try { setLibraryStatus(await api.library()); } catch { /* el admin lo verá al abrir "Vincular biblioteca" */ }
  }, []);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);
  useEffect(() => { if (user?.role === "admin") loadLibraryStatus(); }, [user, loadLibraryStatus]);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    setDocuments([]);
    setView("chat");
  }

  function closeLibrary() {
    setLibraryOpen(false);
    load(); // la carpeta activa o el índice pueden haber cambiado
    if (user?.role === "admin") loadLibraryStatus();
  }

  function newSearch() {
    setChatKey((k) => k + 1);
    setView("chat");
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newSearch(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <Sidebar user={user} view={view} onNavigate={setView} onLogout={logout} onOpenLibrary={() => setLibraryOpen(true)}
        onNewSearch={newSearch} docCount={documents.length} libraryStatus={libraryStatus} />
      <main className="main-view">
        {view === "chat" && <Chat key={chatKey} user={user} folders={allowedFolders(documents)} onOpenDocumentos={() => setView("documentos")} />}
        {view === "documentos" && <Explorer documents={documents} />}
        {view === "usuarios" && user.role === "admin" && <Users />}
        {view === "grupos" && user.role === "admin" && <Groups />}
        {view === "registro" && user.role === "admin" && <ActivityLog />}
        {error && <p className="error toast" role="alert" onClick={() => setError("")}>{error}</p>}
      </main>

      {libraryOpen && <LibraryPicker onClose={closeLibrary} />}
      <Toaster />
    </div>
  );
}
