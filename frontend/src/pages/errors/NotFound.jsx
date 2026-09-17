import { Link } from "react-router-dom";

import { ROUTES } from "../../utils/constants";

// =========================================================
// M.T.P.A. - PÁGINA 404
// Mejora Técnica de Producción Avícola
// =========================================================

const NotFound = () => {
  return (
    <section className="not-found-page">
      <h1>404</h1>
      <p>La página que buscás no existe.</p>
      <Link to={ROUTES.DASHBOARD}>Volver al panel general</Link>
    </section>
  );
};

export default NotFound;
