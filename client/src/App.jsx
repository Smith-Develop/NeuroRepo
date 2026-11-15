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

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [view, setView] = useState("chat");
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setDocuments(await api.documents());
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    setDocuments([]);
    setView("chat");
  }

  function closeLibrary() {
    setLibraryOpen(false);
    load(); // la carpeta activa o el índice pueden haber cambiado
  }

  function navigate(id) {
    if (id === "chat" && view === "chat") setChatKey((k) => k + 1); // nueva búsqueda
    setView(id);
  }

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <Sidebar user={user} view={view} onNavigate={navigate} onLogout={logout} onOpenLibrary={() => setLibraryOpen(true)} />
      <main className="main-view">
        {view === "chat" && <Chat key={chatKey} user={user} onOpenDocumentos={() => setView("documentos")} />}
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
