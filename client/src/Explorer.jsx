import { useMemo, useState } from "react";
import { api } from "./api";
import { badgeFor, formatSize, PREVIEWABLE, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, DownloadIcon } from "./DocumentCard";
import DocumentModal from "./DocumentModal";
import Crumbs from "./Crumbs";
import { toast } from "./toast";
import { ChevronDownIcon, EyeIcon, FolderIcon, GridIcon, ListIcon } from "./icons";

const TYPE_GROUP = { ".pdf": "pdf", ".doc": "doc", ".docx": "doc", ".xls": "xls", ".xlsx": "xls", ".csv": "xls" };
const TYPES = [["all", "Todos"], ["pdf", "PDF"], ["doc", "Word"], ["xls", "Excel"]];
const fileDate = (ms) => ms ? new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "";

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

// Vista de lista: una sola <table> (cabecera fija, filas de carpeta plegables y filas de
// archivo), al estilo de un árbol de archivos real en vez de <details> anidados.
function ListTable({ tree, openAll, openFolders, toggleFolder, onOpen }) {
  function rows(node, path, depth) {
    const out = [];
    const folderNames = [...node.folders.keys()].sort((a, b) => a.localeCompare(b));
    for (const name of folderNames) {
      const child = node.folders.get(name);
      const fullPath = path ? `${path}/${name}` : name;
      const open = openAll || openFolders.has(fullPath);
      out.push(
        <tr key={`f:${fullPath}`}>
          <td colSpan={4} style={{ paddingLeft: 14 + depth * 22 }}>
            <button type="button" className="tree-toggle" onClick={() => toggleFolder(fullPath)} aria-expanded={open}>
              <ChevronDownIcon size={13} className="chev" style={{ transform: open ? undefined : "rotate(-90deg)" }} />
              <FolderIcon size={14} filled /> {name}
              <span className="folder-badge" style={{ marginLeft: 8 }}>{countAll(child)}</span>
            </button>
          </td>
        </tr>,
      );
      if (open) out.push(...rows(child, fullPath, depth + 1));
    }
    for (const doc of node.files) {
      const canOpen = PREVIEWABLE.has(doc.ext) || VIDEO_EXT.has(doc.ext) || AUDIO_EXT.has(doc.ext);
      out.push(
        <tr key={doc._id} className="file">
          <td style={{ paddingLeft: 14 + (depth + 1) * 22, cursor: canOpen ? "pointer" : "default" }}
            onClick={canOpen ? () => onOpen(doc) : undefined} title={doc.filename}>
            <span className="tree-name">
              {IMAGE_EXT.has(doc.ext)
                ? <img className="doc-tile-thumb" style={{ width: 22, height: 22 }} src={api.viewUrl(doc._id)} alt="" loading="lazy" />
                : <span className="file-badge" style={{ width: 22, height: 22, fontSize: ".52rem" }}>{badgeFor(doc.ext).label}</span>}
              <span className="nm">{doc.filename}</span>
            </span>
          </td>
          <td className="muted">{formatSize(doc.size)}</td>
          <td className="muted">{fileDate(doc.mtimeMs)}</td>
          <td>
            <div className="row-end" style={{ gap: 4 }}>
              {canOpen && <button type="button" className="icon-btn" title="Vista previa" onClick={() => onOpen(doc)}><EyeIcon size={13} /></button>}
              <a className="icon-btn" href={api.downloadUrl(doc._id)} title="Descargar" aria-label="Descargar"
                onClick={(e) => { e.stopPropagation(); toast(`Descargando ${doc.filename}`); }}><DownloadIcon /></a>
            </div>
          </td>
        </tr>,
      );
    }
    return out;
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <table className="table" style={{ tableLayout: "fixed" }}>
        <colgroup><col /><col style={{ width: 90 }} /><col style={{ width: 120 }} /><col style={{ width: 78 }} /></colgroup>
        <thead><tr><th>Nombre</th><th>Tamaño</th><th>Modificado</th><th></th></tr></thead>
        <tbody>{rows(tree, "", 0)}</tbody>
      </table>
    </div>
  );
}

function FileTile({ doc }) {
  const [open, setOpen] = useState(false);
  const canOpen = PREVIEWABLE.has(doc.ext) || VIDEO_EXT.has(doc.ext) || AUDIO_EXT.has(doc.ext);
  function activate() {
    if (canOpen) setOpen(true);
    else window.open(api.downloadUrl(doc._id), "_blank");
  }
  return (
    <>
      <div className="doc-tile" role="button" tabIndex={0} title={doc.filename}
        onClick={activate} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && activate()}>
        <a className="doc-tile-dl overlay-btn" href={api.downloadUrl(doc._id)} title="Descargar" aria-label="Descargar"
          onClick={(e) => { e.stopPropagation(); toast(`Descargando ${doc.filename}`); }}><DownloadIcon /></a>
        {IMAGE_EXT.has(doc.ext)
          ? <img className="doc-tile-thumb" src={api.viewUrl(doc._id)} alt="" loading="lazy" />
          : <span className="file-badge" style={{ background: badgeFor(doc.ext).color }}>{badgeFor(doc.ext).label}</span>}
        <span className="doc-tile-name">{doc.filename}</span>
        <span className="doc-tile-meta">{formatSize(doc.size)}</span>
      </div>
      {open && <DocumentModal doc={doc} onClose={() => setOpen(false)} />}
    </>
  );
}

function FolderTile({ name, node, onOpen }) {
  return (
    <button type="button" className="doc-tile doc-tile-folder" onClick={onOpen} title={name}>
      <span className="doc-tile-icon"><FolderIcon size={30} /></span>
      <span className="doc-tile-name">{name}</span>
      <span className="doc-tile-meta">{countAll(node)} elemento(s)</span>
    </button>
  );
}

function GridView({ tree, documents }) {
  const [path, setPath] = useState([]);

  const node = useMemo(() => {
    let n = tree;
    for (const part of path) {
      n = n.folders.get(part);
      if (!n) return tree;
    }
    return n;
  }, [tree, path]);

  const folders = [...node.folders.entries()];
  const files = node.files;

  return (
    <div>
      <div className="breadcrumbs">
        <button type="button" className="link" onClick={() => setPath([])}>raíz</button>
        {path.map((p, i) => (
          <span key={i}> / <button type="button" className="link" onClick={() => setPath(path.slice(0, i + 1))}>{p}</button></span>
        ))}
      </div>
      {documents.length === 0 && <p className="hint">Todavía no hay documentos indexados.</p>}
      {documents.length > 0 && folders.length === 0 && files.length === 0 && <p className="hint">Esta carpeta está vacía.</p>}
      <div className="doc-grid">
        {folders.map(([name, child]) => (
          <FolderTile key={name} name={name} node={child} onOpen={() => setPath([...path, name])} />
        ))}
        {files.map((doc) => <FileTile key={doc._id} doc={doc} />)}
      </div>
    </div>
  );
}

export default function Explorer({ documents }) {
  const [filter, setFilter] = useState("");
  const [type, setType] = useState("all");
  const [view, setView] = useState("list");
  const [openFolders, setOpenFolders] = useState(new Set());
  const [preview, setPreview] = useState(null);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return documents.filter((d) =>
      (!f || d.filename.toLowerCase().includes(f) || d.folder.toLowerCase().includes(f)) &&
      (type === "all" || TYPE_GROUP[d.ext] === type));
  }, [documents, filter, type]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const openAll = filter.trim().length > 0 || type !== "all";

  function toggleFolder(path) {
    setOpenFolders((s) => { const n = new Set(s); n.has(path) ? n.delete(path) : n.add(path); return n; });
  }

  return (
    <div className="panel explorer">
      <Crumbs items={["Biblioteca", "Documentos"]} />
      <div className="explorer-head">
        <h1>Documentos</h1>
      </div>
      <div className="toolbar">
        <input className="explorer-filter" style={{ width: "min(320px, 100%)", margin: 0 }} value={filter} onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrar por nombre o carpeta…" aria-label="Filtrar documentos" />
        <div className="seg" aria-label="Tipo de archivo">
          {TYPES.map(([key, label]) => (
            <button type="button" key={key} className={type === key ? "on" : ""} onClick={() => setType(key)}>{label}</button>
          ))}
        </div>
        <span className="grow" />
        <div className="view-toggle" role="radiogroup" aria-label="Tipo de vista">
          <button type="button" role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}><ListIcon size={14} /> Lista</button>
          <button type="button" role="radio" aria-checked={view === "grid"} className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}><GridIcon size={14} /> Tarjetas</button>
        </div>
      </div>

      {view === "list" ? (
        <>
          {documents.length === 0 && <p className="hint">Todavía no hay documentos indexados.</p>}
          {documents.length > 0 && filtered.length === 0 && <p className="hint">Nada coincide con «{filter}».</p>}
          {filtered.length > 0 && (
            <ListTable tree={tree} openAll={openAll} openFolders={openFolders} toggleFolder={toggleFolder} onOpen={setPreview} />
          )}
        </>
      ) : openAll ? (
        <>
          {filtered.length === 0 && <p className="hint">Nada coincide con «{filter}».</p>}
          <div className="doc-grid">
            {filtered.map((doc) => <FileTile key={doc._id} doc={doc} />)}
          </div>
        </>
      ) : (
        <GridView tree={tree} documents={documents} />
      )}
      {preview && <DocumentModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
