import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Table from "../../components/common/Table";
import incubadorasRepository from "../../repositories/incubadorasRepository";
import { INCUBATOR_STATUS, ROUTES } from "../../utils/constants";
import "./Incubadoras.css";

const Incubadoras = () => {
  const navigate = useNavigate();

  const [incubadoras, setIncubadoras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargarIncubadoras = async () => {
    try {
      setLoading(true);
      setError("");

      const data = await incubadorasRepository.listarIncubadoras();

      setIncubadoras(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(
        err?.message || "No fue posible cargar las incubadoras."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarIncubadoras();
  }, []);

  const columns = [
    {
      key: "nombre",
      header: "Nombre",
    },
    {
      key: "ubicacion",
      header: "Ubicación",
    },
    {
      key: "estado",
      header: "Estado",
      render: (incubadora) => (
        <span
          className={`estado-badge ${
            incubadora.estado === INCUBATOR_STATUS.ACTIVE
              ? "estado-activo"
              : "estado-inactivo"
          }`}
        >
          {incubadora.estado === INCUBATOR_STATUS.ACTIVE
            ? "Activa"
            : "Inactiva"}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (incubadora) => (
        <button
          type="button"
          className="btn-ver-detalle"
          onClick={() =>
            navigate(ROUTES.INCUBATOR_DETAIL.replace(":id", incubadora.id))
          }
        >
          Ver detalle
        </button>
      ),
    },
  ];

  return (
    <section className="incubadoras-page">
      <div className="incubadoras-header">
        <div>
          <h1>Incubadoras</h1>
          <p>Monitoreá el estado de las incubadoras registradas.</p>
        </div>

        <button
          type="button"
          className="btn-new-incubadora"
          onClick={() => navigate(ROUTES.INCUBATOR_CREATE)}
        >
          + Nueva incubadora
        </button>
      </div>

      {error && (
        <div className="incubadoras-error" role="alert">
          {error}
        </div>
      )}

      <div className="incubadoras-card">
        {loading ? (
          <div className="incubadoras-loading">Cargando incubadoras...</div>
        ) : incubadoras.length === 0 ? (
          <div className="incubadoras-empty">
            No hay incubadoras registradas.
          </div>
        ) : (
          <Table columns={columns} data={incubadoras} />
        )}
      </div>
    </section>
  );
};

export default Incubadoras;
