import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { toast } from "./toast";
import { BookIcon, HomeIcon, ChevronRightIcon, UploadIcon, DownloadIcon, HistoryIcon, LockIcon, FileIcon } from "./icons";

// Mismo troceado que server/src/guide.js, solo para los contadores del editor
const SEPARATOR = /^\s*[-=_]{5,}\s*$/m;
const ADMIN_TAG = /^\s*\[\s*solo\s+admin\s*\]/i;
function countEntries(text) {
  const blocks = text.split(new RegExp(SEPARATOR.source, "gm")).map((b) => b.trim()).filter(Boolean);
  return { total: blocks.length, adminOnly: blocks.filter((b) => ADMIN_TAG.test(b)).length };
}

// Un .txt del Bloc de notas puede venir en UTF-8 o en ANSI de Windows (tildes como bytes sueltos)
async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(buf);
  }
}

const fecha = (d) => (d ? new Date(d).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

// Editor de la Guía rápida (solo admin): el texto entero, como un .txt
export default function GuideEditor() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(null); // {text, version, updatedAt, updatedBy}
  const [versions, setVersions] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const dirty = saved !== null && text !== saved.text;
  const counts = useMemo(() => countEntries(text), [text]);

  async function load() {
    try {
      const g = await api.guide();
      setSaved(g);
      setText(g.text);
      setError("");
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  // Aviso al cerrar o recargar la pestaña con cambios sin guardar
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function save() {
    setBusy(true);
    setError("");
    try {
      const r = await api.saveGuide(text, saved.version);
      setSaved({ ...saved, ...r, text });
      setVersions(null);
      toast("Guía rápida guardada");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const content = await readTextFile(file);
    if (text.trim() && !confirm(`¿Sustituir el texto del editor por el de «${file.name}»? No se guarda hasta que pulses «Guardar».`)) return;
    setText(content.replace(/\r\n?/g, "\n"));
    toast(`«${file.name}» cargado en el editor`);
  }

  function download() {
    const blob = new Blob(["﻿" + text.replace(/\n/g, "\r\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "Guia rapida.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function showVersions() {
    try { setVersions(await api.guideVersions()); } catch (e) { setError(e.message); }
  }

  async function loadVersion(v) {
    if (dirty && !confirm("Tienes cambios sin guardar. ¿Cargar la versión anterior en el editor?")) return;
    try {
      const r = await api.guideVersion(v._id);
      setText(r.text);
      toast(`Versión del ${fecha(v.savedAt)} cargada: pulsa «Guardar» para recuperarla`);
    } catch (e) { setError(e.message); }
  }

  if (saved === null && !error) return null;

  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><HomeIcon size={12} />Administración<ChevronRightIcon size={12} />Guía rápida</div>
      <div className="page-head">
        <div>
          <h1>Guía rápida</h1>
          <p>Apuntes cortos que el chat consulta antes que la biblioteca, en los dos modos. No aparecen en «Documentos».</p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}><UploadIcon size={14} />Importar .txt</button>
          <input ref={fileRef} type="file" accept=".txt,text/plain" hidden onChange={importFile} />
          <button type="button" className="btn btn-secondary" onClick={download} disabled={!text}><DownloadIcon size={14} />Descargar .txt</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{dirty ? "Guardar" : "Guardado"}</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="k"><BookIcon size={14} />Entradas</div><div className="v">{counts.total}</div></div>
        <div className="stat"><div className="k"><LockIcon size={14} />Solo admin</div><div className="v">{counts.adminOnly}</div></div>
        <div className="stat"><div className="k"><FileIcon size={14} />Caracteres</div><div className="v">{text.length.toLocaleString("es-ES")}</div></div>
        <div className="stat"><div className="k"><HistoryIcon size={14} />Última edición</div><div className="v sm">{saved?.updatedAt ? `${fecha(saved.updatedAt)} · ${saved.updatedBy}` : "—"}</div></div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Texto de la guía {dirty && <span className="badge warn">Sin guardar</span>}</h2>
            <p>
              Separa cada entrada con una línea de guiones (<code>-----</code>); la primera línea es su título.
              Empieza una entrada con <code>[solo admin]</code> para que solo la vean los administradores
              (contraseñas, datos internos): los demás usuarios no la recibirán nunca en el chat.
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={versions ? () => setVersions(null) : showVersions}><HistoryIcon size={14} />Versiones</button>
        </div>
        {versions && (
          <div className="card-body guide-versions">
            {versions.length === 0 ? <p className="help">Todavía no hay versiones anteriores.</p> : versions.map((v) => (
              <div key={v._id} className="guide-version">
                <span>{fecha(v.savedAt)} · {v.savedBy || "?"} · {v.length.toLocaleString("es-ES")} caracteres</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadVersion(v)}>Cargar en el editor</button>
              </div>
            ))}
          </div>
        )}
        <div className="card-body">
          <label className="sr" htmlFor="guideText">Texto de la guía rápida</label>
          <textarea id="guideText" className="textarea guide-text" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={"Restaurar archivos.\nOpción 1, ...\n\n-----\n\nTeléfonos.\n..."} />
        </div>
      </div>
    </div></div>
  );
}
