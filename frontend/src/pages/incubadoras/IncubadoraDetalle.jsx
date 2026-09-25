import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Table from "../../components/common/Table";
import incubadorasRepository from "../../repositories/incubadorasRepository";
import dispositivosRepository from "../../repositories/dispositivosRepository";
import { ROUTES } from "../../utils/constants";
import "./IncubadoraDetalle.css";

// Etiquetas legibles para mostrar en esta pantalla. Se mantienen
// acá (y no en utils/constants.js) porque son puramente de
// presentación de esta vista de detalle.
const TIPO_DISPOSITIVO_LABELS = {
  sensor_temperatura: "Sensor de temperatura",
  sensor_humedad: "Sensor de humedad",
  sensor_temperatura_humedad: "Sensor de temperatura y humedad",
  ventilador: "Ventilador",
  controlador: "Controlador",
};

const ESTADO_CONEXION_LABELS = {
  conectado: "Conectado",
  desconectado: "Desconectado",
  advertencia: "Advertencia",
  desconocido: "Desconocido",
};

const IncubadoraDetalle = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  const [incubadora, setIncubadora] = useState(null);
  const [dispositivos, setDispositivos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargarIncubadora = async () => {
    try {
      setLoading(true);
      setError("");

      const incubadoraEncontrada = await incubadorasRepository.obtenerIncubadora(
        id
      );

      if (!incubadoraEncontrada) {
        setError("La incubadora indicada no existe.");
        setIncubadora(null);
        return;
      }

      setIncubadora(incubadoraEncontrada);
    } catch (err) {
      setError(err?.message || "No fue posible cargar la incubadora.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarIncubadora();
  }, [id]);

  // Dispositivos: se suscribe en tiempo real (onSnapshot) en vez de
  // hacer una lectura única, para reflejar sin recargar la página
  // cambios de "estadoConexion" (por ejemplo, cuando el Servicio de
  // Integración IoT marque un dispositivo "desconectado" en Sprint 3).
  useEffect(() => {
    const unsubscribe = dispositivosRepository.suscribirseADispositivosPorIncubadora(
      id,
      (listaDispositivos) => {
        setDispositivos(Array.isArray(listaDispositivos) ? listaDispositivos : []);
      },
      (err) => {
        setError(
          err?.message || "No fue posible escuchar los dispositivos en tiempo real."
        );
      }
    );

    return () => unsubscribe();
  }, [id]);

  const columnasDispositivos = [
    {
      key: "tipo",
      header: "Tipo",
      render: (dispositivo) =>
        TIPO_DISPOSITIVO_LABELS[dispositivo.tipo] || dispositivo.tipo,
    },
    {
      key: "identificadorMqtt",
      header: "Identificador MQTT",
    },
    {
      key: "estadoConexion",
      header: "Estado de conexión",
      render: (dispositivo) => (
        <span
          className={`estado-conexion-badge estado-conexion-${
            dispositivo.estadoConexion || "desconocido"
          }`}
        >
          {ESTADO_CONEXION_LABELS[dispositivo.estadoConexion] ||
            "Desconocido"}
        </span>
      ),
    },
  ];

  if (loading) {
    return (
      <section className="incubadora-detalle-page">
        <div className="incubadora-detalle-card">
          <p className="incubadora-detalle-loading">Cargando incubadora...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="incubadora-detalle-page">
      <div className="incubadora-detalle-header">
        <button
          type="button"
          className="btn-back"
          onClick={() => navigate(ROUTES.INCUBATORS)}
        >
          ← Volver
        </button>

        {incubadora && (
          <button
            type="button"
            className="btn-edit"
            onClick={() =>
              navigate(ROUTES.INCUBATOR_EDIT.replace(":id", incubadora.id))
            }
          >
            Editar
          </button>
        )}
      </div>

      {error && (
        <div className="incubadora-detalle-error" role="alert">
          {error}
        </div>
      )}

      {incubadora && (
        <>
          <div className="incubadora-detalle-card">
            <h1>{incubadora.nombre}</h1>

            <dl className="incubadora-detalle-datos">
              <div>
                <dt>Ubicación</dt>
                <dd>{incubadora.ubicacion}</dd>
              </div>

              <div>
                <dt>Estado</dt>
                <dd>
                  <span
                    className={`estado-badge ${
                      incubadora.estado === "activa"
                        ? "estado-activo"
                        : "estado-inactivo"
                    }`}
                  >
                    {incubadora.estado === "activa" ? "Activa" : "Inactiva"}
                  </span>
                </dd>
              </div>
            </dl>
          </div>

          <div className="incubadora-detalle-card">
            <h2>Dispositivos</h2>

            {dispositivos.length === 0 ? (
              <div className="incubadora-detalle-empty">
                Esta incubadora todavía no tiene dispositivos dados de alta.
              </div>
            ) : (
              <Table columns={columnasDispositivos} data={dispositivos} />
            )}
          </div>
        </>
      )}
    </section>
  );
};

export default IncubadoraDetalle;
