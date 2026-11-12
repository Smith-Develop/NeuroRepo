import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import Network, { colorOf } from "./Network";
import Chat from "./Chat";
import NoteForm from "./NoteForm";
import NoteCard from "./NoteCard";
import Login from "./Login";
import Sidebar from "./Sidebar";
import Suggestions from "./Suggestions";
import Users from "./Users";
import Groups from "./Groups";

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = comprobando sesión, null = sin sesión
  const [view, setView] = useState("chat");
  const [scenarios, setScenarios] = useState([]);
  const [notes, setNotes] = useState([]);
  const [highlight, setHighlight] = useState(null);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportText, setReportText] = useState("");
  const [freshId, setFreshId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestionCount, setSuggestionCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.scenarios(), api.notes()]);
      setScenarios(s);
      setNotes(n);
    } catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    api.me().then(({ user }) => setUser(user)).catch(() => setUser(null));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);
  useEffect(() => {
    if (user?.role !== "admin") return;
    api.suggestions().then((items) => setSuggestionCount(items.filter((s) => s.status === "pendiente").length)).catch(() => {});
  }, [user, view]);

  function onSaved(note) {
    setHighlight(null);
    setFreshId(note._id);
    load();
  }
  function showNote(note) {
    // si solo tenemos una versión parcial (p. ej. desde un enlace), usa la completa ya cargada
    setSelected(notes.find((n) => n._id === note._id) ?? note);
    setEditing(false);
    setReporting(false);
    setHighlight(new Set([note._id]));
  }
  function close() {
    setSelected(null);
    setEditing(false);
    setReporting(false);
  }

  async function update(fields) {
    setBusy(true);
    try {
      const n = await api.updateNote(selected._id, fields);
      setSelected(n);
      setEditing(false);
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm("¿Borrar esta nota de la red?")) return;
    setBusy(true);
    try {
      await api.deleteNote(selected._id);
      close();
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function sendReport(e) {
    e.preventDefault();
    if (!reportText.trim()) return;
    setBusy(true);
    try {
      await api.createSuggestion({ text: reportText.trim(), kind: "cambio", note: selected._id });
      close();
      setReportText("");
      setNotice("Aviso enviado al administrador.");
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function logout() {
    await api.logout().catch(() => {});
    setUser(null);
    setScenarios([]);
    setNotes([]);
    setSelected(null);
    setView("chat");
  }

  if (user === undefined) return null;
  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="app">
      <Sidebar user={user} view={view} onNavigate={setView} onLogout={logout} suggestionCount={suggestionCount} />
      <main className="main-view">
        {view === "chat" && (
          <Chat user={user} scenarios={scenarios} notes={notes} onSaved={onSaved} onShowNote={showNote}
            onSearch={(ids) => setHighlight(ids.length ? new Set(ids) : null)} />
        )}
        {view === "red" && (
          <div className="tree-pane">
            <header className="tree-head">
              <h1>Red de conocimiento</h1>
              <p>{scenarios.length} apps · {notes.length} casuísticas</p>
              {highlight && <button className="ghost small" onClick={() => setHighlight(null)}>Quitar resaltado</button>}
            </header>
            <Network scenarios={scenarios} notes={notes} highlight={highlight} selectedId={selected?._id} freshId={freshId} onSelect={showNote} />
          </div>
        )}
        {view === "sugerencias" && user.role === "admin" && <Suggestions scenarios={scenarios} notes={notes} onChanged={load} />}
        {view === "usuarios" && user.role === "admin" && <Users />}
        {view === "grupos" && user.role === "admin" && <Groups />}
        {error && <p className="error toast" role="alert" onClick={() => setError("")}>{error}</p>}
        {notice && <p className="toast notice" onClick={() => setNotice("")}>{notice}</p>}
      </main>

      {selected && (
        <div className="modal-backdrop" onClick={close}>
          <aside className="drawer" aria-label="Nota seleccionada" onClick={(e) => e.stopPropagation()}>
            <button className="close" onClick={close} aria-label="Cerrar">×</button>
            <div className="drawer-inner">
              {editing ? (
                <NoteForm key={selected._id} initial={selected} scenarios={scenarios} notes={notes} submitLabel="Guardar cambios" cancelLabel="Cancelar" busy={busy}
                  onSubmit={update} onCancel={() => setEditing(false)} />
              ) : reporting ? (
                <form className="note-form" onSubmit={sendReport}>
                  <label htmlFor="rep">¿Qué ha cambiado o qué está mal en «{selected.title}»?</label>
                  <textarea id="rep" rows={4} value={reportText} onChange={(e) => setReportText(e.target.value)} autoFocus required maxLength={4000} />
                  <div className="actions">
                    <button type="button" className="ghost" onClick={() => setReporting(false)} disabled={busy}>Cancelar</button>
                    <button disabled={busy || !reportText.trim()}>{busy ? "Enviando…" : "Avisar al administrador"}</button>
                  </div>
                </form>
              ) : (
                <>
                  <NoteCard note={selected} color={colorOf(scenarios, selected.scenario?._id)} onShow={showNote} />
                  <div className="actions">
                    {user.role === "admin" ? (
                      <>
                        <button className="ghost" onClick={remove} disabled={busy}>Borrar</button>
                        <button onClick={() => setEditing(true)}>Editar</button>
                      </>
                    ) : (
                      <button className="ghost" onClick={() => setReporting(true)}>Avisar de un cambio</button>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
