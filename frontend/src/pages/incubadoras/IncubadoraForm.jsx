import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import incubadorasRepository from "../../repositories/incubadorasRepository";
import dispositivosRepository from "../../repositories/dispositivosRepository";
import { ROUTES } from "../../utils/constants";
import "./IncubadoraForm.css";

// Valores exactos aceptados por gestionarIncubadora (ver
// functions/index.js). No se usan otros estados/tipos en este
// formulario aunque frontend/src/utils/constants.js defina más
// (esos otros los escribe el Servicio de Integración IoT, no el
// alta/edición manual).
const ESTADOS_INCUBADORA = [
  { value: "activa", label: "Activa" },
  { value: "inactiva", label: "Inactiva" },
];

const TIPOS_DISPOSITIVO = [
  { value: "sensor_temperatura", label: "Sensor de temperatura" },
  { value: "sensor_humedad", label: "Sensor de humedad" },
  { value: "ventilador", label: "Ventilador" },
];

const IncubadoraForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  const isEditing = Boolean(id);

  const [formData, setFormData] = useState({
    nombre: "",
    ubicacion: "",
    estado: "activa",
  });

  const [errores, setErrores] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadingIncubadora, setLoadingIncubadora] = useState(isEditing);
  const [error, setError] = useState("");

  const [dispositivos, setDispositivos] = useState([]);
  const [tipoDispositivo, setTipoDispositivo] = useState(
    TIPOS_DISPOSITIVO[0].value
  );
  const [loadingDispositivo, setLoadingDispositivo] = useState(false);
  const [errorDispositivo, setErrorDispositivo] = useState("");
  const [mensajeDispositivo, setMensajeDispositivo] = useState("");

  const cargarIncubadora = async () => {
    try {
      setLoadingIncubadora(true);
      setError("");

      const incubadora = await incubadorasRepository.obtenerIncubadora(id);

      if (!incubadora) {
        setError("La incubadora indicada no existe.");
        return;
      }

      setFormData({
        nombre: incubadora.nombre || "",
        ubicacion: incubadora.ubicacion || "",
        estado: incubadora.estado || "activa",
      });

      await cargarDispositivos();
    } catch (err) {
      setError(err?.message || "No fue posible cargar la incubadora.");
    } finally {
      setLoadingIncubadora(false);
    }
  };

  const cargarDispositivos = async () => {
    const lista = await dispositivosRepository.listarDispositivosPorIncubadora(
      id
    );
    setDispositivos(Array.isArray(lista) ? lista : []);
  };

  useEffect(() => {
    if (isEditing) {
      cargarIncubadora();
    }
  }, [id]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));

    if (errores[name]) {
      setErrores((previous) => {
        const siguientes = { ...previous };
        delete siguientes[name];
        return siguientes;
      });
    }

    if (error) {
      setError("");
    }
  };

  const validar = () => {
    const nuevosErrores = {};

    if (!formData.nombre.trim()) {
      nuevosErrores.nombre = "El nombre es obligatorio.";
    }

    if (!formData.ubicacion.trim()) {
      nuevosErrores.ubicacion = "La ubicación es obligatoria.";
    }

    if (!ESTADOS_INCUBADORA.some((opcion) => opcion.value === formData.estado)) {
      nuevosErrores.estado = "Debe seleccionar un estado válido.";
    }

    setErrores(nuevosErrores);

    return Object.keys(nuevosErrores).length === 0;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!validar()) {
      return;
    }

    try {
      setLoading(true);
      setError("");

      if (isEditing) {
        await incubadorasRepository.gestionarIncubadora({
          accion: "editar",
          id,
          nombre: formData.nombre.trim(),
          ubicacion: formData.ubicacion.trim(),
          estado: formData.estado,
        });
      } else {
        await incubadorasRepository.gestionarIncubadora({
          accion: "crear",
          nombre: formData.nombre.trim(),
          ubicacion: formData.ubicacion.trim(),
          estado: formData.estado,
        });
      }

      navigate(ROUTES.INCUBATORS);
    } catch (err) {
      setError(err?.message || "No fue posible guardar la incubadora.");
    } finally {
      setLoading(false);
    }
  };

  const handleAgregarDispositivo = async (event) => {
    event.preventDefault();

    if (!tipoDispositivo) {
      setErrorDispositivo("Debe seleccionar un tipo de dispositivo.");
      return;
    }

    try {
      setLoadingDispositivo(true);
      setErrorDispositivo("");
      setMensajeDispositivo("");

      const resultado = await incubadorasRepository.gestionarIncubadora({
        accion: "crear_dispositivo",
        incubadoraId: id,
        tipo: tipoDispositivo,
      });

      setMensajeDispositivo(
        `Dispositivo agregado. Identificador MQTT: ${resultado.identificadorMqtt}`
      );

      await cargarDispositivos();
    } catch (err) {
      setErrorDispositivo(
        err?.message || "No fue posible dar de alta el dispositivo."
      );
    } finally {
      setLoadingDispositivo(false);
    }
  };

  if (loadingIncubadora) {
    return (
      <section className="incubadora-form-page">
        <div className="incubadora-form-card">
          <p className="incubadora-form-loading">Cargando incubadora...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="incubadora-form-page">
      <div className="incubadora-form-card">
        <div className="incubadora-form-header">
          <button
            type="button"
            className="btn-back"
            onClick={() => navigate(ROUTES.INCUBATORS)}
          >
            ← Volver
          </button>

          <div>
            <h1>{isEditing ? "Editar incubadora" : "Nueva incubadora"}</h1>
            <p>
              {isEditing
                ? "Modifique la información de la incubadora."
                : "Registre una nueva incubadora en el sistema."}
            </p>
          </div>
        </div>

        {error && (
          <div className="incubadora-form-error" role="alert">
            {error}
          </div>
        )}

        <form className="incubadora-form" onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="nombre">Nombre</label>

            <input
              id="nombre"
              name="nombre"
              type="text"
              value={formData.nombre}
              onChange={handleChange}
              placeholder="Ingrese el nombre de la incubadora"
              disabled={loading}
            />

            {errores.nombre && (
              <span className="form-error">{errores.nombre}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="ubicacion">Ubicación</label>

            <input
              id="ubicacion"
              name="ubicacion"
              type="text"
              value={formData.ubicacion}
              onChange={handleChange}
              placeholder="Ej: Galpón 2, sector A"
              disabled={loading}
            />

            {errores.ubicacion && (
              <span className="form-error">{errores.ubicacion}</span>
            )}
          </div>

          <div className="form-group">
            <label htmlFor="estado">Estado</label>

            <select
              id="estado"
              name="estado"
              value={formData.estado}
              onChange={handleChange}
              disabled={loading}
            >
              {ESTADOS_INCUBADORA.map((opcion) => (
                <option key={opcion.value} value={opcion.value}>
                  {opcion.label}
                </option>
              ))}
            </select>

            {errores.estado && (
              <span className="form-error">{errores.estado}</span>
            )}
          </div>

          <div className="incubadora-form-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={() => navigate(ROUTES.INCUBATORS)}
              disabled={loading}
            >
              Cancelar
            </button>

            <button type="submit" className="btn-save" disabled={loading}>
              {loading
                ? "Guardando..."
                : isEditing
                ? "Guardar cambios"
                : "Crear incubadora"}
            </button>
          </div>
        </form>
      </div>

      {isEditing && !error && (
        <div className="incubadora-form-card">
          <h2>Dispositivos</h2>
          <p>Dé de alta un dispositivo asociado a esta incubadora.</p>

          {errorDispositivo && (
            <div className="incubadora-form-error" role="alert">
              {errorDispositivo}
            </div>
          )}

          {mensajeDispositivo && (
            <div className="incubadora-form-success" role="status">
              {mensajeDispositivo}
            </div>
          )}

          <form
            className="dispositivo-form"
            onSubmit={handleAgregarDispositivo}
          >
            <div className="form-group">
              <label htmlFor="tipoDispositivo">Tipo de dispositivo</label>

              <select
                id="tipoDispositivo"
                name="tipoDispositivo"
                value={tipoDispositivo}
                onChange={(event) => setTipoDispositivo(event.target.value)}
                disabled={loadingDispositivo}
              >
                {TIPOS_DISPOSITIVO.map((opcion) => (
                  <option key={opcion.value} value={opcion.value}>
                    {opcion.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="btn-save"
              disabled={loadingDispositivo}
            >
              {loadingDispositivo ? "Agregando..." : "+ Agregar dispositivo"}
            </button>
          </form>

          {dispositivos.length > 0 && (
            <ul className="dispositivos-lista">
              {dispositivos.map((dispositivo) => (
                <li key={dispositivo.id}>
                  <strong>{dispositivo.tipo}</strong> —{" "}
                  {dispositivo.identificadorMqtt}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};

export default IncubadoraForm;
