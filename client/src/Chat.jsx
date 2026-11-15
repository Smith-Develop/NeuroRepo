import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import DocumentCard from "./DocumentCard";
import Docu from "./Docu";
import { toast } from "./toast";
import { FolderIcon, LockIcon, SendIcon } from "./icons";

let seq = 0;
const nextId = () => `m${++seq}`;
const now = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

const SUGERENCIAS = ["Política de vacaciones", "Modelo de contrato", "Manual de mantenimiento"];

export default function Chat({ user, onOpenDocumentos }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const landing = messages.length === 0;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  const push = (...m) => setMessages((all) => [...all, ...m]);
  const replace = (id, m) => setMessages((all) => all.map((x) => (x.id === id ? { ...x, ...m } : x)));

  function onType(e) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
  }

  function useSuggestion(text) {
    setInput(text);
    inputRef.current?.focus();
  }

  async function requestAccess(folder) {
    try {
      await api.requestAccess(folder);
      toast(`Solicitud enviada al administrador`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function send(e) {
    e?.preventDefault();
    const t = input.trim();
    if (!t || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    const reply = nextId();
    push(
      { id: nextId(), role: "user", text: t, time: now() },
      { id: reply, role: "assistant", kind: "loading", text: "Buscando en la biblioteca…", time: now() },
    );
    setBusy(true);
    try {
      const { results, blocked, folder: blockedFolder, message, usedAI } = await api.ask(t);
      if (blocked) {
        replace(reply, { kind: "blocked", text: message, folder: blockedFolder });
      } else {
        replace(reply, { kind: "results", results, usedAI });
      }
    } catch (err) {
      replace(reply, { kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const composer = (
    <form className="composer" onSubmit={send}>
      <div className="input-row">
        <textarea ref={inputRef} rows={1} value={input} onChange={onType} aria-label="Mensaje"
          placeholder="Busca por nombre, tema o palabras clave…" autoFocus={landing}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(e)} />
        <button className="send" disabled={busy || !input.trim()} aria-label="Enviar">
          <SendIcon size={16} />
        </button>
      </div>
    </form>
  );

  if (landing) {
    return (
      <section className="chat chat-landing" aria-label="Chat">
        <div className="landing-hero">
          <Docu size={96} />
          <p className="landing-greeting">Hola, {user?.name || "Admin"}</p>
          <h1 className="landing-title">¿Qué documento buscas hoy?</h1>
          <p className="landing-sub">Escribe un nombre, un tema o unas palabras clave y te muestro los documentos que mejor coincidan, con opción de verlos o descargarlos.</p>
          {composer}
          <div className="landing-suggestions">
            {SUGERENCIAS.map((text) => (
              <button type="button" key={text} className="ghost suggestion-chip" onClick={() => useSuggestion(text)}>{text}</button>
            ))}
            {onOpenDocumentos && (
              <button type="button" className="ghost suggestion-chip" onClick={onOpenDocumentos}>
                <FolderIcon size={14} /> Ver toda la biblioteca
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="chat" aria-label="Chat">
      <div className="messages" aria-live="polite">
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            {m.role === "assistant" && <span className="avatar avatar-bot"><Docu size={30} animated={false} mode={m.kind === "loading" ? "loading" : "idle"} /></span>}
            <div className="msg-body">
              <div className="msg-name">
                <b>{m.role === "user" ? (user?.name || "Tú") : "Docu"}</b>{m.time}
              </div>
              {m.role === "user" && <div className="bubble">{m.text}</div>}
              {m.role === "assistant" && m.kind === "loading" && (
                <div className="bubble">
                  <div className="loading-row"><span className="dots"><i /><i /><i /></span>{m.text}</div>
                </div>
              )}
              {m.role === "assistant" && m.kind === "error" && (
                <div className="bubble content"><p className="error pre" role="alert">{m.text}</p></div>
              )}
              {m.role === "assistant" && m.kind === "blocked" && (
                <div className="blocked">
                  <span className="ic"><LockIcon size={16} /></span>
                  <div>
                    <p className="pre">{m.text}</p>
                    {m.folder && (
                      <button type="button" className="btn-accent small" onClick={() => requestAccess(m.folder)}>Solicitar acceso a {m.folder}</button>
                    )}
                  </div>
                </div>
              )}
              {m.role === "assistant" && m.kind === "results" && (
                <>
                  <div className="bubble content">
                    {m.results.length === 0
                      ? <p className="pre">No encontré ningún documento para eso. Prueba con otras palabras.</p>
                      : <p className="pre">{m.results.length} {m.results.length === 1 ? "documento encontrado" : "documentos encontrados"}{m.usedAI ? " (búsqueda ampliada)" : ""}:</p>}
                  </div>
                  {m.results.length > 0 && (
                    <div className="doc-row">
                      {m.results.map((d) => <DocumentCard key={d._id} doc={d} />)}
                    </div>
                  )}
                </>
              )}
            </div>
            {m.role === "user" && <span className="avatar avatar-user">{(user?.name || "?").trim().slice(0, 2).toUpperCase()}</span>}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {composer}
      <p className="hint composer-hint">Enter para enviar · Shift+Enter para salto de línea</p>
    </section>
  );
}
