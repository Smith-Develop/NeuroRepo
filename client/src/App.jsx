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
import { AppContext } from "./appContext";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [view, setView] = useState("chat");
  const [summary, setSummary] = useState(null); // {total, topFolders}
  const [docsVersion, setDocsVersion] = useState(0); // sube cada vez que la biblioteca puede haber cambiado
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [chatKey, setChatKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setSummary(await api.summary());
      setDocsVersion((v) => v + 1);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    setSummary(null);
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
    <AppContext.Provider value={{ user, reloadDocuments: load }}>
    <div className="app">
      <Sidebar user={user} view={view} documentCount={summary?.total ?? 0} onNavigate={navigate} onLogout={logout} onOpenLibrary={() => setLibraryOpen(true)} />
      <main className="main">
        <section className="view">
          {view === "chat" && <Chat key={chatKey} user={user} topFolders={summary?.topFolders ?? []} onOpenDocumentos={() => setView("documentos")} />}
          {view === "documentos" && <Explorer summary={summary} docsVersion={docsVersion} user={user} onOpenLibrary={() => setLibraryOpen(true)} />}
          {view === "usuarios" && user.role === "admin" && <Users currentUser={user} />}
          {view === "grupos" && user.role === "admin" && <Groups />}
          {view === "registro" && user.role === "admin" && <ActivityLog />}
          {error && <p className="error" role="alert" onClick={() => setError("")}>{error}</p>}
        </section>
      </main>

      {libraryOpen && <LibraryPicker onClose={closeLibrary} />}
      <Toaster />
    </div>
    </AppContext.Provider>
  );
}
