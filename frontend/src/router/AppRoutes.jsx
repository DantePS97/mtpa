import { Route, Routes } from "react-router-dom";

import AuthLayout from "../layouts/AuthLayout";
import DashboardLayout from "../layouts/DashboardLayout";

import Login from "../pages/auth/Login";
import Dashboard from "../pages/dashboard/Dashboard";
import Usuarios from "../pages/usuarios/Usuarios";
import UsuarioForm from "../pages/usuarios/UsuarioForm";
import NotFound from "../pages/errors/NotFound";
import Unauthorized from "../pages/errors/Unauthorized";

import ProtectedRoute from "./ProtectedRoute";
import RoleRoute from "./RoleRoute";

import { ROLES, ROUTES } from "../utils/constants";

// =========================================================
// M.T.P.A. - RUTAS DE LA APLICACIÓN
// Mejora Técnica de Producción Avícola
// =========================================================
//
// - Rutas públicas: envueltas en AuthLayout (solo "/login"
//   por ahora).
// - Rutas protegidas: exigen sesión activa (ProtectedRoute).
// - "/usuarios" además exige rol "administrador" (RoleRoute).
//
// Nota: Dashboard.jsx, DashboardLayout.jsx, NotFound.jsx y
// Unauthorized.jsx se agregan aquí como placeholders mínimos
// (antes eran archivos vacíos) para que el árbol de rutas
// tenga algo real que renderizar; su implementación visual
// completa queda para un sprint posterior.
// =========================================================

const AppRoutes = () => {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path={ROUTES.LOGIN} element={<Login />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<DashboardLayout />}>
          <Route path={ROUTES.DASHBOARD} element={<Dashboard />} />

          <Route element={<RoleRoute roles={[ROLES.ADMIN]} />}>
            <Route path={ROUTES.USERS} element={<Usuarios />} />
            <Route path={ROUTES.USER_CREATE} element={<UsuarioForm />} />
            <Route path={ROUTES.USER_EDIT} element={<UsuarioForm />} />
          </Route>
        </Route>
      </Route>

      <Route path={ROUTES.UNAUTHORIZED} element={<Unauthorized />} />
      <Route path={ROUTES.NOT_FOUND} element={<NotFound />} />
    </Routes>
  );
};

export default AppRoutes;
