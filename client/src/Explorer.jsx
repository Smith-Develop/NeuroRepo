import { useMemo, useState } from "react";
import DocumentCard from "./DocumentCard";

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

function FolderNode({ name, node, openAll }) {
  return (
    <details className="doc-folder" open={openAll || undefined}>
      <summary>📁 {name} <small>({node.files.length + [...node.folders.values()].reduce((s, n) => s + n.files.length, 0)})</small></summary>
      <div className="doc-folder-body">
        {[...node.folders.entries()].map(([childName, child]) => (
          <FolderNode key={childName} name={childName} node={child} openAll={openAll} />
        ))}
        {node.files.map((doc) => <DocumentCard key={doc._id} doc={doc} />)}
      </div>
    </details>
  );
}

export default function Explorer({ documents }) {
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(f) || d.folder.toLowerCase().includes(f));
  }, [documents, filter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const rootFiles = tree.files;
  const openAll = filter.trim().length > 0;

  return (
    <div className="panel explorer">
      <h1>Documentos</h1>
      <input className="explorer-filter" value={filter} onChange={(e) => setFilter(e.target.value)}
        placeholder="Filtrar por nombre o carpeta…" aria-label="Filtrar documentos" />
      {documents.length === 0 && <p className="hint">Todavía no hay documentos indexados.</p>}
      {documents.length > 0 && filtered.length === 0 && <p className="hint">Nada coincide con «{filter}».</p>}
      <div className="doc-tree">
        {[...tree.folders.entries()].map(([name, node]) => <FolderNode key={name} name={name} node={node} openAll={openAll} />)}
        {rootFiles.map((doc) => <DocumentCard key={doc._id} doc={doc} />)}
      </div>
    </div>
  );
}
