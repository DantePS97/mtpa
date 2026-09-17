import { Navigate, Outlet } from "react-router-dom";

import useAuth from "../hooks/useAuth";
import { ROUTES, MESSAGES } from "../utils/constants";
import { isValidRole } from "../utils/permissions";

// =========================================================
// M.T.P.A. - RUTA PROTEGIDA
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Exige una sesión activa de Firebase Authentication con un
// rol válido. La validación de un ROL específico (por
// ejemplo, "solo administrador") la hace RoleRoute.jsx.
//
// Nota: un usuario desactivado nunca llega a este punto como
// "usuario" (AuthContext lo desloguea apenas lo detecta), por
// lo que acá solo hace falta cubrir el caso de rol ausente o
// inválido (por ejemplo, si todavía no se le asignó ningún
// custom claim "role").
// =========================================================

const ProtectedRoute = () => {
  const { usuario, cargando } = useAuth();

  if (cargando) {
    return <div className="route-loader">{MESSAGES.LOADING}</div>;
  }

  if (!usuario) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  if (!isValidRole(usuario.rol)) {
    return <Navigate to={ROUTES.UNAUTHORIZED} replace />;
  }

  return <Outlet />;
};

export default ProtectedRoute;
