import { useEffect, useRef, useState } from "react";
import { onToast } from "./toast";

export default function Toaster() {
  const [message, setMessage] = useState(null);
  const timer = useRef(null);

  useEffect(() => onToast((message) => {
    setMessage(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 2200);
  }), []);

  if (!message) return null;
  return (
    <div className="toast notice" role="status" onClick={() => setMessage(null)}>{message}</div>
  );
}
