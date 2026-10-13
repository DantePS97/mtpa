import { useState } from "react";
import { NavLink } from "react-router-dom";

import useAuth from "../../hooks/useAuth";
import authRepository from "../../repositories/authRepository";
import {
  getNavigationForUser,
} from "../../utils/permissions";

import "./Sidebar.css";

const Sidebar = () => {
  const { usuario } = useAuth();

  const [cerrando, setCerrando] = useState(false);
  const [errorLogout, setErrorLogout] = useState(false);

  // Los ítems marcados con "pendiente" (ver NAVIGATION_ITEMS) todavía
  // no tienen página montada: no se muestran para no llevar al 404.
  const items =
    getNavigationForUser(usuario).filter(
      (item) => !item.pendiente
    );

  // useAuth no expone logout: se usa el repositorio de autenticación,
  // como hace Login con el inicio de sesión. No hace falta navegar:
  // AuthContext pasa "usuario" a null y ProtectedRoute redirige a
  // /login. Si el cierre tiene éxito el Sidebar se desmonta, por eso
  // solo se actualiza el estado cuando falla.
  const handleLogout = async () => {
    setCerrando(true);
    setErrorLogout(false);

    try {
      await authRepository.logout();
    } catch (error) {
      console.error(
        "No fue posible cerrar la sesión:",
        error
      );

      setErrorLogout(true);
      setCerrando(false);
    }
  };

  // El botón "Cerrar sesión" va dentro del <nav>, como último
  // elemento: así el orden visual coincide con el orden de foco
  // tanto en la columna de escritorio como en la barra horizontal.
  return (
    <div className="app-sidebar hide-print">
      <div className="app-sidebar__brand">
        <strong>M.T.P.A.</strong>

        <span>
          Mejora Técnica de Producción Avícola
        </span>
      </div>

      <nav
        className="app-sidebar__nav"
        aria-label="Navegación principal"
      >
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
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

        <button
          type="button"
          className="app-sidebar__logout"
          onClick={handleLogout}
          disabled={cerrando}
        >
          {cerrando
            ? "Cerrando sesión..."
            : "Cerrar sesión"}
        </button>
      </nav>

      {errorLogout && (
        <p
          className="app-sidebar__error"
          role="alert"
        >
          No fue posible cerrar la sesión. Inténtalo
          nuevamente.
        </p>
      )}
    </div>
  );
};

export default Sidebar;
