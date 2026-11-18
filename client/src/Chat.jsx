import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import DocumentCard from "./DocumentCard";
import GuideCard from "./GuideCard";
import Docu from "./Docu";
import { toast } from "./toast";
import { FolderIcon, ChevronDownIcon, ChevronRightIcon, UpArrowIcon, LockIcon, SendRequestIcon, CalendarIcon, FileIcon, WrenchIcon, SearchIcon, SparkleIcon } from "./icons";
import { getConversation, saveConversation } from "./chatHistory";

let seq = 0;
// Únicos también frente a los mensajes restaurados del historial (de otras sesiones)
const nextId = () => `m${Date.now().toString(36)}${++seq}`;

// Modo del chat: "simple" (buscar documentos) o "advanced" (la IA lee los documentos encontrados y
// responde). Se recuerda por navegador.
const MODE_KEY = "neurorepo.chatMode";
function initialMode() {
  try { return localStorage.getItem(MODE_KEY) === "advanced" ? "advanced" : "simple"; } catch { return "simple"; }
}

// Una búsqueda que seguía en marcha cuando se guardó (recarga, cerrar pestaña) no se puede reanudar
const restorable = (messages) => messages.map((m) => (m.kind === "loading" ? { ...m, kind: "error", text: "La búsqueda se interrumpió. Vuelve a lanzarla." } : m));

// Turnos anteriores del modo avanzado (pregunta + respuesta de la IA), para que el servidor entienda
// las preguntas de seguimiento como en una conversación
function conversationHistory(messages, max = 3) {
  const turns = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const q = messages[i], a = messages[i + 1];
    if (q.role === "user" && a.kind === "results" && a.answer) turns.push({ q: q.text, a: a.answer });
  }
  return turns.slice(-max);
}

// En los dos modos se muestra el documento que más coincide (en avanzada, también los que cite la
// respuesta); el resto, solo si el usuario pide verlos («¿Quieres ver N archivos relacionados más?»)
function visibleResults(m) {
  if (m.expanded) return m.results;
  if (!m.answer) return m.results.slice(0, 1);
  return m.results.filter((_, i) => i === 0 || (i < m.sourceCount && m.answer.includes(`[${i + 1}]`)));
}

// Texto de la respuesta con las citas [n] resaltadas
function AnswerText({ text }) {
  const parts = text.split(/(\[\d+\]|\[Gu[ií]a\])/g);
  return (
    <div className="answer">
      {parts.map((p, i) => (/^\[\d+\]$/.test(p) ? <span key={i} className="cite">{p.slice(1, -1)}</span>
        : /^\[Gu[ií]a\]$/.test(p) ? <span key={i} className="cite guide">Guía</span> : p))}
    </div>
  );
}
const now = () => new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

const SUGERENCIAS = [
  { q: "Política de vacaciones", Icon: CalendarIcon },
  { q: "Modelo de contrato", Icon: FileIcon },
  { q: "Manual de mantenimiento", Icon: WrenchIcon },
];

function Composer({ dock, value, onChange, onSend, scope, scopeOptions, onScope, mode, onMode, autoFocus }) {
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
        placeholder={mode === "advanced"
          ? "Pregunta lo que quieras saber: Docu lo buscará dentro de los documentos…"
          : dock ? "Afina la búsqueda o pregunta otra cosa…" : "Ej.: política de vacaciones, contrato indefinido…"}
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
        <div className="seg" role="group" aria-label="Modo de búsqueda">
          <button type="button" className={mode === "simple" ? "on" : ""} aria-pressed={mode === "simple"} onClick={() => onMode("simple")}
            title="Busca documentos por coincidencia de texto (rápido)"><SearchIcon size={13} /><span className="seg-lbl">Simple</span></button>
          <button type="button" className={mode === "advanced" ? "on" : ""} aria-pressed={mode === "advanced"} onClick={() => onMode("advanced")}
            title="La IA lee los documentos encontrados y responde a tu pregunta (más lento)"><SparkleIcon size={13} /><span className="seg-lbl">Avanzada</span></button>
        </div>
        <span className="grow" />
        <span className="tip"><span className="kbd">↵</span> {mode === "advanced" ? "preguntar" : "buscar"}</span>
        <button className="send" type="submit" disabled={!value.trim()} aria-label="Buscar"><UpArrowIcon size={16} /></button>
      </div>
    </form>
  );
}

export default function Chat({ user, conversationId, topFolders = [], onOpenDocumentos, onNew }) {
  const [saved] = useState(() => getConversation(user._id, conversationId));
  const [messages, setMessages] = useState(() => restorable(saved?.messages || []));
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState(saved?.scope || "all");
  const [mode, setModeState] = useState(initialMode);

  function setMode(m) {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* sin almacenamiento: solo para esta sesión */ }
  }

  // Guarda la conversación en el historial del navegador cada vez que cambia
  useEffect(() => {
    if (!messages.length) return;
    const title = messages.find((m) => m.role === "user")?.text || "Búsqueda";
    saveConversation(user._id, { id: conversationId, title: title.slice(0, 80), scope, messages: restorable(messages) });
  }, [messages, scope, user._id, conversationId]);
  const threadRef = useRef(null);

  const landing = messages.length === 0;
  const scopeOptions = topFolders;

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
    const where = scope === "all" ? "tu biblioteca" : `«${scope}»`;
    push(
      { id: nextId(), role: "user", text: q, time: now(), mode },
      { id: reply, role: "assistant", kind: "loading", time: now(),
        text: mode === "advanced" ? `Leyendo los documentos de ${where} para responderte (puede tardar un poco)…` : `Buscando en ${where}…` },
    );
    setBusy(true);
    try {
      const history = mode === "advanced" ? conversationHistory(messages) : [];
      const { results, blocked, folder: blockedFolder, message, usedAI, answer, sourceCount, aiError, guide, highlight } = await api.ask(q, mode, scope === "all" ? "" : scope, history);
      if (blocked) {
        replace(reply, { kind: "blocked", text: message, folder: blockedFolder });
      } else {
        replace(reply, { kind: "results", results, usedAI, mode, answer, sourceCount, aiError, guide: guide || [], highlight: highlight || [] });
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
          <Composer value={input} onChange={setInput} onSend={() => ask(input)} scope={scope} scopeOptions={scopeOptions} onScope={setScope} mode={mode} onMode={setMode} autoFocus />
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={onNew}>Nueva</button>
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
                {m.kind === "results" && m.answer && (
                  <div className="bubble">
                    <span className="badge accent ai-badge"><SparkleIcon size={12} />Respuesta con IA</span>
                    <AnswerText text={m.answer} />
                    <p className="ai-note">Generada por IA a partir del documento de abajo: compruébala en el original antes de usarla.</p>
                  </div>
                )}
                {m.kind === "results" && m.guide?.length > 0 && (
                  <div className="results">
                    {m.guide.map((g, i) => <GuideCard key={i} entry={g} highlight={m.highlight} />)}
                  </div>
                )}
                {m.kind === "results" && !m.answer && !(m.guide?.length && !m.results.length && !m.aiError) && (
                  <div className="bubble">
                    {m.aiError && <p className="error">No he podido preparar la respuesta con IA ({m.aiError}). Te muestro los documentos encontrados.</p>}
                    <p>
                      {m.results.length === 0
                        ? "No he encontrado coincidencias para esa búsqueda. Prueba con otras palabras."
                        : `${m.guide?.length ? "En la biblioteca, además, h" : "H"}e encontrado ${m.results.length} documento${m.results.length > 1 ? "s" : ""}${m.usedAI ? " (búsqueda ampliada)" : ""}.`}
                    </p>
                  </div>
                )}
                {m.kind === "results" && m.results.length > 0 && (
                  <div className="results">
                    {visibleResults(m).map((d) => {
                      const i = m.results.indexOf(d);
                      return <DocumentCard key={d._id} doc={d} score={d.score} maxScore={m.results[0].score || 1} rank={i} cite={m.answer && i < m.sourceCount ? i + 1 : undefined} highlight={m.highlight} />;
                    })}
                  </div>
                )}
                {m.kind === "results" && !m.expanded && m.results.length > visibleResults(m).length && (
                  <div className="followups">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => replace(m.id, { expanded: true })}>
                      ¿Quieres ver {m.results.length - visibleResults(m).length} archivo{m.results.length - visibleResults(m).length > 1 ? "s" : ""} relacionado{m.results.length - visibleResults(m).length > 1 ? "s" : ""} más?
                    </button>
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
          <Composer dock value={input} onChange={setInput} onSend={() => ask(input)} scope={scope} scopeOptions={scopeOptions} onScope={setScope} mode={mode} onMode={setMode} />
          <div className="foot">Docu solo muestra documentos de las carpetas que tu grupo tiene permitidas.</div>
        </div>
      </div>
    </div>
  );
}
