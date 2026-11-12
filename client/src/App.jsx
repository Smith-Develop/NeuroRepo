import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export default function App() {
  const [scenarios, setScenarios] = useState([]);
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState({ scenario: "", tag: "", q: "" });
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, n] = await Promise.all([api.scenarios(), api.notes(filter)]);
      setScenarios(s);
      setNotes(n);
    } catch (e) { setError(e.message); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  async function run(fn) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const save = (e) => { e.preventDefault(); if (!draft.trim()) return;
    run(async () => { await api.addNote(draft); setDraft(""); await load(); }); };

  const ask = (e) => { e.preventDefault(); if (!question.trim()) return;
    run(async () => setAnswer(await api.ask(question))); };

  const move = (id, scenario) => run(async () => { await api.updateNote(id, { scenario }); await load(); });
  const remove = (id) => confirm("¿Borrar esta nota?") && run(async () => { await api.deleteNote(id); await load(); });

  return (
    <div className="layout">
      <aside>
        <h1>Mi conocimiento</h1>
        <button className={!filter.scenario ? "active" : ""} onClick={() => setFilter({ scenario: "", tag: "", q: "" })}>
          Todas <span>{scenarios.reduce((a, s) => a + s.noteCount, 0)}</span>
        </button>
        {scenarios.map((s) => (
          <button key={s._id} title={s.description} className={filter.scenario === s._id ? "active" : ""}
            onClick={() => setFilter({ scenario: s._id, tag: "", q: "" })}>
            {s.name} <span>{s.noteCount}</span>
          </button>
        ))}
      </aside>

      <main>
        <form onSubmit={save} className="card">
          <label htmlFor="draft">¿Qué aprendiste hoy?</label>
          <textarea id="draft" rows={4} value={draft} onChange={(e) => setDraft(e.target.value)}
            placeholder="Escríbelo como te salga. Ej: hoy descubrí que para reiniciar el servicio de facturación hay que…" />
          <button disabled={busy || !draft.trim()}>{busy ? "Organizando…" : "Guardar y organizar"}</button>
        </form>

        <form onSubmit={ask} className="card">
          <label htmlFor="q">Pregúntale a tus notas</label>
          <div className="row">
            <input id="q" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="¿Cómo se reiniciaba el servicio de facturación?" />
            <button disabled={busy || !question.trim()}>Preguntar</button>
          </div>
          {answer && (
            <div className="answer">
              <p>{answer.answer}</p>
              <small>Fuentes: {answer.sources.map((s, i) => `[${i + 1}] ${s.title}`).join(" · ")}</small>
            </div>
          )}
        </form>

        {error && <p role="alert" className="error">{error}</p>}

        <div className="row">
          <input aria-label="Buscar" placeholder="Buscar en notas…" value={filter.q}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          {filter.tag && <button onClick={() => setFilter({ ...filter, tag: "" })}>#{filter.tag} ✕</button>}
        </div>

        {notes.length === 0 && <p className="muted">No hay notas aquí todavía.</p>}
        {notes.map((n) => (
          <article key={n._id} className="card">
            <header>
              <h2>{n.title}</h2>
              <select aria-label="Escenario" value={n.scenario?._id} onChange={(e) => move(n._id, e.target.value)}>
                {scenarios.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </header>
            <p>{n.summary}</p>
            {n.keyPoints?.length > 0 && <ul>{n.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>}
            <div className="tags">
              {n.tags.map((t) => <button key={t} className="tag" onClick={() => setFilter({ ...filter, tag: t })}>#{t}</button>)}
            </div>
            <details><summary>Nota original</summary><p className="raw">{n.raw}</p></details>
            <footer>
              <small>{new Date(n.createdAt).toLocaleString()}</small>
              <button className="link" onClick={() => remove(n._id)}>Borrar</button>
            </footer>
          </article>
        ))}
      </main>
    </div>
  );
}
