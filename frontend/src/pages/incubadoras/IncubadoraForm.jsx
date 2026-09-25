import { useEffect, useState } from "react";
import { incubadorasRepository } from "../../repositories/incubadorasRepository";
import "./IncubadoraForm.css";

const ESTADOS = [
  { value: "activa", label: "Activa" },
  { value: "inactiva", label: "Inactiva" },
];

const TIPOS_DISPOSITIVO = [
  { value: "sensor_temperatura", label: "Sensor de temperatura" },
  { value: "sensor_humedad", label: "Sensor de humedad" },
  { value: "ventilador", label: "Ventilador" },
];

const INITIAL_FORM = {
  nombre: "",
  ubicacion: "",
  estado: "activa",
};

const INITIAL_DEVICE = {
  tipo: "",
};

function validateForm(form) {
  const errors = {};

  if (!form.nombre.trim()) {
    errors.nombre = "El nombre de la incubadora es obligatorio.";
  }

  if (!form.estado) {
    errors.estado = "Selecciona el estado de la incubadora.";
  }

  return errors;
}

function validateDevice(device) {
  if (!device.tipo) {
    return { tipo: "Selecciona el tipo de dispositivo." };
  }

  return {};
}

export default function IncubadoraForm({
  incubadora = null,
  onSaved,
  onCancel,
}) {
  const isEditing = Boolean(incubadora?.id);

  const [form, setForm] = useState({
    ...INITIAL_FORM,
    nombre: incubadora?.nombre ?? "",
    ubicacion: incubadora?.ubicacion ?? "",
    estado: incubadora?.estado ?? "activa",
  });

  const [device, setDevice] = useState(INITIAL_DEVICE);
  const [errors, setErrors] = useState({});
  const [deviceErrors, setDeviceErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [deviceMessage, setDeviceMessage] = useState("");
  const [savedIncubadoraId, setSavedIncubadoraId] = useState(
    incubadora?.id ?? null
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingDevice, setIsAddingDevice] = useState(false);

  useEffect(() => {
    setForm({
      ...INITIAL_FORM,
      nombre: incubadora?.nombre ?? "",
      ubicacion: incubadora?.ubicacion ?? "",
      estado: incubadora?.estado ?? "activa",
    });
    setSavedIncubadoraId(incubadora?.id ?? null);
    setErrors({});
    setSubmitError("");
    setDevice(INITIAL_DEVICE);
    setDeviceErrors({});
    setDeviceMessage("");
  }, [incubadora]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value,
    }));

    if (errors[name]) {
      setErrors((current) => ({
        ...current,
        [name]: "",
      }));
    }

    setSubmitError("");
  };

  const handleDeviceChange = (event) => {
    const { name, value } = event.target;

    setDevice((current) => ({
      ...current,
      [name]: value,
    }));

    if (deviceErrors[name]) {
      setDeviceErrors((current) => ({
        ...current,
        [name]: "",
      }));
    }

    setDeviceMessage("");
  };

  const handleBlur = (event) => {
    const { name } = event.target;
    const nextErrors = validateForm(form);

    setErrors((current) => ({
      ...current,
      [name]: nextErrors[name] ?? "",
    }));
  };

  const handleDeviceBlur = () => {
    const nextErrors = validateDevice(device);

    setDeviceErrors((current) => ({
      ...current,
      tipo: nextErrors.tipo ?? "",
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const validationErrors = validateForm(form);
    setErrors(validationErrors);
    setSubmitError("");

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setIsSaving(true);

    try {
      const payload = {
        nombre: form.nombre.trim(),
        ubicacion: form.ubicacion.trim(),
        estado: form.estado,
      };

      /*
       * gestionarIncubadora es la operación de negocio definida en el DDS.
       * El repository encapsula la llamada a la Cloud Function.
       */
      const result = await incubadorasRepository.gestionarIncubadora({
        accion: isEditing ? "actualizar" : "crear",
        incubadora: isEditing
          ? { id: incubadora.id, ...payload }
          : payload,
      });

      const id =
        incubadora?.id ??
        result?.id ??
        result?.incubadoraId ??
        result?.data?.id ??
        result?.data?.incubadoraId;

      setSavedIncubadoraId(id ?? null);
      onSaved?.(result);
    } catch (error) {
      setSubmitError(
        error?.message ||
          "No fue posible guardar la incubadora. Inténtalo nuevamente."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddDevice = async (event) => {
    event.preventDefault();

    const validationErrors = validateDevice(device);
    setDeviceErrors(validationErrors);
    setDeviceMessage("");

    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    if (!savedIncubadoraId) {
      setDeviceMessage(
        "Guarda primero la incubadora para poder registrar un dispositivo."
      );
      return;
    }

    setIsAddingDevice(true);

    try {
      await incubadorasRepository.gestionarIncubadora({
        accion: "crear_dispositivo",
        incubadoraId: savedIncubadoraId,
        dispositivo: {
          tipo: device.tipo,
        },
      });

      setDevice(INITIAL_DEVICE);
      setDeviceErrors({});
      setDeviceMessage("Dispositivo registrado correctamente.");
    } catch (error) {
      setDeviceMessage(
        error?.message ||
          "No fue posible registrar el dispositivo. Inténtalo nuevamente."
      );
    } finally {
      setIsAddingDevice(false);
    }
  };

  return (
    <section className="incubadora-form" aria-labelledby="incubadora-form-title">
      <div className="incubadora-form__header">
        <div>
          <p className="incubadora-form__eyebrow">Gestión de incubadoras</p>
          <h1 id="incubadora-form-title" className="incubadora-form__title">
            {isEditing ? "Editar incubadora" : "Nueva incubadora"}
          </h1>
          <p className="incubadora-form__description">
            Registra los datos básicos y asocia los dispositivos de la
            incubadora.
          </p>
        </div>
      </div>

      <form className="incubadora-form__body" onSubmit={handleSubmit} noValidate>
        <fieldset className="incubadora-form__section">
          <legend>Datos de la incubadora</legend>

          <div className="incubadora-form__grid">
            <div className="incubadora-form__field">
              <label htmlFor="incubadora-nombre">
                Nombre <span aria-hidden="true">*</span>
              </label>
              <input
                id="incubadora-nombre"
                name="nombre"
                type="text"
                value={form.nombre}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Ej. Incubadora principal"
                aria-invalid={Boolean(errors.nombre)}
                aria-describedby={errors.nombre ? "incubadora-nombre-error" : undefined}
              />
              {errors.nombre && (
                <p
                  id="incubadora-nombre-error"
                  className="incubadora-form__error"
                  role="alert"
                >
                  {errors.nombre}
                </p>
              )}
            </div>

            <div className="incubadora-form__field">
              <label htmlFor="incubadora-ubicacion">Ubicación</label>
              <input
                id="incubadora-ubicacion"
                name="ubicacion"
                type="text"
                value={form.ubicacion}
                onChange={handleChange}
                placeholder="Ej. Galpón 1"
              />
            </div>

            <div className="incubadora-form__field">
              <label htmlFor="incubadora-estado">
                Estado <span aria-hidden="true">*</span>
              </label>
              <select
                id="incubadora-estado"
                name="estado"
                value={form.estado}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={Boolean(errors.estado)}
                aria-describedby={errors.estado ? "incubadora-estado-error" : undefined}
              >
                <option value="">Selecciona un estado</option>
                {ESTADOS.map((estado) => (
                  <option key={estado.value} value={estado.value}>
                    {estado.label}
                  </option>
                ))}
              </select>
              {errors.estado && (
                <p
                  id="incubadora-estado-error"
                  className="incubadora-form__error"
                  role="alert"
                >
                  {errors.estado}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        <fieldset className="incubadora-form__section">
          <legend>Dar de alta un dispositivo</legend>

          <p className="incubadora-form__section-description">
            Asocia un sensor o ventilador a esta incubadora.
          </p>

          <div className="incubadora-form__device-row">
            <div className="incubadora-form__field">
              <label htmlFor="dispositivo-tipo">
                Tipo de dispositivo <span aria-hidden="true">*</span>
              </label>
              <select
                id="dispositivo-tipo"
                name="tipo"
                value={device.tipo}
                onChange={handleDeviceChange}
                onBlur={handleDeviceBlur}
                disabled={!savedIncubadoraId || isAddingDevice}
                aria-invalid={Boolean(deviceErrors.tipo)}
                aria-describedby={
                  deviceErrors.tipo ? "dispositivo-tipo-error" : undefined
                }
              >
                <option value="">Selecciona un tipo</option>
                {TIPOS_DISPOSITIVO.map((tipo) => (
                  <option key={tipo.value} value={tipo.value}>
                    {tipo.label}
                  </option>
                ))}
              </select>
              {deviceErrors.tipo && (
                <p
                  id="dispositivo-tipo-error"
                  className="incubadora-form__error"
                  role="alert"
                >
                  {deviceErrors.tipo}
                </p>
              )}
            </div>

            <button
              className="incubadora-form__button incubadora-form__button--secondary"
              type="button"
              onClick={handleAddDevice}
              disabled={!savedIncubadoraId || isAddingDevice}
            >
              {isAddingDevice ? "Registrando..." : "Agregar dispositivo"}
            </button>
          </div>

          {!savedIncubadoraId && (
            <p className="incubadora-form__hint">
              Guarda la incubadora antes de registrar un dispositivo.
            </p>
          )}

          {deviceMessage && (
            <p
              className={`incubadora-form__message ${
                deviceMessage.includes("correctamente")
                  ? "incubadora-form__message--success"
                  : "incubadora-form__message--error"
              }`}
              role="status"
            >
              {deviceMessage}
            </p>
          )}
        </fieldset>

        {submitError && (
          <p className="incubadora-form__submit-error" role="alert">
            {submitError}
          </p>
        )}

        <div className="incubadora-form__actions">
          {onCancel && (
            <button
              className="incubadora-form__button incubadora-form__button--ghost"
              type="button"
              onClick={onCancel}
              disabled={isSaving}
            >
              Cancelar
            </button>
          )}

          <button
            className="incubadora-form__button incubadora-form__button--primary"
            type="submit"
            disabled={isSaving}
          >
            {isSaving
              ? "Guardando..."
              : isEditing
                ? "Guardar cambios"
                : "Crear incubadora"}
          </button>
        </div>
      </form>
    </section>
  );
}
