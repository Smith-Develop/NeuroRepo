// Historial de conversaciones del chat, guardado en el localStorage del navegador de cada usuario
// (clave por id de usuario: en un PC compartido cada uno ve solo el suyo). No sale del navegador.
// Todo va en try/catch: con el almacenamiento bloqueado o lleno el chat sigue funcionando sin historial.
const MAX_CONVERSATIONS = 40;
const EVENT = "neurorepo:history";
const keyFor = (userId) => `neurorepo.chat.${userId}`;

function read(userId) {
  try {
    const list = JSON.parse(localStorage.getItem(keyFor(userId)) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(userId, list) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(list.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // sin espacio o bloqueado: se pierde el historial, no la conversación en curso
  }
  window.dispatchEvent(new Event(EVENT));
}

// [{id, title, updatedAt}] de la más reciente a la más antigua
export const listConversations = (userId) => read(userId).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));

export function getConversation(userId, id) {
  return read(userId).find((c) => c.id === id) || null;
}

export function saveConversation(userId, conversation) {
  const rest = read(userId).filter((c) => c.id !== conversation.id);
  write(userId, [{ ...conversation, updatedAt: Date.now() }, ...rest]);
}

export function deleteConversation(userId, id) {
  write(userId, read(userId).filter((c) => c.id !== id));
}

export function onHistoryChange(fn) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn); // cambios desde otra pestaña
  return () => { window.removeEventListener(EVENT, fn); window.removeEventListener("storage", fn); };
}

export const newConversationId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
