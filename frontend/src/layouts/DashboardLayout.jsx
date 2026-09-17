import { Outlet } from "react-router-dom";

// =========================================================
// M.T.P.A. - LAYOUT DE PÁGINAS PROTEGIDAS
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Placeholder mínimo: el encabezado, la barra lateral de
// navegación y demás elementos visuales (Header.jsx,
// Sidebar.jsx, ya existentes en components/layout/) se
// integran en un sprint posterior. Por ahora solo delega en
// <Outlet /> para que las rutas protegidas tengan un layout
// funcional.
// =========================================================

const DashboardLayout = () => {
  return (
    <div className="dashboard-layout">
      <Outlet />
    </div>
  );
};

export default DashboardLayout;
