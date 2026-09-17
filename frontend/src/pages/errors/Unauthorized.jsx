import { Link } from "react-router-dom";

import { MESSAGES, ROUTES } from "../../utils/constants";

// =========================================================
// M.T.P.A. - PÁGINA DE ACCESO NO AUTORIZADO
// Mejora Técnica de Producción Avícola
// =========================================================

const Unauthorized = () => {
  return (
    <section className="unauthorized-page">
      <h1>Acceso no autorizado</h1>
      <p>{MESSAGES.UNAUTHORIZED}</p>
      <Link to={ROUTES.DASHBOARD}>Volver al panel general</Link>
    </section>
  );
};

export default Unauthorized;
