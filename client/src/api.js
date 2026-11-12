async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  scenarios: () => req("/scenarios"),
  notes: (params = {}) => req(`/notes?${new URLSearchParams(Object.entries(params).filter(([, v]) => v))}`),
  addNote: (text) => req("/notes", { method: "POST", body: { text } }),
  updateNote: (id, body) => req(`/notes/${id}`, { method: "PATCH", body }),
  deleteNote: (id) => req(`/notes/${id}`, { method: "DELETE" }),
  ask: (question) => req("/ask", { method: "POST", body: { question } }),
};
