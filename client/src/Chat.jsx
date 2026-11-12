import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import NoteForm from "./NoteForm";
import NoteCard from "./NoteCard";
import { colorOf } from "./Network";

const WELCOME = {
  id: "welcome", role: "assistant", kind: "text",
  text: "Hola. Cuéntame qué aprendiste hoy, tal como te salga. Te propondré un resumen para que lo revises antes de guardarlo en tu árbol.\n\nSi quieres consultar algo, cambia a «Buscar» (o empieza con «¿») y te enseñaré lo que ya tienes guardado.",
};
const looksLikeQuestion = (t) => /^\s*¿/.test(t) || /\?\s*$/.test(t);
let seq = 0;
const nextId = () => `m${++seq}`;

export default function Chat({ scenarios, notes, onSaved, onSearch, onShowNote }) {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("learn");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  const push = (...m) => setMessages((all) => [...all, ...m]);
  const replace = (id, m) => setMessages((all) => all.map((x) => (x.id === id ? { ...x, ...m } : x)));

  function onType(e) {
    const t = e.target.value;
    setInput(t);
    if (looksLikeQuestion(t)) setMode("search");
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  }

  async function send(e) {
    e?.preventDefault();
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const reply = nextId();
    push({ id: nextId(), role: "user", text: t, mode }, { id: reply, role: "assistant", kind: "loading", text: mode === "learn" ? "Analizando lo que aprendiste…" : "Buscando en tu árbol…" });
    setBusy(true);
    try {
      if (mode === "learn") {
        const draft = await api.draft(t);
        replace(reply, { kind: "draft", draft });
      } else {
        const results = await api.notes(t);
        onSearch(results.map((n) => n._id));
        replace(reply, { kind: "results", results, query: t });
      }
    } catch (err) {
      replace(reply, { kind: "error", text: err.message });
    } finally {
      setBusy(false);
      setMode("learn");
    }
  }

  async function save(msg, fields) {
    replace(msg.id, { saving: true, error: null });
    try {
      const note = await api.createNote({ ...fields, raw: msg.draft.raw, scenarioDescription: msg.draft.scenarioDescription });
      replace(msg.id, { kind: "saved", note, saving: false });
      onSaved(note);
    } catch (err) {
      replace(msg.id, { saving: false, error: err.message });
    }
  }

  return (
    <section className="chat" aria-label="Chat">
      <div className="messages" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "user" && (
              <div className="bubble">
                {m.mode === "search" && <span className="mode-tag">Buscar</span>}
                {m.text}
              </div>
            )}
            {m.role === "assistant" && (
              <div className="assistant-body">
                <div className="avatar" aria-hidden="true" />
                <div className="content">
                  {m.kind === "text" && <p className="pre">{m.text}</p>}
                  {m.kind === "loading" && <p className="loading">{m.text}</p>}
                  {m.kind === "error" && <p className="error" role="alert">{m.text}</p>}
                  {m.kind === "draft" && (
                    <>
                      <p>Esto es lo que entendí. Corrige lo que haga falta y guárdalo en el árbol:</p>
                      <div className="card">
                        <NoteForm initial={m.draft} scenarios={scenarios} notes={notes} submitLabel="Guardar en la red" busy={m.saving}
                          onSubmit={(f) => save(m, f)} onCancel={() => replace(m.id, { kind: "text", text: "Descartado. No he guardado nada." })} />
                      </div>
                      {m.error && <p className="error" role="alert">{m.error}</p>}
                    </>
                  )}
                  {m.kind === "saved" && (
                    <>
                      <p>Guardado en <strong>{m.note.scenario?.name}</strong>. Tu red ha crecido.</p>
                      <NoteCard note={m.note} color={colorOf(scenarios, m.note.scenario?._id)} onShow={onShowNote} jumpLabel="Ver en la red" />
                    </>
                  )}
                  {m.kind === "results" && (
                    m.results.length === 0
                      ? <p>No tengo nada guardado sobre «{m.query}» todavía. Cuando lo aprendas, cuéntamelo y lo añado a la red.</p>
                      : <>
                          <p>Esto es lo que tienes guardado ({m.results.length} {m.results.length === 1 ? "nota" : "notas"}). Las he iluminado en la red:</p>
                          {m.results.map((n) => <NoteCard key={n._id} note={n} color={colorOf(scenarios, n.scenario?._id)} onShow={onShowNote} jumpLabel="Ver en la red" />)}
                        </>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={send}>
        <div className="modes" role="radiogroup" aria-label="Modo">
          {[["learn", "Aprendí algo"], ["search", "Buscar"]].map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} className={mode === k ? "on" : ""} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="input-row">
          <textarea ref={inputRef} rows={1} value={input} onChange={onType} aria-label="Mensaje"
            placeholder={mode === "learn" ? "¿Qué aprendiste hoy?" : "¿Qué quieres consultar de tu árbol?"}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(e)} />
          <button className="send" disabled={busy || !input.trim()} aria-label="Enviar">↑</button>
        </div>
        <p className="hint">Enter para enviar · Shift+Enter para salto de línea</p>
      </form>
    </section>
  );
}
