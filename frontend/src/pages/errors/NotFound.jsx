import { Link } from "react-router-dom";

import { ROUTES } from "../../utils/constants";

import "./ErrorPage.css";

// =========================================================
// M.T.P.A. - PÁGINA 404
// Mejora Técnica de Producción Avícola
// =========================================================

const NotFound = () => {
  return (
    <main className="error-page not-found-page">
      <h1>404</h1>
      <p>La página que buscas no existe.</p>
      <Link className="error-page__link" to={ROUTES.DASHBOARD}>
        Volver al panel general
      </Link>
    </main>
  );
};

export default NotFound;
