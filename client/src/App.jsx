import { useCallback, useEffect, useState } from "react";
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
    <div className={`app view-${view}`}>
      <nav className="mobile-tabs" aria-label="Vista">
        <button className={view === "tree" ? "on" : ""} onClick={() => setView("tree")}>Red</button>
        <button className={view === "chat" ? "on" : ""} onClick={() => setView("chat")}>Chat</button>
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
          <aside className="drawer" aria-label="Nota seleccionada">
            <button className="close" onClick={close} aria-label="Cerrar">×</button>
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
          </aside>
        )}
      </main>

      <Chat scenarios={scenarios} notes={notes} onSaved={onSaved} onShowNote={showNote}
        onSearch={(ids) => setHighlight(ids.length ? new Set(ids) : null)} />
    </div>
  );
}
