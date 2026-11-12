import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import NoteForm from "./NoteForm";
import NoteCard from "./NoteCard";
import Builder from "./Builder";
import { colorOf } from "./Network";

const WELCOME_ADMIN = {
  id: "welcome", role: "assistant", kind: "text",
  text: "Hola, soy tu asistente de conocimiento. Cuéntame qué aprendiste hoy, tal como se lo explicarías a un compañero, y te propongo un resumen para que lo revises antes de guardarlo.\n\nSi quieres preguntarme algo, cambia a «Buscar» (o escribe tu pregunta con «¿»): te contesto directamente, usando solo lo que ya tienes guardado.",
};
const WELCOME_USER = {
  id: "welcome", role: "assistant", kind: "text",
  text: "Hola, soy el asistente de conocimiento. Pregúntame lo que necesites (modo «Buscar», o escribe tu pregunta con «¿») y te contesto con lo que ya está guardado.\n\nSi aprendiste algo nuevo, cuéntamelo en «Aprendí algo»: se lo paso al administrador para que lo revise y lo añada.",
};
const looksLikeQuestion = (t) => /^\s*¿/.test(t) || /\?\s*$/.test(t);
let seq = 0;
const nextId = () => `m${++seq}`;

export default function Chat({ user, scenarios, notes, onSaved, onSearch, onShowNote }) {
  const isAdmin = user.role === "admin";
  const [messages, setMessages] = useState([isAdmin ? WELCOME_ADMIN : WELCOME_USER]);
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
    const loadingText = mode === "learn" ? (isAdmin ? "Analizando lo que aprendiste…" : "Enviándoselo al administrador…") : "Repasando tus notas para responderte…";
    push({ id: nextId(), role: "user", text: t, mode }, { id: reply, role: "assistant", kind: "loading", text: loadingText });
    setBusy(true);
    try {
      if (mode === "learn") {
        if (isAdmin) {
          const draft = await api.draft(t);
          replace(reply, { kind: "draft", draft });
        } else {
          await api.createSuggestion({ text: t, kind: "nota" });
          replace(reply, { kind: "text", text: "Gracias. Se lo he pasado al administrador para que lo revise y lo añada a la red." });
        }
      } else {
        const { answer, notes: found } = await api.ask(t);
        onSearch(found.map((n) => n._id));
        replace(reply, { kind: "answer", answer, results: found, query: t });
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

  function openBuilder() {
    push({ id: nextId(), role: "assistant", kind: "builder" });
  }

  async function saveManual(msg, fields) {
    replace(msg.id, { saving: true, error: null });
    try {
      const note = await api.createNote(fields);
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
                      <p>Esto es lo que entendí de tu nota. Revísalo y ajusta lo que haga falta antes de guardarlo:</p>
                      <div className="card">
                        <NoteForm initial={m.draft} scenarios={scenarios} notes={notes} submitLabel="Guardar en la red" busy={m.saving}
                          onSubmit={(f) => save(m, f)} onCancel={() => replace(m.id, { kind: "text", text: "Descartado. No he guardado nada." })} />
                      </div>
                      {m.error && <p className="error" role="alert">{m.error}</p>}
                    </>
                  )}
                  {m.kind === "builder" && (
                    <>
                      <p>Monta tu casuística pieza a pieza, sin pasar por la IA:</p>
                      <div className="card">
                        <Builder scenarios={scenarios} notes={notes} busy={m.saving}
                          onSubmit={(f) => saveManual(m, f)} onCancel={() => replace(m.id, { kind: "text", text: "Descartado. No he guardado nada." })} />
                      </div>
                      {m.error && <p className="error" role="alert">{m.error}</p>}
                    </>
                  )}
                  {m.kind === "saved" && (
                    <>
                      <p>Guardado en <strong>{m.note.scenario?.name}</strong>. Ya forma parte de tu red.</p>
                      <NoteCard note={m.note} color={colorOf(scenarios, m.note.scenario?._id)} onShow={onShowNote} jumpLabel="Ver en la red" />
                    </>
                  )}
                  {m.kind === "answer" && (
                    m.answer === null
                      ? <p>Todavía no tengo nada guardado sobre eso.{isAdmin ? " Cuéntame lo que sepas y lo añado a tu red para la próxima vez." : " Cuéntaselo al administrador en «Aprendí algo» para que lo añada."}</p>
                      : <>
                          <p className="pre">{m.answer}</p>
                          {m.results.length > 0 && (
                            <details className="sources">
                              <summary>{m.results.length} {m.results.length === 1 ? "nota usada" : "notas usadas"} (iluminadas en la red)</summary>
                              {m.results.map((n) => <NoteCard key={n._id} note={n} color={colorOf(scenarios, n.scenario?._id)} onShow={onShowNote} jumpLabel="Ver en la red" />)}
                            </details>
                          )}
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
          {isAdmin && <button type="button" className="build-btn" onClick={openBuilder}>🧱 Construir</button>}
        </div>
        <div className="input-row">
          <textarea ref={inputRef} rows={1} value={input} onChange={onType} aria-label="Mensaje"
            placeholder={mode === "learn" ? "¿Qué aprendiste hoy?" : "¿Qué quieres saber? Pregúntame como a un compañero"}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(e)} />
          <button className="send" disabled={busy || !input.trim()} aria-label="Enviar">↑</button>
        </div>
        <p className="hint">Enter para enviar · Shift+Enter para salto de línea</p>
      </form>
    </section>
  );
}
