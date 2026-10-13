import { NavLink } from "react-router-dom";

import useAuth from "../../hooks/useAuth";
import authRepository from "../../repositories/authRepository";
import {
  getNavigationForUser,
} from "../../utils/permissions";

import "./Sidebar.css";

const Sidebar = () => {
  const { usuario } = useAuth();

  // Los ítems marcados con "pendiente" (ver NAVIGATION_ITEMS) todavía
  // no tienen página montada: no se muestran para no llevar al 404.
  const items =
    getNavigationForUser(usuario).filter(
      (item) => !item.pendiente
    );

  // useAuth no expone logout: se usa el repositorio de autenticación,
  // como hace Login con el inicio de sesión. No hace falta navegar:
  // AuthContext pasa "usuario" a null y ProtectedRoute redirige a
  // /login.
  const handleLogout = async () => {
    try {
      await authRepository.logout();
    } catch (error) {
      console.error(
        "No fue posible cerrar la sesión:",
        error
      );
    }
  };

  return (
    <aside
      className="app-sidebar hide-print"
      aria-label="Navegación principal"
    >
      <div className="app-sidebar__brand">
        <strong>M.T.P.A.</strong>

        <span>
          Mejora Técnica de Producción Avícola
        </span>
      </div>

      <nav className="app-sidebar__nav">
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `app-sidebar__link${
                isActive
                  ? " app-sidebar__link--active"
                  : ""
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        className="app-sidebar__logout"
        onClick={handleLogout}
      >
        Cerrar sesión
      </button>
    </aside>
  );
};

export default Sidebar;
