import Flowchart from "./Flowchart";

// Muestra una nota tal y como está guardada en la red
export default function NoteCard({ note, color, onShow, jumpLabel }) {
  return (
    <article className="note-card" style={{ "--c": color }}>
      <header>
        <span className="branch-chip">{note.scenario?.name}{note.category && ` · ${note.category}`}</span>
        <h3>{note.title}</h3>
      </header>
      {note.summary && <p>{note.summary}</p>}
      {note.keyPoints?.length > 0 && <ul>{note.keyPoints.map((k, i) => <li key={i}>{k}</li>)}</ul>}
      {note.tags?.length > 0 && <p className="tags">{note.tags.map((t) => `#${t}`).join("  ")}</p>}
      {note.steps?.length > 0 && <Flowchart steps={note.steps} />}
      {note.relatedNotes?.length > 0 && (
        <p className="tags rel-tags">
          Depende de:{" "}
          {note.relatedNotes.map((r, i) => (
            <span key={r.note?._id ?? i}>
              {i > 0 && ", "}
              {onShow && r.note?._id ? (
                <button type="button" className="link" onClick={() => onShow(r.note)}>{r.note.title}</button>
              ) : (
                r.note?.title
              )}
            </span>
          ))}
        </p>
      )}
      <details>
        <summary>Lo que escribiste</summary>
        <p className="raw">{note.raw}</p>
      </details>
      {jumpLabel && onShow && <button className="link" onClick={() => onShow(note)}>{jumpLabel}</button>}
    </article>
  );
}
