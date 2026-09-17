import useAuth from "../../hooks/useAuth";

// =========================================================
// M.T.P.A. - PANEL GENERAL
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Placeholder mínimo: las tarjetas de estado, gráficas de
// temperatura/humedad, etc. (ver components/dashboard/) se
// integran en un sprint posterior. Este componente solo
// garantiza que la ruta protegida ROUTES.DASHBOARD tenga
// contenido real luego del login.
// =========================================================

const Dashboard = () => {
  const { usuario } = useAuth();

  return (
    <section className="dashboard-page">
      <h1>Panel general</h1>
      <p>Bienvenido{usuario?.nombre ? `, ${usuario.nombre}` : ""}.</p>
    </section>
  );
};

export default Dashboard;
