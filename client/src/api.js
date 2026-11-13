async function req(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  scenarios: () => req("/scenarios"),
  notes: (q) => req(`/notes${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  draft: (text) => req("/notes/draft", { method: "POST", body: { text } }),
  ask: (question) => req("/ask", { method: "POST", body: { question } }),
  createNote: (body) => req("/notes", { method: "POST", body }),
  updateNote: (id, body) => req(`/notes/${id}`, { method: "PATCH", body }),
  deleteNote: (id) => req(`/notes/${id}`, { method: "DELETE" }),

  login: (username, password) => req("/login", { method: "POST", body: { username, password } }),
  logout: () => req("/logout", { method: "POST" }),
  me: () => req("/me"),

  createSuggestion: (body) => req("/suggestions", { method: "POST", body }),
  suggestions: () => req("/suggestions"),
  resolveSuggestion: (id, body) => req(`/suggestions/${id}`, { method: "PATCH", body }),

  createUser: (body) => req("/users", { method: "POST", body }),
  users: () => req("/users"),
  updateUserGroup: (id, group) => req(`/users/${id}`, { method: "PATCH", body: { group } }),
  deleteUser: (id) => req(`/users/${id}`, { method: "DELETE" }),
  resetPassword: (id, password) => req(`/users/${id}/password`, { method: "POST", body: { password } }),

  groups: () => req("/groups"),
  createGroup: (body) => req("/groups", { method: "POST", body }),
  updateGroup: (id, body) => req(`/groups/${id}`, { method: "PATCH", body }),
  deleteGroup: (id) => req(`/groups/${id}`, { method: "DELETE" }),
  updateScenario: (id, body) => req(`/scenarios/${id}`, { method: "PATCH", body }),
};
