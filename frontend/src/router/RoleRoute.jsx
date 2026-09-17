import { Navigate, Outlet } from "react-router-dom";

import useAuth from "../hooks/useAuth";
import { ROUTES, MESSAGES } from "../utils/constants";
import { canAccessRoute } from "../utils/permissions";

// =========================================================
// M.T.P.A. - RUTA RESTRINGIDA POR ROL
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Además de exigir sesión activa (igual que ProtectedRoute),
// valida que el rol del usuario esté incluido en "roles"
// usando canAccessRoute (frontend/src/utils/permissions.js).
// =========================================================

const RoleRoute = ({ roles = [] }) => {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return <div className="route-loader">{MESSAGES.LOADING}</div>;
  }

  if (!usuario) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (!canAccessRoute(usuario, { roles })) {
    return <Navigate to={ROUTES.UNAUTHORIZED} replace />;
  }

  return <Outlet />;
};

export default RoleRoute;
