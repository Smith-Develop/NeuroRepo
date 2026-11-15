import { createContext } from "react";

// Usuario actual y recarga de la lista de documentos, para componentes anidados (p. ej. DocumentModal,
// que se abre desde el chat y desde el explorador) sin pasar props por todos los niveles.
export const AppContext = createContext({ user: null, reloadDocuments: () => {} });
