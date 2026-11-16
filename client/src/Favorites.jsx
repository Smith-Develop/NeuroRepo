import { useContext } from "react";
import DocumentCard from "./DocumentCard";
import { AppContext } from "./appContext";
import { StarIcon } from "./icons";

// Documentos que el usuario marcó con la estrella en el chat: acceso directo sin volver a buscar.
export default function Favorites() {
  const { favorites } = useContext(AppContext);
  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Favoritos</h1>
            <p>Documentos que has marcado con la estrella en el chat, para tenerlos siempre a mano.</p>
          </div>
        </div>
        {favorites === null ? null : favorites.length === 0 ? (
          <div className="empty">
            <div className="ic"><StarIcon size={20} /></div>
            <b>Todavía no tienes favoritos</b>
            Busca un documento en el chat y pulsa la estrella para guardarlo aquí.
          </div>
        ) : (
          <div className="results">
            {favorites.map((d) => <DocumentCard key={d._id} doc={d} />)}
          </div>
        )}
      </div>
    </div>
  );
}
