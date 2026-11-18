import { useCallback, useEffect, useMemo, useState } from "react";
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
import Favorites from "./Favorites";
import GuideEditor from "./GuideEditor";
import { toast } from "./toast";
import { newConversationId, deleteConversation } from "./chatHistory";
import { AppContext } from "./appContext";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [view, setView] = useState("chat");
  const [summary, setSummary] = useState(null); // {total, topFolders}
  const [docsVersion, setDocsVersion] = useState(0); // sube cada vez que la biblioteca puede haber cambiado
  const [error, setError] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [conversationId, setConversationId] = useState(newConversationId);
  const [favorites, setFavorites] = useState(null); // documentos favoritos (null = cargando)
  const favoriteIds = useMemo(() => new Set((favorites || []).map((d) => d._id)), [favorites]);

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
  useEffect(() => {
    if (!user) return;
    api.favorites().then(setFavorites).catch(() => setFavorites([]));
  }, [user]);

  const toggleFavorite = useCallback(async (doc) => {
    const was = favoriteIds.has(doc._id);
    setFavorites((list) => (was ? (list || []).filter((d) => d._id !== doc._id) : [doc, ...(list || [])]));
    try {
      if (was) await api.removeFavorite(doc._id);
      else await api.addFavorite(doc._id);
      toast(was ? "Quitado de favoritos" : "Añadido a favoritos");
    } catch (e) {
      setFavorites((list) => (was ? [doc, ...(list || [])] : (list || []).filter((d) => d._id !== doc._id)));
      toast(e.message);
    }
  }, [favoriteIds]);

  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    setSummary(null);
    setFavorites(null);
    setConversationId(newConversationId());
    setView("chat");
  }

  function closeLibrary() {
    setLibraryOpen(false);
    load(); // la carpeta activa o el índice pueden haber cambiado
  }

  function navigate(id) {
    if (id === "chat" && view === "chat") setConversationId(newConversationId()); // nueva búsqueda
    setView(id);
  }

  function newSearch() {
    setConversationId(newConversationId());
    setView("chat");
  }

  function openConversation(id) {
    setConversationId(id);
    setView("chat");
  }

  function removeConversation(id) {
    deleteConversation(user._id, id);
    if (id === conversationId) setConversationId(newConversationId());
  }

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <AppContext.Provider value={{ user, reloadDocuments: load, favorites, favoriteIds, toggleFavorite }}>
    <div className="app">
      <Sidebar user={user} view={view} documentCount={summary?.total ?? 0} favoriteCount={favorites?.length ?? 0}
        conversationId={view === "chat" ? conversationId : null} onNewSearch={newSearch} onOpenConversation={openConversation} onDeleteConversation={removeConversation}
        onNavigate={navigate} onLogout={logout} onOpenLibrary={() => setLibraryOpen(true)} />
      <main className="main">
        <section className="view">
          {view === "chat" && <Chat key={conversationId} conversationId={conversationId} user={user} topFolders={summary?.topFolders ?? []} onOpenDocumentos={() => setView("documentos")} onNew={newSearch} />}
          {view === "favoritos" && <Favorites />}
          {view === "documentos" && <Explorer summary={summary} docsVersion={docsVersion} user={user} onOpenLibrary={() => setLibraryOpen(true)} />}
          {view === "usuarios" && user.role === "admin" && <Users currentUser={user} />}
          {view === "grupos" && user.role === "admin" && <Groups />}
          {view === "registro" && user.role === "admin" && <ActivityLog />}
          {view === "guia" && user.canEditGuide && <GuideEditor />}
          {error && <p className="error" role="alert" onClick={() => setError("")}>{error}</p>}
        </section>
      </main>

      {libraryOpen && <LibraryPicker onClose={closeLibrary} />}
      <Toaster />
    </div>
    </AppContext.Provider>
  );
}
