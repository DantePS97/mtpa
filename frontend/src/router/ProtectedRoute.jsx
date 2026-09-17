import { Navigate, Outlet } from "react-router-dom";

import useAuth from "../hooks/useAuth";
import { ROUTES, MESSAGES } from "../utils/constants";

// =========================================================
// M.T.P.A. - RUTA PROTEGIDA
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Exige una sesión activa de Firebase Authentication.
// La validación de ROL específico la hace RoleRoute.jsx.
// =========================================================

const ProtectedRoute = () => {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return <div className="route-loader">{MESSAGES.LOADING}</div>;
  }

  if (!usuario) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
