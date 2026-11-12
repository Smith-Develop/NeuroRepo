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
  notes: (q) => req(`/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  draft: (text) => req("/notes/draft", { method: "POST", body: { text } }),
  createNote: (body) => req("/notes", { method: "POST", body }),
  updateNote: (id, body) => req(`/notes/${id}`, { method: "PATCH", body }),
  deleteNote: (id) => req(`/notes/${id}`, { method: "DELETE" }),
};
