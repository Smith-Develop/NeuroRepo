import { Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { badgeFor, formatSize, formatDate, PREVIEWABLE, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT } from "./DocumentCard";
import DocumentModal from "./DocumentModal";
import { toast } from "./toast";
import { AppContext } from "./appContext";
import {
  FolderIcon, GridIcon, ListIcon, SearchIcon, HomeIcon, ChevronRightIcon, ChevronDownIcon,
  EyeIcon, RefreshIcon, UploadIcon, InfoIcon, DownloadIcon, TrashIcon,
} from "./icons";

const TYPES = [
  { id: "all", label: "Todos" },
  { id: "pdf", label: "PDF" },
  { id: "doc", label: "Word" },
  { id: "xls", label: "Excel" },
  { id: "other", label: "Otros" },
];
const CHILDREN_LIMIT_NOTE = "Esta carpeta tiene más de 2000 archivos: se muestran los primeros. Usa el filtro para encontrar el resto.";

// Árbol en memoria, solo para los resultados de un filtro (como mucho 200 documentos)
function buildTree(documents) {
  const root = { folders: new Map(), files: [] };
  for (const doc of documents) {
    const parts = doc.folder ? doc.folder.split("/") : [];
    let node = root;
    for (const part of parts) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
      node = node.folders.get(part);
    }
    node.files.push(doc);
  }
  return root;
}
function countAll(node) {
  return node.files.length + [...node.folders.values()].reduce((s, n) => s + countAll(n), 0);
}
function download(doc) { toast(`Descargando ${doc.filename}`); }
const canPreview = (doc) => PREVIEWABLE.has(doc.ext) || VIDEO_EXT.has(doc.ext) || AUDIO_EXT.has(doc.ext);

// El admin abre el modal de cualquier archivo (aunque no tenga vista previa) para ver sus versiones
function useCanOpen() {
  const { user } = useContext(AppContext);
  return (doc) => user?.role === "admin" || canPreview(doc);
}

// Carga perezosa del árbol: cada carpeta se pide al servidor la primera vez que se abre
// (GET /documents/children) y se guarda por ruta. Cuando la biblioteca cambia (subida, papelera,
// reindexado…) `version` sube y se vuelven a pedir las carpetas ya cargadas, sin cerrar nada.
function useFolderChildren(version) {
  const [cache, setCache] = useState(() => new Map());
  const requested = useRef(new Set());
  const fetchPath = useCallback((path) => {
    requested.current.add(path);
    api.children(path)
      .then((r) => setCache((c) => new Map(c).set(path, r)))
      .catch((e) => setCache((c) => new Map(c).set(path, { error: e.message, folders: [], files: [] })));
  }, []);
  const ensure = useCallback((path) => { if (!requested.current.has(path)) fetchPath(path); }, [fetchPath]);
  const firstVersion = useRef(version);
  useEffect(() => {
    if (version === firstVersion.current) return;
    for (const path of requested.current) fetchPath(path);
  }, [version, fetchPath]);
  return { cache, ensure };
}

function FileRow({ doc, depth, onOpen }) {
  const { label, cls } = badgeFor(doc.ext);
  const { user, reloadDocuments } = useContext(AppContext);
  const canOpen = useCanOpen();
  async function moveToTrash() {
    if (!confirm(`¿Mover «${doc.filename}» a la papelera? Podrás recuperarlo durante un tiempo desde «Vincular biblioteca».`)) return;
    try {
      await api.deleteDocument(doc._id);
      toast(`${doc.filename} movido a la papelera`);
      reloadDocuments();
    } catch (e) { toast(e.message); }
  }
  return (
    <tr className="file">
      <td style={{ paddingLeft: 24 + depth * 24, cursor: canOpen(doc) ? "pointer" : "default" }} onClick={canOpen(doc) ? () => onOpen(doc) : undefined}>
        <span className="tree-name">
          <span className={`ftype sm ${cls}`}>{label}</span>
          <span className="nm" title={doc.filename}>{doc.filename}</span>
        </span>
      </td>
      <td className="muted hide-sm">{label}</td>
      <td className="num">{formatSize(doc.size)}</td>
      <td className="num hide-sm">{formatDate(doc.mtimeMs)}</td>
      <td>
        <div className="row-acts">
          {canPreview(doc) && <button type="button" className="btn-icon sm" title="Vista previa" onClick={() => onOpen(doc)}><EyeIcon size={15} /></button>}
          <a className="btn-icon sm" title="Descargar" href={api.downloadUrl(doc._id)} onClick={() => download(doc)}><DownloadIcon size={15} /></a>
          {user?.role === "admin" && <button type="button" className="btn-icon sm danger" title="Mover a la papelera" onClick={moveToTrash}><TrashIcon size={15} /></button>}
        </div>
      </td>
    </tr>
  );
}

function FolderRow({ name, count, depth, open, onToggle }) {
  return (
    <tr>
      <td colSpan={4} style={{ paddingLeft: depth * 24 }}>
        <button type="button" className="tree-toggle" aria-expanded={open} onClick={onToggle}>
          <ChevronDownIcon size={14} className="chev" />
          <span className="fold-ic"><FolderIcon size={15} filled /></span>
          {name}
          <span className="badge">{count}</span>
        </button>
      </td>
      <td></td>
    </tr>
  );
}

const TableShell = ({ children }) => (
  <div className="card" style={{ overflow: "hidden" }}>
    <table className="table">
      <thead><tr><th>Nombre</th><th className="hide-sm">Tipo</th><th className="num">Tamaño</th><th className="num hide-sm">Modificado</th><th style={{ width: 100 }}></th></tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>
);
const NoteRow = ({ depth, children }) => <tr><td colSpan={5} className="muted" style={{ paddingLeft: 24 + depth * 24 }}>{children}</td></tr>;

// Un nivel del árbol perezoso: sus subcarpetas (y, si están abiertas, su contenido) y sus archivos
function LazyRows({ path, depth, tree, open, toggle, onOpen }) {
  const data = tree.cache.get(path);
  if (!data) return <NoteRow depth={depth}>Cargando…</NoteRow>;
  if (data.error) return <NoteRow depth={depth}>{data.error}</NoteRow>;
  return (
    <>
      {data.folders.map((f) => (
        <Fragment key={f.path}>
          <FolderRow name={f.name} count={f.count} depth={depth} open={open.has(f.path)} onToggle={() => toggle(f.path)} />
          {open.has(f.path) && <LazyRows path={f.path} depth={depth + 1} tree={tree} open={open} toggle={toggle} onOpen={onOpen} />}
        </Fragment>
      ))}
      {data.files.map((doc) => <FileRow key={doc._id} doc={doc} depth={depth} onOpen={onOpen} />)}
      {data.truncated && <NoteRow depth={depth}>{CHILDREN_LIMIT_NOTE}</NoteRow>}
    </>
  );
}

function LazyListView({ tree, onOpen }) {
  const [open, setOpen] = useState(() => new Set());
  const { ensure } = tree;
  useEffect(() => { ensure(""); }, [ensure]);
  function toggle(path) {
    if (!open.has(path)) tree.ensure(path);
    setOpen((s) => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n; });
  }
  return <TableShell><LazyRows path="" depth={0} tree={tree} open={open} toggle={toggle} onOpen={onOpen} /></TableShell>;
}

// Resultados de un filtro: árbol en memoria, todo desplegado
function FilteredRows({ node, path, depth, onOpen }) {
  return (
    <>
      {[...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, child]) => (
        <Fragment key={name}>
          <FolderRow name={name} count={countAll(child)} depth={depth} open onToggle={() => {}} />
          <FilteredRows node={child} path={path ? `${path}/${name}` : name} depth={depth + 1} onOpen={onOpen} />
        </Fragment>
      ))}
      {node.files.map((doc) => <FileRow key={doc._id} doc={doc} depth={depth} onOpen={onOpen} />)}
    </>
  );
}

function FileTile({ doc }) {
  const [open, setOpen] = useState(false);
  const canOpen = useCanOpen();
  const { label, cls } = badgeFor(doc.ext);
  function activate() {
    if (canOpen(doc)) setOpen(true);
    else window.open(api.downloadUrl(doc._id), "_blank");
  }
  return (
    <>
      <button type="button" className="tile" title={doc.filename} onClick={activate}>
        <span className="pv">
          {IMAGE_EXT.has(doc.ext)
            ? <img src={api.viewUrl(doc._id)} alt="" loading="lazy" />
            : <span className="sheet" style={{ "--c": `var(--${cls === "other" ? "text-3" : cls})` }} />}
          <span className={`ftype sm ${cls}`}>{label}</span>
        </span>
        <span className="tx"><b title={doc.filename}>{doc.filename}</b><small>{formatSize(doc.size)}</small></span>
      </button>
      {open && <DocumentModal doc={doc} onClose={() => setOpen(false)} />}
    </>
  );
}
function FolderTile({ name, count, onOpen }) {
  return (
    <button type="button" className="tile" onClick={onOpen} title={name}>
      <span className="pv"><span className="fold-big"><FolderIcon size={34} filled /></span></span>
      <span className="tx"><b>{name}</b><small>{count} elemento(s)</small></span>
    </button>
  );
}

function LazyGridView({ tree }) {
  const [path, setPath] = useState("");
  const { ensure } = tree;
  useEffect(() => { ensure(path); }, [ensure, path]);
  const data = tree.cache.get(path);
  const parts = path ? path.split("/") : [];
  return (
    <div>
      {parts.length > 0 && (
        <div className="crumbs">
          <button type="button" className="link" onClick={() => setPath("")}><HomeIcon size={12} /></button>
          {parts.map((p, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ChevronRightIcon size={12} />
              <button type="button" className="link" onClick={() => setPath(parts.slice(0, i + 1).join("/"))}>{p}</button>
            </span>
          ))}
        </div>
      )}
      {!data ? <p className="help">Cargando…</p>
        : data.error ? <p className="error">{data.error}</p>
        : data.folders.length === 0 && data.files.length === 0 ? (
          <div className="card"><div className="empty"><div className="ic"><SearchIcon size={20} /></div><b>Sin resultados</b>Esta carpeta está vacía.</div></div>
        ) : (
          <>
            <div className="grid">
              {data.folders.map((f) => <FolderTile key={f.path} name={f.name} count={f.count} onOpen={() => setPath(f.path)} />)}
              {data.files.map((doc) => <FileTile key={doc._id} doc={doc} />)}
            </div>
            {data.truncated && <p className="help">{CHILDREN_LIMIT_NOTE}</p>}
          </>
        )}
    </div>
  );
}

export default function Explorer({ summary, docsVersion, user, onOpenLibrary }) {
  const [filter, setFilter] = useState("");
  const [type, setType] = useState("all");
  const [view, setView] = useState("list");
  const [preview, setPreview] = useState(null);
  const [results, setResults] = useState(null); // {items, truncated} del filtro
  const [error, setError] = useState("");
  const tree = useFolderChildren(docsVersion);
  const name = filter.trim();
  const filtering = name !== "" || type !== "all";

  // El filtro se resuelve en el servidor (con una pequeña espera mientras se escribe)
  useEffect(() => {
    setResults(null);
    if (!filtering) return;
    let cancelled = false;
    const t = setTimeout(() => {
      api.filterDocuments(name, type)
        .then((r) => { if (!cancelled) { setResults(r); setError(""); } })
        .catch((e) => { if (!cancelled) setError(e.message); });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [name, type, filtering, docsVersion]);

  const filteredTree = useMemo(() => buildTree(results?.items ?? []), [results]);
  const total = summary?.total ?? 0;
  const topCount = summary?.topFolders.length ?? 0;

  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><HomeIcon size={12} />Biblioteca<ChevronRightIcon size={12} />Documentos</div>
      <div className="page-head">
        <div>
          <h1>Documentos</h1>
          <p>{total} documentos en {topCount} carpeta{topCount === 1 ? "" : "s"}</p>
        </div>
        {user?.role === "admin" && onOpenLibrary && (
          <div className="actions">
            <button type="button" className="btn btn-secondary" onClick={onOpenLibrary}><RefreshIcon size={14} />Reindexar</button>
            <button type="button" className="btn btn-primary" onClick={onOpenLibrary}><UploadIcon size={14} />Subir archivos</button>
          </div>
        )}
      </div>
      <div className="toolbar">
        <div className="input-icon"><SearchIcon /><input className="input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtrar por nombre o carpeta…" aria-label="Filtrar documentos" /></div>
        <div className="seg" aria-label="Tipo de archivo">
          {TYPES.map((t) => <button type="button" key={t.id} className={type === t.id ? "on" : ""} onClick={() => setType(t.id)}>{t.label}</button>)}
        </div>
        <span className="grow" />
        <div className="seg" aria-label="Vista">
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")}><ListIcon size={14} />Lista</button>
          <button type="button" className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}><GridIcon size={14} />Tarjetas</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      {summary && total === 0 ? (
        <div className="card"><div className="empty"><div className="ic"><FolderIcon size={20} /></div><b>Sin documentos</b>Todavía no hay nada indexado en tu biblioteca.</div></div>
      ) : filtering ? (
        !results ? <p className="help">Buscando…</p>
          : results.items.length === 0 ? (
            <div className="card"><div className="empty"><div className="ic"><SearchIcon size={20} /></div><b>Sin resultados</b>Prueba con otro nombre o quita los filtros.</div></div>
          ) : (
            <>
              {view === "list"
                ? <TableShell><FilteredRows node={filteredTree} path="" depth={0} onOpen={setPreview} /></TableShell>
                : <div className="grid">{results.items.map((doc) => <FileTile key={doc._id} doc={doc} />)}</div>}
              {results.truncated && <p className="help">Se muestran los 200 primeros resultados; afina el filtro para ver el resto.</p>}
            </>
          )
      ) : view === "list" ? <LazyListView tree={tree} onOpen={setPreview} /> : <LazyGridView tree={tree} />}

      {user?.role !== "admin" && (
        <div className="callout"><InfoIcon size={16} /><span>Solo ves las carpetas que tu grupo tiene permitidas. Si necesitas acceso a otra, pídeselo a un administrador.</span></div>
      )}
      {preview && <DocumentModal doc={preview} onClose={() => setPreview(null)} />}
    </div></div>
  );
}
