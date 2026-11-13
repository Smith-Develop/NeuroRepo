import { useMemo, useState } from "react";
import { api } from "./api";
import DocumentCard, { iconFor, formatSize, INLINE } from "./DocumentCard";

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

function FolderNode({ name, node, openAll }) {
  return (
    <details className="doc-folder" open={openAll || undefined}>
      <summary>📁 {name} <small>({countAll(node)})</small></summary>
      <div className="doc-folder-body">
        {[...node.folders.entries()].map(([childName, child]) => (
          <FolderNode key={childName} name={childName} node={child} openAll={openAll} />
        ))}
        {node.files.map((doc) => <DocumentCard key={doc._id} doc={doc} />)}
      </div>
    </details>
  );
}

function FileTile({ doc }) {
  const canPreview = INLINE.has(doc.ext);
  function open() {
    window.open(canPreview ? api.viewUrl(doc._id) : api.downloadUrl(doc._id), "_blank");
  }
  return (
    <div className="doc-tile" role="button" tabIndex={0} title={doc.filename}
      onClick={open} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open()}>
      <a className="doc-tile-dl" href={api.downloadUrl(doc._id)} title="Descargar" onClick={(e) => e.stopPropagation()}>⬇</a>
      <span className="doc-tile-icon" aria-hidden="true">{iconFor(doc.ext)}</span>
      <span className="doc-tile-name">{doc.filename}</span>
      <span className="doc-tile-meta">{formatSize(doc.size)}</span>
    </div>
  );
}

function FolderTile({ name, node, onOpen }) {
  return (
    <button type="button" className="doc-tile doc-tile-folder" onClick={onOpen} title={name}>
      <span className="doc-tile-icon" aria-hidden="true">📁</span>
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
  const [view, setView] = useState("list");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(f) || d.folder.toLowerCase().includes(f));
  }, [documents, filter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const openAll = filter.trim().length > 0;

  return (
    <div className="panel explorer">
      <div className="explorer-head">
        <h1>Documentos</h1>
        <div className="view-toggle" role="radiogroup" aria-label="Tipo de vista">
          <button type="button" role="radio" aria-checked={view === "list"} className={view === "list" ? "on" : ""} onClick={() => setView("list")}>☰ Lista</button>
          <button type="button" role="radio" aria-checked={view === "grid"} className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>▦ Tarjetas</button>
        </div>
      </div>
      <input className="explorer-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrar por nombre o carpeta…" aria-label="Filtrar documentos" />

      {view === "list" ? (
        <>
          {documents.length === 0 && <p className="hint">Todavía no hay documentos indexados.</p>}
          {documents.length > 0 && filtered.length === 0 && <p className="hint">Nada coincide con «{filter}».</p>}
          <div className="doc-tree">
            {[...tree.folders.entries()].map(([name, node]) => <FolderNode key={name} name={name} node={node} openAll={openAll} />)}
            {tree.files.map((doc) => <DocumentCard key={doc._id} doc={doc} />)}
          </div>
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
    </div>
  );
}
