import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Table from "../../components/common/Table";
import incubadorasRepository from "../../repositories/incubadorasRepository";
import dispositivosRepository from "../../repositories/dispositivosRepository";
import { DEVICE_TYPES, INCUBATOR_STATUS, ROUTES } from "../../utils/constants";
import "./IncubadoraDetalle.css";

// Etiquetas legibles para mostrar en esta pantalla. Se mantienen
// acá (y no en utils/constants.js) porque son puramente de
// presentación de esta vista de detalle.
//
// Solo cubre los 3 tipos que "crearDispositivo" (functions/index.js,
// TIPOS_DISPOSITIVO_VALIDOS) realmente acepta en esta etapa; cualquier
// otro valor cae en el fallback de abajo.
const TIPO_DISPOSITIVO_LABELS = {
  [DEVICE_TYPES.TEMPERATURE_SENSOR]: "Sensor de temperatura",
  [DEVICE_TYPES.HUMIDITY_SENSOR]: "Sensor de humedad",
  [DEVICE_TYPES.FAN]: "Ventilador",
};

const TIPO_DISPOSITIVO_DESCONOCIDO = "Tipo desconocido";

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
        TIPO_DISPOSITIVO_LABELS[dispositivo.tipo] ||
        TIPO_DISPOSITIVO_DESCONOCIDO,
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
                      incubadora.estado === INCUBATOR_STATUS.ACTIVE
                        ? "estado-activo"
                        : "estado-inactivo"
                    }`}
                  >
                    {incubadora.estado === INCUBATOR_STATUS.ACTIVE
                      ? "Activa"
                      : "Inactiva"}
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
