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
    err.needsPassword = data.needsPassword;
    throw err;
  }
  return data;
}

export const api = {
  documents: (q) => req(`/documents${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  ask: (question) => req("/ask", { method: "POST", body: { question } }),
  viewUrl: (id) => `/api/documents/${id}/view`,
  downloadUrl: (id) => `/api/documents/${id}/download`,

  login: (dni, password) => req("/login", { method: "POST", body: password ? { dni, password } : { dni } }),
  logout: () => req("/logout", { method: "POST" }),
  me: () => req("/me"),

  createUser: (body) => req("/users", { method: "POST", body }),
  users: () => req("/users"),
  updateUser: (id, body) => req(`/users/${id}`, { method: "PATCH", body }),
  deleteUser: (id) => req(`/users/${id}`, { method: "DELETE" }),
  importUsers: (text) => req("/users/import", { method: "POST", body: { text } }),

  groups: () => req("/groups"),
  createGroup: (body) => req("/groups", { method: "POST", body }),
  updateGroup: (id, body) => req(`/groups/${id}`, { method: "PATCH", body }),
  deleteGroup: (id) => req(`/groups/${id}`, { method: "DELETE" }),

  folders: () => req("/folders"),
  updateFolder: (name, blockedMessage) => req(`/folders/${encodeURIComponent(name)}`, { method: "PATCH", body: { blockedMessage } }),

  library: () => req("/library"),
  browseLibrary: (path = "") => req(`/library/browse?path=${encodeURIComponent(path)}`),
  selectLibrary: (path) => req("/library/select", { method: "POST", body: { path } }),
  reindexLibrary: () => req("/library/reindex", { method: "POST" }),
};
