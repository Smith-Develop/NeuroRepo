import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import Network, { colorOf } from "./Network";
import Chat from "./Chat";
import NoteForm from "./NoteForm";
import NoteCard from "./NoteCard";

export default function App() {
  const [scenarios, setScenarios] = useState([]);
  const [notes, setNotes] = useState([]);
  const [highlight, setHighlight] = useState(null);
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(false);
  const [freshId, setFreshId] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("chat"); // solo en móvil
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(420);
  const resizing = useRef(false);

  const load = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.scenarios(), api.notes()]);
      setScenarios(s);
      setNotes(n);
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  function onSaved(note) {
    setHighlight(null);
    setFreshId(note._id);
    load();
  }
  function showNote(note) {
    // si solo tenemos una versión parcial (p. ej. desde un enlace de "relacionada con"), usa la completa ya cargada
    setSelected(notes.find((n) => n._id === note._id) ?? note);
    setEditing(false);
    setHighlight(new Set([note._id]));
    setView("tree");
  }
  function close() {
    setSelected(null);
    setEditing(false);
  }

  function startResize(e) {
    resizing.current = true;
    e.target.setPointerCapture(e.pointerId);
  }
  function onResize(e) {
    if (!resizing.current) return;
    const min = 300, max = window.innerWidth - 320;
    setChatWidth(Math.min(Math.max(window.innerWidth - e.clientX, min), max));
  }
  function stopResize() {
    resizing.current = false;
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
    if (!confirm("¿Borrar esta nota del árbol?")) return;
    setBusy(true);
    try {
      await api.deleteNote(selected._id);
      close();
      await load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className={`app view-${view}`} style={{ "--chat-w": chatOpen ? `${chatWidth}px` : "0px" }}>
      <nav className="mobile-tabs" aria-label="Vista">
        <button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>Red</button>
        <button className={view === "chat" ? "on" : ""} onClick={() => { setView("chat"); setChatOpen(true); }}>Chat</button>
      </nav>

      <main className="tree-pane">
        <header className="tree-head">
          <h1>Red de conocimiento</h1>
          <p>{scenarios.length} apps · {notes.length} casuísticas</p>
          {highlight && <button className="ghost small" onClick={() => setHighlight(null)}>Quitar resaltado</button>}
        </header>
        <Network scenarios={scenarios} notes={notes} highlight={highlight} selectedId={selected?._id} freshId={freshId} onSelect={showNote} />
        {error && <p className="error toast" role="alert" onClick={() => setError("")}>{error}</p>}

        {selected && (
          <div className="modal-backdrop" onClick={close}>
            <aside className="drawer" aria-label="Nota seleccionada" onClick={(e) => e.stopPropagation()}>
              <button className="close" onClick={close} aria-label="Cerrar">×</button>
              <div className="drawer-inner">
                {editing ? (
                  <NoteForm key={selected._id} initial={selected} scenarios={scenarios} notes={notes} submitLabel="Guardar cambios" cancelLabel="Cancelar" busy={busy}
                    onSubmit={update} onCancel={() => setEditing(false)} />
                ) : (
                  <>
                    <NoteCard note={selected} color={colorOf(scenarios, selected.scenario?._id)} onShow={showNote} />
                    <div className="actions">
                      <button className="ghost" onClick={remove} disabled={busy}>Borrar</button>
                      <button onClick={() => setEditing(true)}>Editar</button>
                    </div>
                  </>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>

      {chatOpen && (
        <div className="resizer" onPointerDown={startResize} onPointerMove={onResize} onPointerUp={stopResize} role="separator" aria-orientation="vertical" aria-label="Redimensionar chat" />
      )}
      {chatOpen ? (
        <Chat scenarios={scenarios} notes={notes} onSaved={onSaved} onShowNote={showNote} onToggle={() => setChatOpen(false)}
          onSearch={(ids) => setHighlight(ids.length ? new Set(ids) : null)} />
      ) : (
        <button className="chat-reopen" onClick={() => setChatOpen(true)} aria-label="Abrir chat">💬</button>
      )}
    </div>
  );
}
