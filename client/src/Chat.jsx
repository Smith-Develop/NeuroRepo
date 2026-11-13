import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import DocumentCard from "./DocumentCard";

const WELCOME = {
  id: "welcome", role: "assistant", kind: "text",
  text: "Hola, soy el buscador de la biblioteca de documentos. Dime qué necesitas (un nombre, un tema, unas palabras clave) y te muestro los documentos que mejor coinciden, con opción de verlos o descargarlos.",
};
let seq = 0;
const nextId = () => `m${++seq}`;

export default function Chat() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  const push = (...m) => setMessages((all) => [...all, ...m]);
  const replace = (id, m) => setMessages((all) => all.map((x) => (x.id === id ? { ...x, ...m } : x)));

  function onType(e) {
    setInput(e.target.value);
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
    push({ id: nextId(), role: "user", text: t }, { id: reply, role: "assistant", kind: "loading", text: "Buscando en la biblioteca…" });
    setBusy(true);
    try {
      const { results, blocked, message, usedAI } = await api.ask(t);
      if (blocked) replace(reply, { kind: "text", text: message });
      else replace(reply, { kind: "results", results, usedAI });
    } catch (err) {
      replace(reply, { kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chat" aria-label="Chat">
      <div className="messages" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "user" && <div className="bubble">{m.text}</div>}
            {m.role === "assistant" && (
              <div className="assistant-body">
                <div className="avatar" aria-hidden="true" />
                <div className="content">
                  {m.kind === "text" && <p className="pre">{m.text}</p>}
                  {m.kind === "loading" && <p className="loading">{m.text}</p>}
                  {m.kind === "error" && <p className="error" role="alert">{m.text}</p>}
                  {m.kind === "results" && (
                    m.results.length === 0
                      ? <p>No encontré ningún documento para eso. Prueba con otras palabras.</p>
                      : <>
                          <p>{m.results.length} {m.results.length === 1 ? "documento encontrado" : "documentos encontrados"}{m.usedAI ? " (búsqueda ampliada)" : ""}:</p>
                          {m.results.map((d) => <DocumentCard key={d._id} doc={d} />)}
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
        <div className="input-row">
          <textarea ref={inputRef} rows={1} value={input} onChange={onType} aria-label="Mensaje"
            placeholder="¿Qué documento buscas?"
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(e)} />
          <button className="send" disabled={busy || !input.trim()} aria-label="Enviar">↑</button>
        </div>
        <p className="hint">Enter para enviar · Shift+Enter para salto de línea</p>
      </form>
    </section>
  );
}
