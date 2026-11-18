import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon, CheckIcon, XIcon } from "./icons";

// Desplegables con el diseño de la app (en vez de la lista nativa del navegador de <select> y
// <datalist>): Select (elegir de una lista), Combobox (texto libre con sugerencias) y LegoInput
// (palabras sueltas como bloques encajados, con sugerencias). La lista se pinta en <body> con
// position: fixed, así no la recorta el scroll de los diálogos.

const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Posición de la lista junto al control; se abre hacia arriba si abajo no cabe
function usePopover(anchorRef, open) {
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const up = below < 220 && r.top > below;
      setPos({
        left: Math.max(8, r.left),
        width: Math.max(r.width, 180),
        maxHeight: Math.max(120, Math.min(300, (up ? r.top : below) - 16)),
        ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef]);
  return pos;
}

function OptionList({ id, pos, items, active, selected, onPick, empty }) {
  const listRef = useRef(null);
  useLayoutEffect(() => {
    listRef.current?.querySelector(".on")?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!pos) return null;
  return createPortal(
    // mousedown sin efecto: así el campo no pierde el foco al elegir
    <ul ref={listRef} id={id} role="listbox" className="pick-list" style={pos} onMouseDown={(e) => e.preventDefault()}>
      {items.length === 0 && <li className="pick-empty">{empty}</li>}
      {items.map((it, i) => (
        <li key={it.value} id={`${id}-${i}`} role="option" aria-selected={selected === it.value} className={i === active ? "on" : ""} onClick={() => onPick(it)}>
          <span className="pick-label">{it.label}</span>
          {it.hint && <span className="pick-hint">{it.hint}</span>}
          {selected === it.value && <CheckIcon size={14} />}
        </li>
      ))}
    </ul>,
    document.body,
  );
}

// Flechas, Intro y Escape comunes a los tres controles
function useListKeys({ open, setOpen, items, active, setActive, onPick }) {
  return (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const n = items.length;
      if (n) setActive((a) => (e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n));
    } else if (e.key === "Enter" && open && active >= 0 && items[active]) {
      e.preventDefault();
      onPick(items[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };
}

// Elegir uno de una lista fija: options = [{value, label}]
export function Select({ value, onChange, options, ariaLabel, style, id }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const btnRef = useRef(null);
  const listId = useId();
  const pos = usePopover(btnRef, open);
  const current = options.find((o) => o.value === value);
  const pick = (o) => { onChange(o.value); setOpen(false); btnRef.current?.focus(); };
  const onKey = useListKeys({ open, setOpen: (v) => { setOpen(v); setActive(Math.max(0, options.indexOf(current))); }, items: options, active, setActive, onPick: pick });
  return (
    <>
      <button ref={btnRef} id={id} type="button" className="select pick-btn" style={style} role="combobox" aria-label={ariaLabel} aria-haspopup="listbox"
        aria-expanded={open} aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onClick={() => { setOpen((o) => !o); setActive(Math.max(0, options.indexOf(current))); }} onKeyDown={onKey} onBlur={() => setOpen(false)}>
        <span className="pick-value">{current?.label ?? ""}</span>
        <ChevronDownIcon size={14} />
      </button>
      {open && <OptionList id={listId} pos={pos} items={options} active={active} selected={value} onPick={pick} empty="Sin opciones" />}
    </>
  );
}

// Texto libre con sugerencias (p. ej. la aplicación de una ficha: una existente o una nueva)
export function Combobox({ id, value, onChange, options, placeholder, maxLength, required }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef(null);
  const listId = useId();
  const pos = usePopover(inputRef, open);
  const items = useMemo(() => {
    const q = norm(value);
    const exact = options.some((o) => norm(o) === q);
    return options.filter((o) => !q || exact || norm(o).includes(q)).map((o) => ({ value: o, label: o }));
  }, [options, value]);
  const pick = (it) => { onChange(it.value); setOpen(false); };
  const onKey = useListKeys({ open, setOpen, items, active, setActive, onPick: pick });
  return (
    <div className="pick-combo">
      <input ref={inputRef} id={id} className="input" value={value} maxLength={maxLength} required={required} placeholder={placeholder} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKey} />
      <button type="button" className="pick-toggle" tabIndex={-1} aria-label="Ver opciones" onMouseDown={(e) => { e.preventDefault(); inputRef.current?.focus(); setOpen((o) => !o); }}>
        <ChevronDownIcon size={14} />
      </button>
      {open && <OptionList id={listId} pos={pos} items={items} active={active} selected={value} onPick={pick} empty="Escribe para crear una nueva" />}
    </div>
  );
}

// Palabras como bloques de lego encajados: Intro, coma o Tab añaden la palabra; Retroceso con el
// campo vacío quita la última. suggestions = [{value, count}] (las más usadas primero).
export function LegoInput({ id, value, onChange, suggestions = [], placeholder, ariaLabel, max = 20, maxLen = 40 }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  const pos = usePopover(boxRef, open);
  const chosen = useMemo(() => new Set(value.map(norm)), [value]);
  const items = useMemo(() => {
    const q = norm(text);
    return suggestions
      .filter((s) => !chosen.has(norm(s.value)) && (!q || norm(s.value).includes(q)))
      .slice(0, q ? 12 : 6) // sin escribir, solo las más usadas: la lista no tapa el resto del formulario
      .map((s) => ({ value: s.value, label: s.value, hint: s.count > 1 ? `${s.count}` : "" }));
  }, [suggestions, chosen, text]);
  const add = (words) => {
    const next = [...value];
    for (const w of words) {
      const t = w.trim().replace(/\s+/g, " ").slice(0, maxLen);
      if (t && !next.some((x) => norm(x) === norm(t)) && next.length < max) next.push(t);
    }
    if (next.length !== value.length) onChange(next);
    setText("");
    setActive(-1);
  };
  const remove = (i) => onChange(value.filter((_, j) => j !== i));
  const listKeys = useListKeys({ open, setOpen, items, active, setActive, onPick: (it) => add([it.value]) });
  function onKey(e) {
    if ((e.key === "Enter" || e.key === "," || (e.key === "Tab" && text.trim())) && !(open && active >= 0)) {
      if (text.trim()) { e.preventDefault(); add([text]); return; }
      if (e.key === "Enter") { e.preventDefault(); return; } // Intro con el campo vacío no envía el formulario
    }
    if (e.key === "Backspace" && !text && value.length) { remove(value.length - 1); return; }
    listKeys(e);
  }
  return (
    <div ref={boxRef} className="lego-field" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}>
      <div className="legos" role="list" aria-label={ariaLabel}>
        {value.map((w, i) => (
          <span key={w} role="listitem" className={`lego c${i % 4}`}>
            {w}
            <button type="button" className="lego-x" onClick={() => remove(i)} aria-label={`Quitar ${w}`}><XIcon size={11} /></button>
          </span>
        ))}
        <input ref={inputRef} id={id} className="lego-input" value={text} placeholder={value.length ? "Añadir…" : placeholder} aria-label={ariaLabel} autoComplete="off"
          role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(",")) { const parts = v.split(","); add(parts.slice(0, -1)); setText(parts.at(-1)); } else setText(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)} onBlur={() => { if (text.trim()) add([text]); setOpen(false); }} onKeyDown={onKey} />
      </div>
      {open && (items.length > 0 || text.trim()) && (
        <OptionList id={listId} pos={pos} items={items} active={active} selected={null} onPick={(it) => add([it.value])}
          empty={`Intro para añadir «${text.trim()}»`} />
      )}
    </div>
  );
}
