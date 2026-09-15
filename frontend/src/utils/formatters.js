// =========================================================
// M.T.P.A. - FORMATEADORES
// Mejora Técnica de Producción Avícola
// =========================================================

import {
  ROLES,
  ROLE_LABELS,
  STATUS,
  INCUBATOR_STATUS,
  DEVICE_STATUS,
  FAN_STATUS,
  FAN_CONTROL_MODE,
  FAN_CONTROL_MODE_LABELS,
  ALERT_SEVERITY,
  ALERT_SEVERITY_LABELS,
  ALERT_STATUS,
  UNITS,
} from "./constants";


// =========================================================
// VALOR VACÍO
// =========================================================

/**
 * Comprueba si un valor debe considerarse vacío.
 *
 * 0 y false NO se consideran vacíos.
 */
export const isEmptyValue = (value) => {
  return (
    value === null ||
    value === undefined ||
    value === ""
  );
};


// =========================================================
// VALOR SEGURO
// =========================================================

/**
 * Devuelve un valor alternativo cuando el dato
 * recibido está vacío.
 */
export const safeValue = (
  value,
  fallback = "-"
) => {
  return isEmptyValue(value)
    ? fallback
    : value;
};


// =========================================================
// FORMATEAR NÚMERO
// =========================================================

/**
 * Formatea un número usando configuración regional.
 *
 * Ejemplo:
 *
 * formatNumber(37.567, 1)
 * -> "37,6"
 */
export const formatNumber = (
  value,
  decimals = 1,
  locale = "es-CO"
) => {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "-";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "-";
  }

  return new Intl.NumberFormat(
    locale,
    {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }
  ).format(number);
};


// =========================================================
// TEMPERATURA
// =========================================================

/**
 * Ejemplo:
 *
 * 37.5 -> "37,5 °C"
 */
export const formatTemperature = (
  value,
  decimals = 1
) => {
  const formatted =
    formatNumber(value, decimals);

  if (formatted === "-") {
    return "-";
  }

  return `${formatted} ${UNITS.TEMPERATURE}`;
};


// =========================================================
// HUMEDAD
// =========================================================

/**
 * Ejemplo:
 *
 * 55.2 -> "55,2 %"
 */
export const formatHumidity = (
  value,
  decimals = 1
) => {
  const formatted =
    formatNumber(value, decimals);

  if (formatted === "-") {
    return "-";
  }

  return `${formatted} ${UNITS.HUMIDITY}`;
};


// =========================================================
// PORCENTAJE
// =========================================================

/**
 * El valor recibido debe estar en escala 0 - 100.
 *
 * Ejemplo:
 *
 * 80 -> "80 %"
 */
export const formatPercentage = (
  value,
  decimals = 0
) => {
  const formatted =
    formatNumber(value, decimals);

  if (formatted === "-") {
    return "-";
  }

  return `${formatted} %`;
};


// =========================================================
// VELOCIDAD DEL VENTILADOR
// =========================================================

/**
 * Ejemplo:
 *
 * 80 -> "80 %"
 */
export const formatFanSpeed = (
  value
) => {
  return formatPercentage(
    value,
    0
  );
};


// =========================================================
// BOOLEANOS
// =========================================================

/**
 * true  -> "Sí"
 * false -> "No"
 */
export const formatBoolean = (
  value
) => {
  if (
    value === null ||
    value === undefined
  ) {
    return "-";
  }

  return value
    ? "Sí"
    : "No";
};


// =========================================================
// CAPITALIZAR
// =========================================================

/**
 * Ejemplo:
 *
 * "administrador"
 * -> "Administrador"
 */
export const capitalize = (
  value
) => {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return "";
  }

  const text = value.trim();

  return (
    text.charAt(0).toUpperCase() +
    text.slice(1)
  );
};


// =========================================================
// CAPITALIZAR PALABRAS
// =========================================================

/**
 * Ejemplo:
 *
 * "incubadora principal"
 * -> "Incubadora Principal"
 */
export const capitalizeWords = (
  value
) => {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(capitalize)
    .join(" ");
};


// =========================================================
// NORMALIZAR TEXTO
// =========================================================

/**
 * Elimina espacios innecesarios.
 *
 * Ejemplo:
 *
 * "  Incubadora   Principal "
 * -> "Incubadora Principal"
 */
export const normalizeText = (
  value
) => {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
};


// =========================================================
// TRUNCAR TEXTO
// =========================================================

/**
 * Ejemplo:
 *
 * truncateText("Texto muy largo...", 10)
 */
export const truncateText = (
  value,
  maxLength = 50
) => {
  if (
    typeof value !== "string"
  ) {
    return "";
  }

  const text = value.trim();

  if (
    text.length <= maxLength
  ) {
    return text;
  }

  return `${text.slice(
    0,
    maxLength
  ).trim()}...`;
};


// =========================================================
// FORMATEAR ROL
// =========================================================

/**
 * Convierte el identificador interno del rol
 * en su nombre visible.
 */
export const formatRole = (
  role
) => {
  return (
    ROLE_LABELS[role] ||
    capitalize(role) ||
    "-"
  );
};


// =========================================================
// ESTADO GENERAL
// =========================================================

export const formatStatus = (
  status
) => {
  const labels = {
    [STATUS.ACTIVE]:
      "Activo",

    [STATUS.INACTIVE]:
      "Inactivo",

    [STATUS.NORMAL]:
      "Normal",

    [STATUS.WARNING]:
      "Advertencia",

    [STATUS.CRITICAL]:
      "Crítico",

    [STATUS.CONNECTED]:
      "Conectado",

    [STATUS.DISCONNECTED]:
      "Desconectado",

    [STATUS.UNKNOWN]:
      "Desconocido",
  };

  return (
    labels[status] ||
    capitalize(status) ||
    "-"
  );
};


// =========================================================
// ESTADO DE INCUBADORA
// =========================================================

export const formatIncubatorStatus = (
  status
) => {
  const labels = {
    [INCUBATOR_STATUS.ACTIVE]:
      "Activa",

    [INCUBATOR_STATUS.INACTIVE]:
      "Inactiva",

    [INCUBATOR_STATUS.WARNING]:
      "Advertencia",

    [INCUBATOR_STATUS.CRITICAL]:
      "Crítica",

    [INCUBATOR_STATUS.MAINTENANCE]:
      "Mantenimiento",
  };

  return (
    labels[status] ||
    capitalize(status) ||
    "-"
  );
};


// =========================================================
// ESTADO DE DISPOSITIVO
// =========================================================

export const formatDeviceStatus = (
  status
) => {
  const labels = {
    [DEVICE_STATUS.CONNECTED]:
      "Conectado",

    [DEVICE_STATUS.DISCONNECTED]:
      "Desconectado",

    [DEVICE_STATUS.WARNING]:
      "Advertencia",

    [DEVICE_STATUS.UNKNOWN]:
      "Desconocido",
  };

  return (
    labels[status] ||
    capitalize(status) ||
    "-"
  );
};


// =========================================================
// ESTADO DEL VENTILADOR
// =========================================================

export const formatFanStatus = (
  status
) => {
  const labels = {
    [FAN_STATUS.ON]:
      "Encendido",

    [FAN_STATUS.OFF]:
      "Apagado",
  };

  return (
    labels[status] ||
    capitalize(status) ||
    "-"
  );
};


// =========================================================
// MODO DEL VENTILADOR
// =========================================================

export const formatFanControlMode = (
  mode
) => {
  return (
    FAN_CONTROL_MODE_LABELS[mode] ||
    capitalize(mode) ||
    "-"
  );
};


// =========================================================
// SEVERIDAD DE ALERTA
// =========================================================

export const formatAlertSeverity = (
  severity
) => {
  return (
    ALERT_SEVERITY_LABELS[severity] ||
    capitalize(severity) ||
    "-"
  );
};


// =========================================================
// ESTADO DE ALERTA
// =========================================================

export const formatAlertStatus = (
  status
) => {
  const labels = {
    [ALERT_STATUS.ACTIVE]:
      "Activa",

    [ALERT_STATUS.ACKNOWLEDGED]:
      "Reconocida",

    [ALERT_STATUS.RESOLVED]:
      "Resuelta",
  };

  return (
    labels[status] ||
    capitalize(status) ||
    "-"
  );
};


// =========================================================
// TIPO DE ALERTA
// =========================================================

export const formatAlertType = (
  type
) => {
  const labels = {
    temperatura_alta:
      "Temperatura alta",

    temperatura_baja:
      "Temperatura baja",

    humedad_alta:
      "Humedad alta",

    humedad_baja:
      "Humedad baja",

    dispositivo_desconectado:
      "Dispositivo desconectado",

    perdida_comunicacion:
      "Pérdida de comunicación",

    sistema:
      "Sistema",
  };

  return (
    labels[type] ||
    capitalize(
      String(type || "")
        .replaceAll("_", " ")
    ) ||
    "-"
  );
};


// =========================================================
// TIPO DE DISPOSITIVO
// =========================================================

export const formatDeviceType = (
  type
) => {
  const labels = {
    sensor_temperatura:
      "Sensor de temperatura",

    sensor_humedad:
      "Sensor de humedad",

    sensor_temperatura_humedad:
      "Sensor de temperatura y humedad",

    ventilador:
      "Ventilador",

    controlador:
      "Controlador",
  };

  return (
    labels[type] ||
    capitalize(
      String(type || "")
        .replaceAll("_", " ")
    ) ||
    "-"
  );
};


// =========================================================
// FORMATEAR NOMBRE COMPLETO
// =========================================================

export const formatFullName = (
  firstName,
  lastName
) => {
  const fullName = [
    firstName,
    lastName,
  ]
    .filter(Boolean)
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");

  return fullName || "-";
};


// =========================================================
// INICIALES DEL USUARIO
// =========================================================

/**
 * Ejemplo:
 *
 * "Carlos Pérez"
 * -> "CP"
 *
 * Útil para Avatar.
 */
export const getInitials = (
  name
) => {
  if (
    typeof name !== "string" ||
    !name.trim()
  ) {
    return "?";
  }

  const words = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 1) {
    return words[0]
      .charAt(0)
      .toUpperCase();
  }

  return (
    words[0].charAt(0) +
    words[words.length - 1].charAt(0)
  ).toUpperCase();
};


// =========================================================
// EMAIL
// =========================================================

export const formatEmail = (
  email
) => {
  if (
    typeof email !== "string"
  ) {
    return "-";
  }

  const result =
    email.trim().toLowerCase();

  return result || "-";
};


// =========================================================
// FORMATEAR ID CORTO
// =========================================================

/**
 * Útil para mostrar IDs de Firestore.
 *
 * Ejemplo:
 *
 * "gYh81mx93Nabc..."
 * -> "gYh81mx9..."
 */
export const formatShortId = (
  id,
  length = 8
) => {
  if (!id) {
    return "-";
  }

  const value = String(id);

  if (
    value.length <= length
  ) {
    return value;
  }

  return `${value.slice(
    0,
    length
  )}...`;
};


// =========================================================
// FORMATEAR NOMBRE DE INCUBADORA
// =========================================================

export const formatIncubatorName = (
  incubator
) => {
  if (!incubator) {
    return "-";
  }

  if (
    typeof incubator === "string"
  ) {
    return normalizeText(
      incubator
    );
  }

  return (
    normalizeText(
      incubator.nombre
    ) ||
    "Incubadora"
  );
};


// =========================================================
// FORMATEAR MEDICIÓN
// =========================================================

/**
 * Permite formatear una medición según su tipo.
 *
 * Ejemplo:
 *
 * formatMeasurement(
 *   "temperatura",
 *   37.5
 * );
 */
export const formatMeasurement = (
  type,
  value
) => {
  switch (type) {

    case "temperatura":
      return formatTemperature(
        value
      );

    case "humedad":
      return formatHumidity(
        value
      );

    default:
      return safeValue(
        value
      );
  }
};


// =========================================================
// OBTENER CLASE CSS SEGÚN ESTADO
// =========================================================

/**
 * Devuelve una clase lógica que puede utilizarse
 * con los estilos definidos en global.css.
 */
export const getStatusClass = (
  status
) => {
  const classes = {
    [STATUS.ACTIVE]:
      "status--success",

    [STATUS.NORMAL]:
      "status--success",

    [STATUS.CONNECTED]:
      "status--success",

    [STATUS.WARNING]:
      "status--warning",

    [STATUS.CRITICAL]:
      "status--danger",

    [STATUS.DISCONNECTED]:
      "status--danger",

    [STATUS.INACTIVE]:
      "status--muted",

    [STATUS.UNKNOWN]:
      "status--muted",
  };

  return (
    classes[status] ||
    "status--muted"
  );
};


// =========================================================
// CLASE PARA ESTADO DE INCUBADORA
// =========================================================

export const getIncubatorStatusClass = (
  status
) => {
  const classes = {
    [INCUBATOR_STATUS.ACTIVE]:
      "status--success",

    [INCUBATOR_STATUS.INACTIVE]:
      "status--muted",

    [INCUBATOR_STATUS.WARNING]:
      "status--warning",

    [INCUBATOR_STATUS.CRITICAL]:
      "status--danger",

    [INCUBATOR_STATUS.MAINTENANCE]:
      "status--info",
  };

  return (
    classes[status] ||
    "status--muted"
  );
};


// =========================================================
// CLASE PARA DISPOSITIVO
// =========================================================

export const getDeviceStatusClass = (
  status
) => {
  const classes = {
    [DEVICE_STATUS.CONNECTED]:
      "device-status--connected",

    [DEVICE_STATUS.DISCONNECTED]:
      "device-status--disconnected",

    [DEVICE_STATUS.WARNING]:
      "device-status--warning",

    [DEVICE_STATUS.UNKNOWN]:
      "device-status--unknown",
  };

  return (
    classes[status] ||
    "device-status--unknown"
  );
};


// =========================================================
// CLASE PARA ALERTA
// =========================================================

export const getAlertSeverityClass = (
  severity
) => {
  const classes = {
    [ALERT_SEVERITY.INFO]:
      "message--info",

    [ALERT_SEVERITY.WARNING]:
      "message--warning",

    [ALERT_SEVERITY.CRITICAL]:
      "message--danger",
  };

  return (
    classes[severity] ||
    "message--info"
  );
};


// =========================================================
// CLASE PARA ESTADO GENERAL DEL SISTEMA
// =========================================================

export const getSystemStateClass = (
  status
) => {
  const classes = {
    [STATUS.NORMAL]:
      "system-state--normal",

    [STATUS.WARNING]:
      "system-state--warning",

    [STATUS.CRITICAL]:
      "system-state--critical",
  };

  return (
    classes[status] ||
    "system-state--warning"
  );
};


// =========================================================
// LIMITAR VALOR A UN RANGO
// =========================================================

/**
 * Evita que un valor numérico salga de un rango.
 *
 * Ejemplo:
 *
 * clamp(120, 0, 100)
 * -> 100
 */
export const clamp = (
  value,
  min,
  max
) => {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    Math.max(number, min),
    max
  );
};


// =========================================================
// NORMALIZAR PORCENTAJE
// =========================================================

/**
 * Garantiza un valor entre 0 y 100.
 *
 * Especialmente útil para la velocidad
 * de los ventiladores.
 */
export const normalizePercentage = (
  value
) => {
  return clamp(
    value,
    0,
    100
  );
};


// =========================================================
// FORMATEAR TAMAÑO DE ARCHIVO
// =========================================================

/**
 * Útil para futuras exportaciones CSV/PDF.
 *
 * Ejemplo:
 *
 * 1536 -> "1,5 KB"
 */
export const formatFileSize = (
  bytes
) => {
  const value = Number(bytes);

  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    return "-";
  }

  if (value === 0) {
    return "0 B";
  }

  const units = [
    "B",
    "KB",
    "MB",
    "GB",
  ];

  const index = Math.min(
    Math.floor(
      Math.log(value) /
      Math.log(1024)
    ),
    units.length - 1
  );

  const size =
    value /
    Math.pow(
      1024,
      index
    );

  return `${
    formatNumber(
      size,
      index === 0 ? 0 : 1
    )
  } ${units[index]}`;
};


// =========================================================
// FORMATEAR CANTIDAD
// =========================================================

/**
 * Formatea contadores.
 *
 * Ejemplo:
 *
 * 1250 -> "1.250"
 */
export const formatCount = (
  value,
  locale = "es-CO"
) => {
  const number =
    Number(value);

  if (
    !Number.isFinite(number)
  ) {
    return "0";
  }

  return new Intl.NumberFormat(
    locale,
    {
      maximumFractionDigits: 0,
    }
  ).format(number);
};


// =========================================================
// PLURALIZACIÓN SIMPLE
// =========================================================

/**
 * Ejemplo:
 *
 * pluralize(1, "alerta", "alertas")
 * -> "1 alerta"
 *
 * pluralize(5, "alerta", "alertas")
 * -> "5 alertas"
 */
export const pluralize = (
  quantity,
  singular,
  plural
) => {
  const number =
    Number(quantity) || 0;

  const word =
    number === 1
      ? singular
      : plural;

  return `${formatCount(
    number
  )} ${word}`;
};


// =========================================================
// RESUMEN DE ALERTAS
// =========================================================

export const formatAlertCount = (
  quantity
) => {
  return pluralize(
    quantity,
    "alerta",
    "alertas"
  );
};


// =========================================================
// RESUMEN DE INCUBADORAS
// =========================================================

export const formatIncubatorCount = (
  quantity
) => {
  return pluralize(
    quantity,
    "incubadora",
    "incubadoras"
  );
};


// =========================================================
// RESUMEN DE DISPOSITIVOS
// =========================================================

export const formatDeviceCount = (
  quantity
) => {
  return pluralize(
    quantity,
    "dispositivo",
    "dispositivos"
  );
};