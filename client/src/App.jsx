import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Chat from "./Chat";
import Explorer from "./Explorer";
import Login from "./Login";
import Sidebar from "./Sidebar";
import Users from "./Users";
import Groups from "./Groups";
import LibraryPicker from "./LibraryPicker";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [view, setView] = useState("chat");
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);

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

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <Sidebar user={user} view={view} onNavigate={setView} onLogout={logout} onOpenLibrary={() => setLibraryOpen(true)} />
      <main className="main-view">
        {view === "chat" && <Chat />}
        {view === "documentos" && <Explorer documents={documents} />}
        {view === "usuarios" && user.role === "admin" && <Users />}
        {view === "grupos" && user.role === "admin" && <Groups />}
        {error && <p className="error toast" role="alert" onClick={() => setError("")}>{error}</p>}
      </main>

      {libraryOpen && <LibraryPicker onClose={closeLibrary} />}
    </div>
  );
}
