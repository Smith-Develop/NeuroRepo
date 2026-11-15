import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import DocumentCard from "./DocumentCard";
import Docu from "./Docu";
import { toast } from "./toast";
import { CalendarIcon, ChatIcon, ChevronDownIcon, CopyIcon, FileIcon, FolderIcon, LockIcon, PlusIcon, SendIcon, ThumbIcon, WrenchIcon } from "./icons";

let seq = 0;
const nextId = () => `m${++seq}`;
const now = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const STOP = new Set(["los", "las", "del", "con", "para", "una", "que", "por", "como"]);
const queryTerms = (q) => [...new Set(norm(q).split(/[^a-z0-9ñ]+/).filter((t) => t.length > 2 && !STOP.has(t)))];

const SUGERENCIAS = [
  { text: "Manual de procedimientos", Icon: FileIcon },
  { text: "Formato de solicitud", Icon: CalendarIcon },
  { text: "Política de la empresa", Icon: WrenchIcon },
];

export default function Chat({ user, folders = [], onOpenDocumentos }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("all");
  const [scopeOpen, setScopeOpen] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const scopeRef = useRef(null);

  const landing = messages.length === 0;
  const scopeLabel = scope === "all" ? "Todas mis carpetas" : scope;

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);
  useEffect(() => {
    if (!scopeOpen) return;
    function onDoc(e) { if (!scopeRef.current?.contains(e.target)) setScopeOpen(false); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [scopeOpen]);

  const push = (...m) => setMessages((all) => [...all, ...m]);
  const replace = (id, m) => setMessages((all) => all.map((x) => (x.id === id ? { ...x, ...m } : x)));

  function resetChat() {
    setMessages([]);
    setScope("all");
  }

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

  async function copyAnswer(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Resultados copiados");
    } catch {
      toast("No se pudo copiar");
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
      { id: reply, role: "assistant", kind: "loading", text: `Buscando en ${scope === "all" ? "tu biblioteca" : `«${scope}»`}…`, time: now() },
    );
    setBusy(true);
    try {
      const { results, blocked, folder: blockedFolder, message, usedAI } = await api.ask(t);
      if (blocked) {
        replace(reply, { kind: "blocked", text: message, folder: blockedFolder });
      } else {
        const filtered = scope === "all" ? results : results.filter((d) => (d.topFolder || d.folder) === scope);
        replace(reply, { kind: "results", results: filtered, usedAI, terms: queryTerms(t), narrowed: scope !== "all" && filtered.length !== results.length });
      }
    } catch (err) {
      replace(reply, { kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  const scopePicker = folders.length > 0 && (
    <div className="row-menu" ref={scopeRef}>
      <button type="button" className="scope-btn" onClick={() => setScopeOpen((o) => !o)}>
        <FolderIcon size={13} /> {scopeLabel} <ChevronDownIcon size={13} />
      </button>
      {scopeOpen && (
        <div className="menu" style={{ left: 0, right: "auto" }} role="menu">
          <button type="button" className={scope === "all" ? "on" : ""} onClick={() => { setScope("all"); setScopeOpen(false); }}>
            <FolderIcon size={14} /> Todas mis carpetas
          </button>
          <hr />
          {folders.map((f) => (
            <button type="button" key={f} className={scope === f ? "on" : ""} onClick={() => { setScope(f); setScopeOpen(false); }}>
              <FolderIcon size={14} /> {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const composer = (
    <form className="composer" onSubmit={send}>
      <div className="input-row">
        <textarea ref={inputRef} rows={1} value={input} onChange={onType} aria-label="Mensaje"
          placeholder="Busca por nombre, tema o palabras clave…" autoFocus={landing}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send(e)} />
        <div className="composer-bar">
          {scopePicker}
          <span className="grow" />
          <span className="hint" style={{ margin: 0 }}>Enter para enviar</span>
          <button className="send" disabled={busy || !input.trim()} aria-label="Enviar">
            <SendIcon size={16} />
          </button>
        </div>
      </div>
    </form>
  );

  if (landing) {
    return (
      <section className="chat chat-landing" aria-label="Chat">
        <div className="landing-hero">
          <div className="halo"><Docu size={88} /></div>
          <span className="eyebrow"><span className="tag">Docu</span> Hola, {user?.name || "Admin"} 👋</span>
          <h1 className="landing-title">¿Qué documento buscas hoy?</h1>
          <p className="landing-sub">Escribe un nombre, un tema o unas palabras clave y te muestro los documentos que mejor coincidan, con opción de verlos o descargarlos.</p>
          {composer}
          <div className="landing-suggestions">
            {SUGERENCIAS.map(({ text, Icon }) => (
              <button type="button" key={text} className="sugg" onClick={() => useSuggestion(text)}>
                <span className="sugg-ic"><Icon size={15} /></span>
                <b>{text}</b>
              </button>
            ))}
          </div>
          {onOpenDocumentos && (
            <button type="button" className="landing-browse" onClick={onOpenDocumentos}>
              <FolderIcon size={14} /> Explorar toda la biblioteca
            </button>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat-head">
        <ChatIcon style={{ color: "var(--muted-2)" }} />
        <b>{messages.find((m) => m.role === "user")?.text?.slice(0, 48) || "Nueva búsqueda"}</b>
        <span className="folder-badge"><FolderIcon size={12} /> {scopeLabel}</span>
        <span className="grow" />
        <button type="button" className="ghost small" onClick={resetChat}><PlusIcon size={14} /> Nueva</button>
      </div>
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
                    <b>Este documento está en una carpeta restringida</b>
                    <p>{m.text}</p>
                    {m.folder && (
                      <button type="button" className="btn-accent small" onClick={() => requestAccess(m.folder)}>
                        <SendIcon size={13} /> Solicitar acceso a {m.folder}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {m.role === "assistant" && m.kind === "results" && (
                <>
                  <div className="bubble content">
                    {m.results.length === 0
                      ? <p className="pre">{m.narrowed ? `No encontré nada en «${scopeLabel}». Prueba con «Todas mis carpetas».` : "No encontré ningún documento para eso. Prueba con otras palabras."}</p>
                      : <p className="pre">{m.results.length} {m.results.length === 1 ? "documento encontrado" : "documentos encontrados"}{m.usedAI ? " (búsqueda ampliada)" : ""}:</p>}
                  </div>
                  {m.results.length > 0 && (
                    <>
                      <div className="doc-row">
                        {m.results.map((d) => <DocumentCard key={d._id} doc={d} terms={m.terms} maxScore={m.results[0].score} />)}
                      </div>
                      <div className="msg-acts">
                        <button type="button" className="icon-btn" title="Copiar" onClick={() => copyAnswer(m.results.map((d) => d.filename).join("\n"))}><CopyIcon size={13} /></button>
                        <button type="button" className="icon-btn" title="Útil" onClick={() => toast("¡Gracias por tu valoración!")}><ThumbIcon size={13} /></button>
                      </div>
                    </>
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
    </section>
  );
}
