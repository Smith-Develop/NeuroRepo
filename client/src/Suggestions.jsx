import { useEffect, useState } from "react";
import { api } from "./api";
import NoteForm from "./NoteForm";

// Bandeja de sugerencias de los usuarios: el admin decide si las analiza con la IA o las descarta
export default function Suggestions({ scenarios, notes, onChanged }) {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(null); // { suggestion, draft }
  const [busy, setBusy] = useState(false);

  const load = () => api.suggestions().then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function analyze(s) {
    setBusy(true);
    setError("");
    try {
      const draft = await api.draft(s.text);
      setAnalyzing({ suggestion: s, draft });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveFromSuggestion(fields) {
    setBusy(true);
    try {
      const note = await api.createNote({ ...fields, raw: analyzing.draft.raw, scenarioDescription: analyzing.draft.scenarioDescription });
      await api.resolveSuggestion(analyzing.suggestion._id, { status: "resuelta", note: note._id });
      setAnalyzing(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function discard(s) {
    setBusy(true);
    try {
      await api.resolveSuggestion(s._id, { status: "descartada" });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pending = items.filter((s) => s.status === "pendiente");
  const resolved = items.filter((s) => s.status !== "pendiente");

  return (
    <div className="panel">
      <h1>Sugerencias</h1>
      {error && <p className="error" role="alert">{error}</p>}
      {analyzing ? (
        <div className="card">
          <p>Esto es lo que entiende la IA de esta sugerencia. Revísalo y guárdalo si procede:</p>
          <NoteForm initial={analyzing.draft} scenarios={scenarios} notes={notes} submitLabel="Guardar en la red" busy={busy}
            onSubmit={saveFromSuggestion} onCancel={() => setAnalyzing(null)} />
        </div>
      ) : (
        <>
          {pending.length === 0 && <p className="hint">No hay sugerencias pendientes.</p>}
          <ul className="suggestion-list">
            {pending.map((s) => (
              <li key={s._id} className="suggestion-item">
                <div className="suggestion-head">
                  <span className={`kind-tag ${s.kind}`}>{s.kind === "cambio" ? "Aviso de cambio" : "Nueva nota"}</span>
                  <span className="suggestion-author">{s.author?.username}</span>
                  <time>{new Date(s.createdAt).toLocaleString()}</time>
                </div>
                {s.note && <p className="hint">Sobre: <strong>{s.note.title}</strong></p>}
                <p className="pre">{s.text}</p>
                <div className="actions">
                  <button type="button" className="ghost" onClick={() => discard(s)} disabled={busy}>Descartar</button>
                  <button type="button" onClick={() => analyze(s)} disabled={busy}>Analizar con IA</button>
                </div>
              </li>
            ))}
          </ul>
          {resolved.length > 0 && (
            <details className="sources">
              <summary>{resolved.length} {resolved.length === 1 ? "resuelta" : "resueltas"} o descartadas</summary>
              <ul className="suggestion-list">
                {resolved.map((s) => (
                  <li key={s._id} className="suggestion-item resolved">
                    <div className="suggestion-head">
                      <span className={`kind-tag ${s.kind}`}>{s.kind === "cambio" ? "Aviso de cambio" : "Nueva nota"}</span>
                      <span className="suggestion-author">{s.author?.username}</span>
                      <span className="status-tag">{s.status}</span>
                    </div>
                    <p className="pre">{s.text}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
