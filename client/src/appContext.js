import { createContext } from "react";

// Usuario actual y recarga de la lista de documentos, para componentes anidados (p. ej. DocumentModal,
// que se abre desde el chat y desde el explorador) sin pasar props por todos los niveles. También los
// favoritos del usuario (la estrella de cada DocumentCard y la vista «Favoritos»).
export const AppContext = createContext({ user: null, reloadDocuments: () => {}, favorites: null, favoriteIds: new Set(), toggleFavorite: null });
