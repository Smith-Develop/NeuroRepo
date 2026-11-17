// Tema claro/oscuro: preferencia de cada navegador (localStorage). El claro es el de por defecto y se
// activa con data-theme="light" en <html>; sin el atributo, los tokens de :root son los del oscuro.
// index.html lo aplica antes de pintar para que no parpadee. La clave conserva el nombre antiguo
// del producto para respetar la elección de quien ya eligiera el oscuro.
const KEY = "neurorepo-theme";

export function getTheme() {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function setTheme(theme) {
  if (theme === "light") document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  try { localStorage.setItem(KEY, theme); } catch { /* sin almacenamiento (modo privado): solo dura esta visita */ }
}
