import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";
import { AppContext } from "./appContext";
import {
  BookIcon, HomeIcon, ChevronRightIcon, UploadIcon, DownloadIcon, HistoryIcon, LockIcon, PlusIcon, SearchIcon,
  TrashIcon, XIcon, RestoreIcon, FolderIcon, ListIcon, InfoIcon,
} from "./icons";

// Constructor de la Guía rápida: fichas con formulario según su tipo (server/src/guide.js). Lo usan
// los admins y los usuarios a los que un admin se lo permita (Usuarios → «Permitir editar la guía»);
// estos últimos no ven ni crean fichas «solo admin» ni de accesos.
const TYPES = {
  nota: { label: "Nota", help: "Texto libre: datos, rutas, explicaciones." },
  aplicacion: { label: "Aplicación (alta)", help: "Cómo se da de alta a alguien en una aplicación." },
  procedimiento: { label: "Procedimiento", help: "Pasos numerados para resolver algo." },
  contacto: { label: "Contacto", help: "Una persona o servicio: teléfono y correo." },
  acceso: { label: "Acceso / credenciales", help: "Usuarios y contraseñas: siempre solo admin." },
};
const APP_FIELDS = [
  ["acceso", "Acceso permitido a", "Administrativos, Facultativos…"],
  ["url", "Dirección", "https://…"],
  ["tramite", "Cómo se tramita el alta", "Desde GestiónAI, incidencia a CESUS…"],
  ["pide", "Cómo se pide", "Formulario «Solicitud Usuarios Aplic.», por correo…"],
  ["solicita", "Quién lo solicita", "Supervisores, Admisión…"],
];
const CONTACT_FIELDS = [
  ["nombre", "Nombre", "Persona o servicio"],
  ["telefono", "Extensión / móvil", "Ext. 1234 · 600 000 000"],
  ["correo", "Correo", "nombre@salud.madrid.org"],
];
const CONTENT_LABEL = {
  nota: "Contenido",
  aplicacion: "Más información (opcional)",
  procedimiento: "Introducción (opcional)",
  contacto: "Notas (opcional)",
  acceso: "Usuarios, contraseñas y datos",
};

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const fecha = (d) => (d ? new Date(d).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const heading = (e) => (e.category ? `${e.category} · ${e.title}` : e.title);

// Un .txt del Bloc de notas puede venir en UTF-8 o en ANSI de Windows (tildes como bytes sueltos)
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

function download(name, text) {
  // Con BOM y saltos de Windows: el Bloc de notas lo abre bien
  const blob = new Blob(["﻿" + text.replace(/\r?\n/g, "\r\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Ficha guardada → estado del formulario, y al revés
const toForm = (e = {}) => ({
  type: e.type || "nota",
  category: e.category || "",
  title: e.title || "",
  keywords: (e.keywords || []).join(", "),
  content: e.content || "",
  fields: { ...(e.fields || {}) },
  grupos: (e.fields?.grupos || []).join("\n"),
  pasos: e.fields?.pasos?.length ? [...e.fields.pasos] : [""],
  adminOnly: Boolean(e.adminOnly),
});
function fromForm(f) {
  const fields = {};
  const keys = f.type === "aplicacion" ? [...APP_FIELDS.map((x) => x[0]), "observaciones"] : f.type === "contacto" ? CONTACT_FIELDS.map((x) => x[0]) : [];
  for (const k of keys) if (f.fields[k]?.trim()) fields[k] = f.fields[k].trim();
  if (f.type === "aplicacion") fields.grupos = f.grupos.split("\n").map((g) => g.trim()).filter(Boolean);
  if (f.type === "procedimiento") fields.pasos = f.pasos.map((p) => p.trim()).filter(Boolean);
  return {
    type: f.type,
    category: f.category.trim(),
    title: f.title.trim(),
    keywords: f.keywords.split(",").map((k) => k.trim()).filter(Boolean),
    content: f.content,
    fields,
    adminOnly: f.type === "acceso" || f.adminOnly,
  };
}

export default function GuideEditor() {
  const { user } = useContext(AppContext);
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState(null); // {entries, categories}
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [type, setType] = useState("");
  const [editing, setEditing] = useState(null); // {entry} (entry sin _id = nueva)
  const [panel, setPanel] = useState(null); // "synonyms" | "deleted"
  const fileRef = useRef(null);

  async function load() {
    try {
      setData(await api.guideEntries());
      setError("");
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  const entries = data?.entries || [];
  const shown = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return entries.filter((e) => {
      if (cat && e.category !== cat) return false;
      if (type && e.type !== type) return false;
      if (!words.length) return true;
      const hay = norm([e.category, e.title, ...(e.keywords || []), e.content, ...Object.values(e.fields || {}).flat()].join(" "));
      return words.every((w) => hay.includes(w));
    });
  }, [entries, q, cat, type]);
  const groups = useMemo(() => {
    const m = new Map();
    for (const e of shown) {
      const k = e.category || "Sin categoría";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(e);
    }
    return [...m];
  }, [shown]);
  const lastEdit = useMemo(() => entries.reduce((a, e) => (!a || new Date(e.updatedAt) > new Date(a.updatedAt) ? e : a), null), [entries]);

  async function importFile(ev) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
    try {
      const r = await api.importGuide(await readTextFile(file));
      await load();
      toast(`${r.created} ficha${r.created === 1 ? "" : "s"} nueva${r.created === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} ya existían` : ""}${r.forbidden ? `, ${r.forbidden} «solo admin» sin importar` : ""}`);
    } catch (e) { setError(e.message); }
  }

  async function exportFile() {
    try { download("Guia rapida.txt", await api.exportGuide()); } catch (e) { setError(e.message); }
  }

  async function remove(e) {
    if (!confirm(`¿Borrar la ficha «${heading(e)}»? Se puede recuperar desde «Borradas».`)) return;
    try {
      await api.deleteGuideEntry(e._id);
      await load();
      toast("Ficha borrada");
    } catch (err) { setError(err.message); }
  }

  if (data === null && !error) return null;

  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><HomeIcon size={12} />{isAdmin ? "Administración" : "Edición"}<ChevronRightIcon size={12} />Guía rápida</div>
      <div className="page-head">
        <div>
          <h1>Guía rápida</h1>
          <p>Fichas cortas que el chat consulta antes que la biblioteca, en los dos modos. No aparecen en «Documentos».</p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}><UploadIcon size={14} />Importar .txt</button>
          <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={importFile} />
          <button type="button" className="btn btn-secondary" onClick={exportFile} disabled={!entries.length}><DownloadIcon size={14} />Exportar .txt</button>
          <button type="button" className="btn btn-primary" onClick={() => setEditing({ entry: { category: cat, type: type || "nota" } })}><PlusIcon size={14} />Nueva ficha</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="k"><BookIcon size={14} />Fichas</div><div className="v">{entries.length}</div></div>
        <div className="stat"><div className="k"><FolderIcon size={14} />Categorías</div><div className="v">{new Set(entries.map((e) => e.category)).size}</div></div>
        {isAdmin && <div className="stat"><div className="k"><LockIcon size={14} />Solo admin</div><div className="v">{entries.filter((e) => e.adminOnly).length}</div></div>}
        <div className="stat"><div className="k"><HistoryIcon size={14} />Última edición</div><div className="v sm">{lastEdit ? `${fecha(lastEdit.updatedAt)} · ${lastEdit.updatedBy || "?"}` : "—"}</div></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="toolbar">
        <div className="input-icon" style={{ width: 260 }}><SearchIcon size={15} /><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar fichas…" aria-label="Buscar fichas" /></div>
        <select className="select" style={{ width: "auto" }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Categoría">
          <option value="">Todas las categorías</option>
          {[...new Set(entries.map((e) => e.category).filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="select" style={{ width: "auto" }} value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {Object.entries(TYPES).filter(([k]) => isAdmin || k !== "acceso").map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
        </select>
        <span className="grow" />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("synonyms")}><ListIcon size={14} />Sinónimos</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanel("deleted")}><RestoreIcon size={14} />Borradas</button>
      </div>

      {groups.length === 0 && (
        <div className="card"><div className="empty"><div className="ic"><BookIcon size={20} /></div>
          <b>{entries.length ? "Ninguna ficha coincide" : "Todavía no hay fichas"}</b>
          {entries.length ? "Prueba con otras palabras o quita los filtros." : "Crea la primera o importa el .txt de la guía."}
        </div></div>
      )}
      {groups.map(([category, list]) => (
        <div key={category} className="card guide-group">
          <div className="guide-group-head"><FolderIcon size={14} /><b>{category}</b><span className="count">{list.length}</span></div>
          {list.map((e) => (
            <div key={e._id} className="guide-row">
              <button type="button" className="guide-row-main" onClick={() => setEditing({ entry: e })}>
                <span className={`badge type-${e.type}`}>{TYPES[e.type]?.label || e.type}</span>
                <span className="guide-row-title">{e.title}</span>
                {e.adminOnly && <span className="badge warn"><LockIcon size={11} />Solo admin</span>}
                {(e.keywords || []).slice(0, 4).map((k) => <span key={k} className="badge kw">{k}</span>)}
              </button>
              <span className="guide-row-meta">{fecha(e.updatedAt)} · {e.updatedBy || "?"}</span>
              <button type="button" className="btn-icon sm" onClick={() => remove(e)} aria-label={`Borrar ${e.title}`} title="Borrar"><TrashIcon size={14} /></button>
            </div>
          ))}
        </div>
      ))}

      {editing && (
        <EntryDialog key={editing.entry._id || "nueva"} entry={editing.entry} categories={data?.categories || []} isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onOpen={(id) => { const e = entries.find((x) => x._id === id); if (e) setEditing({ entry: e }); }}
          onSaved={async (saved, created) => { await load(); setEditing(null); toast(created ? "Ficha creada" : "Ficha guardada"); }} />
      )}
      {panel === "synonyms" && <SynonymsDialog onClose={() => setPanel(null)} />}
      {panel === "deleted" && <DeletedDialog onClose={() => setPanel(null)} onRestored={load} />}
    </div></div>
  );
}

// Formulario de una ficha: campos según el tipo, avisos de duplicados mientras se escribe e historial
function EntryDialog({ entry, categories, isAdmin, onClose, onOpen, onSaved }) {
  const isNew = !entry._id;
  const initial = useMemo(() => toForm(entry), [entry]);
  const [f, setF] = useState(initial);
  const [check, setCheck] = useState(null);
  const [history, setHistory] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const set = (patch) => setF((p) => ({ ...p, ...patch }));
  const setField = (k, v) => setF((p) => ({ ...p, fields: { ...p.fields, [k]: v } }));

  // Avisos de duplicados (título igual o parecido, grupos AD y direcciones repetidas), sin guardar
  useEffect(() => {
    if (!f.title.trim() && !f.grupos.trim() && !f.fields.url) { setCheck(null); return undefined; }
    const t = setTimeout(() => {
      api.checkGuideEntry(fromForm(f), entry._id).then(setCheck).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [f.title, f.category, f.grupos, f.fields.url, f.type]); // eslint-disable-line react-hooks/exhaustive-deps

  function close() {
    if (dirty && !confirm("Hay cambios sin guardar en esta ficha. ¿Cerrar igualmente?")) return;
    onClose();
  }
  function open(id) {
    if (dirty && !confirm("Hay cambios sin guardar en esta ficha. ¿Abrir la otra igualmente?")) return;
    onOpen(id);
  }

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = fromForm(f);
      const saved = isNew ? await api.createGuideEntry(body) : await api.updateGuideEntry(entry._id, body, entry.version);
      onSaved(saved, isNew);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function showHistory() {
    try { setHistory(await api.guideEntryHistory(entry._id)); } catch (e) { setError(e.message); }
  }
  function loadVersion(h) {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Cargar la versión anterior en el formulario?")) return;
    setF(toForm(h.snapshot));
    setHistory(null);
    toast(`Versión del ${fecha(h.savedAt)} cargada: pulsa «Guardar» para recuperarla`);
  }

  const lockedAdmin = f.type === "acceso";
  const blocked = Boolean(check?.same);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="ficT" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <form className="dialog wide guide-dialog" onSubmit={submit}>
        <div className="dlg-head">
          <div className="tt">
            <h3 id="ficT">{isNew ? "Nueva ficha" : heading(entry)}</h3>
            <p>{isNew ? "Rellena los campos: el chat la encontrará por el título, la categoría, las palabras clave y el contenido." : `Última edición: ${fecha(entry.updatedAt)} · ${entry.updatedBy || "?"}`}</p>
          </div>
          {!isNew && <button type="button" className="btn btn-ghost btn-sm" onClick={history ? () => setHistory(null) : showHistory}><HistoryIcon size={14} />Historial</button>}
          <button type="button" className="btn-icon" onClick={close} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          {history && (
            <div className="guide-versions">
              {history.length === 0 ? <p className="help">Esta ficha todavía no tiene versiones anteriores.</p> : history.map((h) => (
                <div key={h._id} className="guide-version">
                  <span>{fecha(h.savedAt)} · {h.savedBy || "?"} · «{h.snapshot?.title}»</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadVersion(h)}>Cargar en el formulario</button>
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <span className="label">Tipo de ficha</span>
            <div className="seg guide-types" role="radiogroup" aria-label="Tipo de ficha">
              {Object.entries(TYPES).filter(([k]) => isAdmin || k !== "acceso").map(([k, t]) => (
                <button key={k} type="button" role="radio" aria-checked={f.type === k} className={f.type === k ? "on" : ""} onClick={() => set({ type: k })}>{t.label}</button>
              ))}
            </div>
            <span className="help">{TYPES[f.type].help}</span>
          </div>

          <div className="guide-grid">
            <div className="field">
              <label htmlFor="ficCat">Categoría</label>
              <input className="input" id="ficCat" list="ficCats" maxLength={60} value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="Elige una o escribe una nueva" />
              <datalist id="ficCats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="ficTitle">Título</label>
              <input className="input" id="ficTitle" required maxLength={150} value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.type === "aplicacion" ? "Nombre de la aplicación" : "Qué resuelve esta ficha"} autoFocus={isNew} />
            </div>
          </div>

          {check && (check.same || check.similar.length > 0 || check.grupos.length > 0 || check.url.length > 0) && (
            <div className={`guide-warn${blocked ? " danger" : ""}`} role="status">
              <InfoIcon size={15} />
              <div>
                {check.same && <p><b>Ya existe una ficha con este título en esta categoría.</b> No se puede guardar otra igual: {check.same._id ? <button type="button" className="link" onClick={() => open(check.same._id)}>abrir «{heading(check.same)}»</button> : "es «solo admin»."}</p>}
                {check.similar.length > 0 && <p>Títulos parecidos: {check.similar.map((s, i) => <span key={s._id}>{i > 0 && ", "}<button type="button" className="link" onClick={() => open(s._id)}>{heading(s)}</button></span>)}. ¿No será mejor completar una de ellas?</p>}
                {check.grupos.map((g) => <p key={g.value}>El grupo <code>{g.value}</code> ya está en: {g.entries.map((s, i) => <span key={s._id}>{i > 0 && ", "}<button type="button" className="link" onClick={() => open(s._id)}>{heading(s)}</button></span>)}.</p>)}
                {check.url.length > 0 && <p>Esa dirección ya está en: {check.url.map((s, i) => <span key={s._id}>{i > 0 && ", "}<button type="button" className="link" onClick={() => open(s._id)}>{heading(s)}</button></span>)}.</p>}
              </div>
            </div>
          )}

          {f.type === "aplicacion" && (
            <div className="guide-grid">
              {APP_FIELDS.map(([k, label, ph]) => (
                <div key={k} className={`field${k === "url" ? " span2" : ""}`}>
                  <label htmlFor={`fic-${k}`}>{label}</label>
                  <input className="input" id={`fic-${k}`} maxLength={2000} value={f.fields[k] || ""} onChange={(e) => setField(k, e.target.value)} placeholder={ph} />
                </div>
              ))}
              <div className="field span2">
                <label htmlFor="fic-grupos">Grupos del directorio activo <span className="help">(uno por línea)</span></label>
                <textarea className="textarea mono" id="fic-grupos" rows={3} value={f.grupos} onChange={(e) => set({ grupos: e.target.value })} placeholder={"gHULP_EJEMPLO\ngHULP_OTRO"} />
              </div>
              <div className="field span2">
                <label htmlFor="fic-obs">Observaciones</label>
                <textarea className="textarea" id="fic-obs" rows={2} maxLength={2000} value={f.fields.observaciones || ""} onChange={(e) => setField("observaciones", e.target.value)} />
              </div>
            </div>
          )}

          {f.type === "contacto" && (
            <div className="guide-grid">
              {CONTACT_FIELDS.map(([k, label, ph]) => (
                <div key={k} className="field">
                  <label htmlFor={`fic-${k}`}>{label}</label>
                  <input className="input" id={`fic-${k}`} maxLength={2000} value={f.fields[k] || ""} onChange={(e) => setField(k, e.target.value)} placeholder={ph} />
                </div>
              ))}
            </div>
          )}

          <div className="field">
            <label htmlFor="ficContent">{CONTENT_LABEL[f.type]}</label>
            <textarea className={`textarea${f.type === "acceso" ? " mono" : ""}`} id="ficContent" rows={f.type === "nota" || f.type === "acceso" ? 8 : 3} maxLength={20000}
              value={f.content} onChange={(e) => set({ content: e.target.value })} required={f.type === "nota" || f.type === "acceso"} />
          </div>

          {f.type === "procedimiento" && (
            <div className="field">
              <span className="label">Pasos</span>
              <ol className="guide-steps">
                {f.pasos.map((p, i) => (
                  <li key={i}>
                    <textarea className="textarea" rows={Math.min(6, p.split("\n").length + Math.floor(p.length / 90))} value={p} aria-label={`Paso ${i + 1}`} placeholder={`Paso ${i + 1}`}
                      onChange={(e) => set({ pasos: f.pasos.map((x, j) => (j === i ? e.target.value : x)) })} />
                    <span className="guide-step-acts">
                      <button type="button" className="btn-icon sm" disabled={i === 0} onClick={() => { const n = [...f.pasos]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; set({ pasos: n }); }} aria-label="Subir paso" title="Subir">↑</button>
                      <button type="button" className="btn-icon sm" disabled={i === f.pasos.length - 1} onClick={() => { const n = [...f.pasos]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; set({ pasos: n }); }} aria-label="Bajar paso" title="Bajar">↓</button>
                      <button type="button" className="btn-icon sm" disabled={f.pasos.length === 1} onClick={() => set({ pasos: f.pasos.filter((_, j) => j !== i) })} aria-label="Quitar paso" title="Quitar"><XIcon size={13} /></button>
                    </span>
                  </li>
                ))}
              </ol>
              <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => set({ pasos: [...f.pasos, ""] })}><PlusIcon size={13} />Añadir paso</button>
            </div>
          )}

          <div className="guide-grid">
            <div className="field">
              <label htmlFor="ficKw">Palabras clave <span className="help">(separadas por comas)</span></label>
              <input className="input" id="ficKw" value={f.keywords} onChange={(e) => set({ keywords: e.target.value })} placeholder="Otras formas de preguntarlo: vpn, teletrabajo…" />
            </div>
            {isAdmin && (
              <div className="field">
                <span className="label">Quién la ve en el chat</span>
                <div className="seg" role="radiogroup" aria-label="Visibilidad">
                  <button type="button" role="radio" aria-checked={!f.adminOnly && !lockedAdmin} className={!f.adminOnly && !lockedAdmin ? "on" : ""} disabled={lockedAdmin} onClick={() => set({ adminOnly: false })}>Todos</button>
                  <button type="button" role="radio" aria-checked={f.adminOnly || lockedAdmin} className={f.adminOnly || lockedAdmin ? "on" : ""} onClick={() => set({ adminOnly: true })}><LockIcon size={12} />Solo admin</button>
                </div>
                {lockedAdmin && <span className="help">Las fichas de accesos siempre son solo para administradores.</span>}
              </div>
            )}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="dlg-foot">
          {dirty && <span className="badge warn">Sin guardar</span>}
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
          <button type="submit" className="btn btn-primary" disabled={busy || blocked || !f.title.trim()}>{isNew ? "Crear ficha" : "Guardar"}</button>
        </div>
      </form>
    </div>
  );
}

// Sinónimos de la búsqueda: un grupo de términos equivalentes por línea
function SynonymsDialog({ onClose }) {
  const [text, setText] = useState(null);
  const [saved, setSaved] = useState("");
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.synonyms().then((s) => { setText(s.text); setSaved(s.text); setMeta(s); }).catch((e) => setError(e.message));
  }, []);
  const dirty = text !== null && text !== saved;
  const groups = (text || "").split("\n").filter((l) => !l.trim().startsWith("#") && l.split(",").filter((t) => t.trim()).length >= 2).length;

  async function save() {
    setBusy(true);
    try {
      const s = await api.saveSynonyms(text);
      setSaved(s.text);
      setMeta(s);
      toast("Sinónimos guardados");
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  const close = () => { if (!dirty || confirm("Hay cambios sin guardar. ¿Cerrar igualmente?")) onClose(); };

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="synT" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="dialog wide">
        <div className="dlg-head">
          <div className="tt"><h3 id="synT">Sinónimos</h3><p>Palabras que significan lo mismo para la búsqueda (guía y documentos).</p></div>
          <button type="button" className="btn-icon" onClick={close} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          <p className="help" style={{ margin: 0 }}>
            Un grupo por línea, separado por comas: quien pregunte por cualquiera de ellas encontrará también las demás.
            Ejemplo: <code>vpn, forticlient, acceso remoto, teletrabajo</code>. Las líneas que empiezan por <code>#</code> son comentarios.
            Las erratas («imprsora», «centarlita») se corrigen solas, no hace falta ponerlas aquí.
          </p>
          {text !== null && (
            <textarea className="textarea mono guide-text" style={{ minHeight: "40vh" }} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
              aria-label="Sinónimos" placeholder={"vpn, forticlient, acceso remoto\ncorreo, owa, outlook, webmail\nimpresora, fotocopiadora, canon"} />
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
        <div className="dlg-foot">
          <span className="help">{groups} grupo{groups === 1 ? "" : "s"}{meta?.updatedAt ? ` · ${fecha(meta.updatedAt)} · ${meta.updatedBy}` : ""}</span>
          <span className="grow" />
          <button type="button" className="btn btn-ghost" onClick={close}>Cancelar</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function DeletedDialog({ onClose, onRestored }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const load = () => api.guideDeleted().then(setItems).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  async function restore(h) {
    try {
      await api.restoreGuideEntry(h._id);
      toast(`«${h.snapshot.title}» recuperada`);
      await load();
      onRestored();
    } catch (e) { setError(e.message); }
  }
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="delT" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dlg-head">
          <div className="tt"><h3 id="delT">Fichas borradas</h3><p>Las últimas fichas borradas, para recuperarlas.</p></div>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Cerrar"><XIcon /></button>
        </div>
        <div className="dlg-body">
          {items?.length === 0 && <p className="help">No hay fichas borradas.</p>}
          {items?.map((h) => (
            <div key={h._id} className="guide-version">
              <span><b>{heading(h.snapshot)}</b><br /><small className="help">Borrada el {fecha(h.savedAt)} por {h.savedBy || "?"}</small></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => restore(h)}><RestoreIcon size={14} />Recuperar</button>
            </div>
          ))}
          {error && <p className="error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
