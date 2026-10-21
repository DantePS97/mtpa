import { Link } from "react-router-dom";

import { MESSAGES, ROUTES } from "../../utils/constants";

import "./ErrorPage.css";

// =========================================================
// M.T.P.A. - PÁGINA DE ACCESO NO AUTORIZADO
// Mejora Técnica de Producción Avícola
// =========================================================

const Unauthorized = () => {
  return (
    <main className="error-page unauthorized-page">
      <h1>Acceso no autorizado</h1>
      <p>{MESSAGES.UNAUTHORIZED}</p>
      <Link className="error-page__link" to={ROUTES.DASHBOARD}>
        Volver al panel general
      </Link>
    </main>
  );
};

export default Unauthorized;
