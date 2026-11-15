import { useEffect, useRef, useState } from "react";
import { onToast } from "./toast";
import { CheckIcon } from "./icons";

let seq = 0;

export default function Toaster() {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  useEffect(() => onToast((message) => {
    const id = ++seq;
    setItems((all) => [...all, { id, message, out: false }]);
    const t = setTimeout(() => {
      setItems((all) => all.map((it) => (it.id === id ? { ...it, out: true } : it)));
      setTimeout(() => setItems((all) => all.filter((it) => it.id !== id)), 200);
    }, 2600);
    timers.current.set(id, t);
  }), []);

  return (
    <div className="toasts" aria-live="polite">
      {items.map((it) => (
        <div key={it.id} className={`toast${it.out ? " out" : ""}`}>
          <span className="ti"><CheckIcon size={13} /></span>
          <span>{it.message}</span>
        </div>
      ))}
    </div>
  );
}
