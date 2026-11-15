import { useContext, useMemo, useState } from "react";
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
  { id: "pdf", label: "PDF", test: (ext) => ext === ".pdf" },
  { id: "doc", label: "Word", test: (ext) => ext === ".doc" || ext === ".docx" },
  { id: "xls", label: "Excel", test: (ext) => [".xls", ".xlsx", ".csv"].includes(ext) },
  { id: "other", label: "Otros", test: (ext) => !(ext === ".pdf" || ext === ".doc" || ext === ".docx" || [".xls", ".xlsx", ".csv"].includes(ext)) },
];

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

function FolderRows({ name, node, depth, openFolders, toggle, onOpen }) {
  const path = name;
  const open = openFolders.has(path);
  const childFolders = [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <>
      <tr>
        <td colSpan={4} style={{ paddingLeft: depth * 24 }}>
          <button type="button" className="tree-toggle" aria-expanded={open} onClick={() => toggle(path)}>
            <ChevronDownIcon size={14} className="chev" />
            <span className="fold-ic"><FolderIcon size={15} filled /></span>
            {name.split("/").pop()}
            <span className="badge">{countAll(node)}</span>
          </button>
        </td>
        <td></td>
      </tr>
      {open && childFolders.map(([childName, child]) => (
        <FolderRows key={childName} name={`${path}/${childName}`} node={child} depth={depth + 1} openFolders={openFolders} toggle={toggle} onOpen={onOpen} />
      ))}
      {open && node.files.map((doc) => <FileRow key={doc._id} doc={doc} depth={depth + 1} onOpen={onOpen} />)}
    </>
  );
}

function ListView({ tree, forceOpen, onOpen }) {
  const [openFolders, setOpenFolders] = useState(new Set());
  const effectiveOpen = forceOpen ? new Set([...openFolders, ...allPaths(tree)]) : openFolders;
  function toggle(path) {
    setOpenFolders((s) => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n; });
  }
  const topFolders = [...tree.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="table">
        <thead><tr><th>Nombre</th><th className="hide-sm">Tipo</th><th className="num">Tamaño</th><th className="num hide-sm">Modificado</th><th style={{ width: 100 }}></th></tr></thead>
        <tbody>
          {topFolders.map(([name, node]) => (
            <FolderRows key={name} name={name} node={node} depth={0} openFolders={effectiveOpen} toggle={toggle} onOpen={onOpen} />
          ))}
          {tree.files.map((doc) => <FileRow key={doc._id} doc={doc} depth={0} onOpen={onOpen} />)}
        </tbody>
      </table>
    </div>
  );
}
function allPaths(node, prefix = "") {
  let out = [];
  for (const [name, child] of node.folders) {
    const path = prefix ? `${prefix}/${name}` : name;
    out.push(path, ...allPaths(child, path));
  }
  return out;
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
function FolderTile({ name, node, onOpen }) {
  return (
    <button type="button" className="tile" onClick={onOpen} title={name}>
      <span className="pv"><span className="fold-big"><FolderIcon size={34} filled /></span></span>
      <span className="tx"><b>{name}</b><small>{countAll(node)} elemento(s)</small></span>
    </button>
  );
}
function GridView({ tree }) {
  const [path, setPath] = useState([]);
  const node = useMemo(() => {
    let n = tree;
    for (const part of path) { n = n.folders.get(part); if (!n) return tree; }
    return n;
  }, [tree, path]);
  const folders = [...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const files = node.files;
  return (
    <div>
      {path.length > 0 && (
        <div className="crumbs">
          <button type="button" className="link" onClick={() => setPath([])}><HomeIcon size={12} /></button>
          {path.map((p, i) => (
            <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ChevronRightIcon size={12} />
              <button type="button" className="link" onClick={() => setPath(path.slice(0, i + 1))}>{p}</button>
            </span>
          ))}
        </div>
      )}
      {folders.length === 0 && files.length === 0 && (
        <div className="card"><div className="empty"><div className="ic"><SearchIcon size={20} /></div><b>Sin resultados</b>Esta carpeta está vacía.</div></div>
      )}
      <div className="grid">
        {folders.map(([name, child]) => <FolderTile key={name} name={name} node={child} onOpen={() => setPath([...path, name])} />)}
        {files.map((doc) => <FileTile key={doc._id} doc={doc} />)}
      </div>
    </div>
  );
}

export default function Explorer({ documents, user, onOpenLibrary }) {
  const [filter, setFilter] = useState("");
  const [type, setType] = useState("all");
  const [view, setView] = useState("list");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const typeTest = TYPES.find((t) => t.id === type)?.test;
    return documents.filter((d) =>
      (!f || d.filename.toLowerCase().includes(f) || (d.folder || "").toLowerCase().includes(f)) &&
      (!typeTest || typeTest(d.ext)));
  }, [documents, filter, type]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const forceOpen = filter.trim().length > 0 || type !== "all";
  const topFolders = useMemo(() => new Set(documents.map((d) => (d.folder || "").split("/")[0]).filter(Boolean)), [documents]);
  const [preview, setPreview] = useState(null);

  return (
    <div className="page"><div className="page-inner">
      <div className="crumbs"><HomeIcon size={12} />Biblioteca<ChevronRightIcon size={12} />Documentos</div>
      <div className="page-head">
        <div>
          <h1>Documentos</h1>
          <p>{documents.length} documentos en {topFolders.size} carpeta{topFolders.size === 1 ? "" : "s"}</p>
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

      {documents.length === 0 && (
        <div className="card"><div className="empty"><div className="ic"><FolderIcon size={20} /></div><b>Sin documentos</b>Todavía no hay nada indexado en tu biblioteca.</div></div>
      )}
      {documents.length > 0 && filtered.length === 0 && (
        <div className="card"><div className="empty"><div className="ic"><SearchIcon size={20} /></div><b>Sin resultados</b>Prueba con otro nombre o quita los filtros.</div></div>
      )}
      {filtered.length > 0 && (view === "list"
        ? <ListView tree={tree} forceOpen={forceOpen} onOpen={setPreview} />
        : <GridView tree={tree} />)}

      {user?.role !== "admin" && (
        <div className="callout"><InfoIcon size={16} /><span>Solo ves las carpetas que tu grupo tiene permitidas. Si necesitas acceso a otra, pídeselo a un administrador.</span></div>
      )}
      {preview && <DocumentModal doc={preview} onClose={() => setPreview(null)} />}
    </div></div>
  );
}
