import { useEffect, useRef, useState } from "react";
import { onToast } from "./toast";
import { CheckIcon } from "./icons";

export default function Toaster() {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  useEffect(() => onToast((message) => {
    const id = ++seq.current;
    setItems((all) => [...all, { id, message }]);
    setTimeout(() => setItems((all) => all.filter((t) => t.id !== id)), 2600);
  }), []);

  if (!items.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div className="toast-item" key={t.id}>
          <span className="toast-ic"><CheckIcon size={12} /></span>{t.message}
        </div>
      ))}
    </div>
  );
}
