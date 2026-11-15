import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import DocumentCard from "./DocumentCard";
import Docu from "./Docu";
import { toast } from "./toast";
import { FolderIcon, ChevronDownIcon, ChevronRightIcon, UpArrowIcon, LockIcon, SendRequestIcon, CalendarIcon, FileIcon, WrenchIcon } from "./icons";

let seq = 0;
const nextId = () => `m${++seq}`;
const now = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

const SUGERENCIAS = [
  { q: "Política de vacaciones", Icon: CalendarIcon },
  { q: "Modelo de contrato", Icon: FileIcon },
  { q: "Manual de mantenimiento", Icon: WrenchIcon },
];

function Composer({ dock, value, onChange, onSend, scope, scopeOptions, onScope, autoFocus }) {
  const taRef = useRef(null);
  const [scopeOpen, setScopeOpen] = useState(false);

  function fit(el) {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  return (
    <form className="composer" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
      <label className="sr" htmlFor="composer-input">Buscar documentos</label>
      <textarea id="composer-input" ref={taRef} rows={1} value={value} autoFocus={autoFocus}
        placeholder={dock ? "Afina la búsqueda o pregunta otra cosa…" : "Ej.: política de vacaciones, contrato indefinido…"}
        onChange={(e) => { onChange(e.target.value); fit(e.target); }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(); } }} />
      <div className="bar">
        <div style={{ position: "relative" }}>
          <button type="button" className="scope" onClick={() => setScopeOpen((o) => !o)}>
            <FolderIcon size={14} /><span>{scope === "all" ? "Todas mis carpetas" : scope}</span><ChevronDownIcon size={14} />
          </button>
          {scopeOpen && (
            <div className="menu on" style={{ position: "absolute", left: 0, bottom: "calc(100% + 8px)" }}
              onMouseLeave={() => setScopeOpen(false)}>
              <button type="button" onClick={() => { onScope("all"); setScopeOpen(false); }}><FolderIcon size={14} />Todas mis carpetas</button>
              {scopeOptions.length > 0 && <hr />}
              {scopeOptions.map((f) => (
                <button type="button" key={f} onClick={() => { onScope(f); setScopeOpen(false); }}><FolderIcon size={14} />{f}</button>
              ))}
            </div>
          )}
        </div>
        <span className="grow" />
        <span className="tip"><span className="kbd">↵</span> buscar</span>
        <button className="send" type="submit" disabled={!value.trim()} aria-label="Buscar"><UpArrowIcon size={16} /></button>
      </div>
    </form>
  );
}

export default function Chat({ user, documents = [], onOpenDocumentos }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("all");
  const threadRef = useRef(null);

  const landing = messages.length === 0;
  const scopeOptions = useMemo(() => [...new Set(documents.map((d) => d.topFolder).filter(Boolean))].sort(), [documents]);

  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const push = (...m) => setMessages((all) => [...all, ...m]);
  const replace = (id, m) => setMessages((all) => all.map((x) => (x.id === id ? { ...x, ...m } : x)));

  async function requestAccess(folder) {
    try {
      await api.requestAccess(folder);
      toast("Solicitud enviada al administrador");
    } catch (e) {
      toast(e.message);
    }
  }

  async function ask(q) {
    if (!q.trim() || busy) return;
    setInput("");
    const reply = nextId();
    push(
      { id: nextId(), role: "user", text: q, time: now() },
      { id: reply, role: "assistant", kind: "loading", text: `Buscando en ${scope === "all" ? "tu biblioteca" : `«${scope}»`}…`, time: now() },
    );
    setBusy(true);
    try {
      const { results, blocked, folder: blockedFolder, message, usedAI } = await api.ask(q);
      if (blocked) {
        replace(reply, { kind: "blocked", text: message, folder: blockedFolder });
      } else {
        const scoped = scope === "all" ? results : results.filter((d) => d.topFolder === scope);
        replace(reply, { kind: "results", results: scoped, usedAI });
      }
    } catch (err) {
      replace(reply, { kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (landing) {
    return (
      <div className="landing">
        <div className="landing-in">
          <div className="halo"><Docu size={84} /></div>
          <span className="eyebrow"><span className="badge accent">Docu</span>Hola, <b style={{ color: "var(--text)", fontWeight: 500 }}>{user?.name || "Admin"}</b> 👋</span>
          <h1>¿Qué documento buscas hoy?</h1>
          <p className="sub">Escribe un nombre, un tema o unas palabras clave. Docu busca en tus carpetas y te muestra los documentos más relevantes, listos para abrir o descargar.</p>
          <Composer value={input} onChange={setInput} onSend={() => ask(input)} scope={scope} scopeOptions={scopeOptions} onScope={setScope} autoFocus />
          <div className="suggest">
            {SUGERENCIAS.map(({ q, Icon }) => (
              <button type="button" key={q} className="sugg" onClick={() => ask(q)}>
                <span className="ic"><Icon size={15} /></span><b>{q}</b>
              </button>
            ))}
          </div>
          {onOpenDocumentos && (
            <button type="button" className="browse" onClick={onOpenDocumentos}>
              <FolderIcon size={14} />Explorar toda la biblioteca<ChevronRightIcon size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "column" }}>
      <div className="chat-head">
        <FolderIcon style={{ color: "var(--text-3)" }} />
        <b>{messages[0]?.text.length > 48 ? `${messages[0].text.slice(0, 48)}…` : messages[0]?.text}</b>
        <span className="badge">{scope === "all" ? "Todas mis carpetas" : scope}</span>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMessages([])}>Nueva</button>
      </div>
      <div className="thread" ref={threadRef}>
        <div className="thread-in">
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role === "user" ? "user" : "bot"}`}>
              {m.role === "assistant" && (
                <span className="bot-av"><Docu size={24} animated={false} mode={m.kind === "loading" ? "loading" : "idle"} /></span>
              )}
              <div className="body">
                <div className="meta"><b>{m.role === "user" ? (user?.name || "Tú") : "Docu"}</b>{m.time}</div>
                {m.role === "user" && <div className="bubble">{m.text}</div>}
                {m.kind === "loading" && (
                  <div className="thinking"><span className="dots"><i /><i /><i /></span>{m.text}</div>
                )}
                {m.kind === "error" && <div className="bubble"><p className="error">{m.text}</p></div>}
                {m.kind === "blocked" && (
                  <div className="blocked">
                    <span className="ic"><LockIcon size={16} /></span>
                    <div>
                      <b>Este documento está en una carpeta restringida</b>
                      <p>{m.text}</p>
                      {m.folder && (
                        <div className="followups">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => requestAccess(m.folder)}>
                            <SendRequestIcon size={13} />Solicitar acceso a {m.folder}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {m.kind === "results" && (
                  <div className="bubble">
                    <p>
                      {m.results.length === 0
                        ? "No he encontrado coincidencias para esa búsqueda. Prueba con otras palabras."
                        : `He encontrado ${m.results.length} documento${m.results.length > 1 ? "s" : ""}${m.usedAI ? " (búsqueda ampliada)" : ""}.`}
                    </p>
                  </div>
                )}
                {m.kind === "results" && m.results.length > 0 && (
                  <div className="results">
                    {m.results.map((d, i) => <DocumentCard key={d._id} doc={d} score={d.score} maxScore={m.results[0].score || 1} rank={i} />)}
                  </div>
                )}
              </div>
              {m.role === "user" && <span className="avatar">{(user?.name || "?").trim().slice(0, 2).toUpperCase()}</span>}
            </div>
          ))}
        </div>
      </div>
      <div className="dock">
        <div className="dock-in">
          <Composer dock value={input} onChange={setInput} onSend={() => ask(input)} scope={scope} scopeOptions={scopeOptions} onScope={setScope} />
          <div className="foot">Docu solo muestra documentos de las carpetas que tu grupo tiene permitidas.</div>
        </div>
      </div>
    </div>
  );
}
