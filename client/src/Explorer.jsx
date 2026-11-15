import { useMemo, useState } from "react";
import { api } from "./api";
import { badgeFor, formatSize, PREVIEWABLE, IMAGE_EXT, VIDEO_EXT, AUDIO_EXT, DownloadIcon } from "./DocumentCard";
import DocumentModal from "./DocumentModal";
import { toast } from "./toast";
import { FolderIcon, GridIcon, ListIcon } from "./icons";

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

function FileRow({ doc, onOpen }) {
  const canOpen = PREVIEWABLE.has(doc.ext) || VIDEO_EXT.has(doc.ext) || AUDIO_EXT.has(doc.ext);
  return (
    <div className="file-row" onClick={canOpen ? () => onOpen(doc) : undefined} style={{ cursor: canOpen ? "pointer" : "default" }}>
      {IMAGE_EXT.has(doc.ext)
        ? <img className="doc-tile-thumb" style={{ width: 36, height: 36 }} src={api.viewUrl(doc._id)} alt="" loading="lazy" />
        : <span className="file-badge" style={{ background: badgeFor(doc.ext).color }}>{badgeFor(doc.ext).label}</span>}
      <span className="file-row-name" title={doc.filename}>{doc.filename}</span>
      <span className="file-row-meta">{formatSize(doc.size)}</span>
      <a className="icon-btn" href={api.downloadUrl(doc._id)} title="Descargar" aria-label="Descargar"
        onClick={(e) => { e.stopPropagation(); download(doc); }}><DownloadIcon /></a>
    </div>
  );
}

function FolderNode({ name, node, forceOpen, onOpen }) {
  return (
    <details className="doc-folder" open={forceOpen || undefined}>
      <summary><FolderIcon size={15} /> {name} <small>({countAll(node)})</small></summary>
      <div className="doc-folder-body">
        {[...node.folders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([childName, child]) => (
          <FolderNode key={childName} name={childName} node={child} forceOpen={forceOpen} onOpen={onOpen} />
        ))}
        {node.files.map((doc) => <FileRow key={doc._id} doc={doc} onOpen={onOpen} />)}
      </div>
    </details>
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
      <button type="button" className="doc-tile" title={doc.filename} onClick={activate}>
        {IMAGE_EXT.has(doc.ext)
          ? <img className="doc-tile-thumb" src={api.viewUrl(doc._id)} alt="" loading="lazy" />
          : <span className="doc-tile-icon"><span className="file-badge" style={{ background: badgeFor(doc.ext).color }}>{badgeFor(doc.ext).label}</span></span>}
        <span className="doc-tile-name">{doc.filename}</span>
        <span className="doc-tile-meta">{formatSize(doc.size)}</span>
      </button>
      {open && <DocumentModal doc={doc} onClose={() => setOpen(false)} />}
    </>
  );
}

function FolderTile({ name, node, onOpen }) {
  return (
    <button type="button" className="doc-tile" onClick={onOpen} title={name}>
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
      {path.length > 0 && (
        <div className="breadcrumbs">
          <button type="button" className="link" onClick={() => setPath([])}>raíz</button>
          {path.map((p, i) => (
            <span key={i}> / <button type="button" className="link" onClick={() => setPath(path.slice(0, i + 1))}>{p}</button></span>
          ))}
        </div>
      )}
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
  const [view, setView] = useState("list");
  const [preview, setPreview] = useState(null);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(f) || d.folder.toLowerCase().includes(f));
  }, [documents, filter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const forceOpen = filter.trim().length > 0;

  return (
    <div className="panel">
      <div className="explorer-head">
        <h1>Documentos</h1>
        <div className="view-toggle">
          <button type="button" className={view === "list" ? "on" : ""} onClick={() => setView("list")}><ListIcon size={14} /> Lista</button>
          <button type="button" className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}><GridIcon size={14} /> Tarjetas</button>
        </div>
      </div>
      <input className="explorer-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrar por nombre o carpeta…" aria-label="Filtrar documentos" />

      {view === "list" ? (
        <>
          {documents.length === 0 && <p className="hint">Todavía no hay documentos indexados.</p>}
          {documents.length > 0 && filtered.length === 0 && <p className="hint">Nada coincide con «{filter}».</p>}
          {[...tree.folders.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, node]) => (
            <FolderNode key={name} name={name} node={node} forceOpen={forceOpen} onOpen={setPreview} />
          ))}
          {tree.files.map((doc) => <FileRow key={doc._id} doc={doc} onOpen={setPreview} />)}
        </>
      ) : (
        <GridView tree={tree} documents={documents} />
      )}
      {preview && <DocumentModal doc={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
