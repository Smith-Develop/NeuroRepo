// Tema claro/oscuro: preferencia de cada navegador (localStorage). El oscuro es el de siempre; el claro
// se activa con data-theme="light" en <html>. index.html lo aplica antes de pintar para que no parpadee.
const KEY = "neurorepo-theme";

export function getTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(KEY, theme); } catch { /* sin almacenamiento (modo privado): solo dura esta visita */ }
}
