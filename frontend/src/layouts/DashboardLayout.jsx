import { useRef } from "react";
import { Outlet } from "react-router-dom";

import NotificationBanner from "../components/alerts/NotificationBanner";
import Sidebar from "../components/layout/Sidebar";

import "./DashboardLayout.css";

// =========================================================
// M.T.P.A. - LAYOUT DE PÁGINAS PROTEGIDAS
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Dos columnas: el menú de navegación (Sidebar) y, a su lado,
// el contenido de la ruta activa (<Outlet />) con el banner de
// notificaciones arriba. En pantallas angostas el menú pasa a
// una barra horizontal encima del contenido (ver
// DashboardLayout.css y Sidebar.css).
//
// El contenido es el <main> de la página; el enlace "Saltar al
// contenido" (primer elemento enfocable) lleva el foco hasta él.
//
// Header.jsx, MobileNavigation.jsx y PageHeader.jsx existen
// pero están vacíos; no se montan hasta que tengan diseño.
// =========================================================

const DashboardLayout = () => {
  const contenidoRef = useRef(null);

  // Se enfoca el <main> a mano en lugar de navegar al ancla, para
  // no agregar "#contenido-principal" a la URL del router.
  const saltarAlContenido = (event) => {
    event.preventDefault();
    contenidoRef.current?.focus();
  };

  return (
    <div className="dashboard-layout">
      <a
        className="dashboard-layout__skip-link hide-print"
        href="#contenido-principal"
        onClick={saltarAlContenido}
      >
        Saltar al contenido
      </a>

      <Sidebar />

      <main
        id="contenido-principal"
        className="dashboard-layout__content"
        ref={contenidoRef}
        tabIndex={-1}
      >
        <NotificationBanner />
        <Outlet />
      </main>
    </div>
  );
};

export default DashboardLayout;
