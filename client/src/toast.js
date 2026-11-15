// Aviso flotante ("toast") global: cualquier componente llama a toast(mensaje) y el <Toaster/>
// montado una vez en App.jsx lo muestra, sin tener que pasar callbacks por props.
const listeners = new Set();

export function toast(message) {
  listeners.forEach((fn) => fn(message));
}

export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
