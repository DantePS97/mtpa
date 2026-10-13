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
// Header.jsx, MobileNavigation.jsx y PageHeader.jsx existen
// pero están vacíos; no se montan hasta que tengan diseño.
// =========================================================

const DashboardLayout = () => {
  return (
    <div className="dashboard-layout">
      <Sidebar />

      <div className="dashboard-layout__content">
        <NotificationBanner />
        <Outlet />
      </div>
    </div>
  );
};

export default DashboardLayout;
