// =========================================================
// M.T.P.A. - UTILIDADES DE FECHA Y HORA
// Mejora Técnica de Producción Avícola
// =========================================================

import {
  SYSTEM_INTERVALS,
} from "./constants";


// =========================================================
// CONFIGURACIÓN
// =========================================================

const DEFAULT_LOCALE = "es-CO";


// =========================================================
// CONVERTIR A DATE
// =========================================================

/**
 * Convierte diferentes tipos de valores de fecha
 * a un objeto Date de JavaScript.
 *
 * Soporta:
 * - Date
 * - string ISO
 * - number (timestamp)
 * - Firebase Timestamp
 *
 * @param {*} value
 * @returns {Date|null}
 */
export const toDate = (value) => {
  if (!value) {
    return null;
  }

  // Ya es un objeto Date
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value;
  }

  // Firebase Timestamp
  if (
    typeof value === "object" &&
    typeof value.toDate === "function"
  ) {
    const date = value.toDate();

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  // Timestamp de Firestore serializado
  if (
    typeof value === "object" &&
    typeof value.seconds === "number"
  ) {
    const milliseconds =
      value.seconds * 1000 +
      Math.floor(
        (value.nanoseconds || 0) / 1000000
      );

    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime())
      ? null
      : date;
  }

  // String o timestamp numérico
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
};


// =========================================================
// VALIDAR FECHA
// =========================================================

/**
 * Comprueba si un valor representa una fecha válida.
 *
 * @param {*} value
 * @returns {boolean}
 */
export const isValidDate = (value) => {
  return toDate(value) !== null;
};


// =========================================================
// FORMATEAR FECHA
// =========================================================

/**
 * Convierte una fecha al formato:
 *
 * 08/09/2026
 *
 * @param {*} value
 * @param {string} locale
 * @returns {string}
 */
export const formatDate = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }
  ).format(date);
};


// =========================================================
// FORMATEAR HORA
// =========================================================

/**
 * Convierte una fecha al formato:
 *
 * 09:35
 *
 * @param {*} value
 * @param {string} locale
 * @returns {string}
 */
export const formatTime = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(date);
};


// =========================================================
// FORMATEAR HORA CON SEGUNDOS
// =========================================================

/**
 * Ejemplo:
 *
 * 09:35:18
 */
export const formatTimeWithSeconds = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }
  ).format(date);
};


// =========================================================
// FORMATEAR FECHA Y HORA
// =========================================================

/**
 * Ejemplo:
 *
 * 08/09/2026 09:35
 */
export const formatDateTime = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return `${formatDate(date, locale)} ${formatTime(
    date,
    locale
  )}`;
};


// =========================================================
// FECHA Y HORA LARGA
// =========================================================

/**
 * Ejemplo:
 *
 * 8 de septiembre de 2026, 09:35
 */
export const formatLongDateTime = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }
  ).format(date);
};


// =========================================================
// FECHA LARGA
// =========================================================

/**
 * Ejemplo:
 *
 * 8 de septiembre de 2026
 */
export const formatLongDate = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      day: "numeric",
      month: "long",
      year: "numeric",
    }
  ).format(date);
};


// =========================================================
// TIEMPO TRANSCURRIDO EN MILISEGUNDOS
// =========================================================

export const getElapsedMilliseconds = (
  value,
  referenceDate = new Date()
) => {
  const date = toDate(value);
  const reference = toDate(referenceDate);

  if (!date || !reference) {
    return null;
  }

  return reference.getTime() - date.getTime();
};


// =========================================================
// TIEMPO TRANSCURRIDO EN SEGUNDOS
// =========================================================

export const getElapsedSeconds = (
  value,
  referenceDate = new Date()
) => {
  const milliseconds =
    getElapsedMilliseconds(
      value,
      referenceDate
    );

  if (milliseconds === null) {
    return null;
  }

  return Math.floor(milliseconds / 1000);
};


// =========================================================
// TIEMPO TRANSCURRIDO EN MINUTOS
// =========================================================

export const getElapsedMinutes = (
  value,
  referenceDate = new Date()
) => {
  const seconds =
    getElapsedSeconds(
      value,
      referenceDate
    );

  if (seconds === null) {
    return null;
  }

  return Math.floor(seconds / 60);
};


// =========================================================
// TIEMPO TRANSCURRIDO EN HORAS
// =========================================================

export const getElapsedHours = (
  value,
  referenceDate = new Date()
) => {
  const minutes =
    getElapsedMinutes(
      value,
      referenceDate
    );

  if (minutes === null) {
    return null;
  }

  return Math.floor(minutes / 60);
};


// =========================================================
// TIEMPO TRANSCURRIDO EN DÍAS
// =========================================================

export const getElapsedDays = (
  value,
  referenceDate = new Date()
) => {
  const hours =
    getElapsedHours(
      value,
      referenceDate
    );

  if (hours === null) {
    return null;
  }

  return Math.floor(hours / 24);
};


// =========================================================
// TIEMPO RELATIVO
// =========================================================

/**
 * Devuelve textos como:
 *
 * Ahora
 * Hace 15 segundos
 * Hace 4 minutos
 * Hace 2 horas
 * Hace 3 días
 */
export const timeAgo = (
  value,
  referenceDate = new Date()
) => {
  const seconds =
    getElapsedSeconds(
      value,
      referenceDate
    );

  if (seconds === null) {
    return "-";
  }

  // Fecha futura
  if (seconds < 0) {
    return "Ahora";
  }

  if (seconds < 5) {
    return "Ahora";
  }

  if (seconds < 60) {
    return `Hace ${seconds} ${
      seconds === 1
        ? "segundo"
        : "segundos"
    }`;
  }

  const minutes = Math.floor(
    seconds / 60
  );

  if (minutes < 60) {
    return `Hace ${minutes} ${
      minutes === 1
        ? "minuto"
        : "minutos"
    }`;
  }

  const hours = Math.floor(
    minutes / 60
  );

  if (hours < 24) {
    return `Hace ${hours} ${
      hours === 1
        ? "hora"
        : "horas"
    }`;
  }

  const days = Math.floor(
    hours / 24
  );

  if (days < 30) {
    return `Hace ${days} ${
      days === 1
        ? "día"
        : "días"
    }`;
  }

  return formatDate(value);
};


// =========================================================
// COMPROBAR SI ES HOY
// =========================================================

export const isToday = (value) => {
  const date = toDate(value);

  if (!date) {
    return false;
  }

  const today = new Date();

  return (
    date.getFullYear() ===
      today.getFullYear() &&
    date.getMonth() ===
      today.getMonth() &&
    date.getDate() ===
      today.getDate()
  );
};


// =========================================================
// INICIO DEL DÍA
// =========================================================

export const startOfDay = (value = new Date()) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  const result = new Date(date);

  result.setHours(
    0,
    0,
    0,
    0
  );

  return result;
};


// =========================================================
// FINAL DEL DÍA
// =========================================================

export const endOfDay = (value = new Date()) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  const result = new Date(date);

  result.setHours(
    23,
    59,
    59,
    999
  );

  return result;
};


// =========================================================
// RESTAR DÍAS
// =========================================================

export const subtractDays = (
  value,
  days
) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  const result = new Date(date);

  result.setDate(
    result.getDate() - days
  );

  return result;
};


// =========================================================
// SUMAR DÍAS
// =========================================================

export const addDays = (
  value,
  days
) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  const result = new Date(date);

  result.setDate(
    result.getDate() + days
  );

  return result;
};


// =========================================================
// RANGO DE HOY
// =========================================================

export const getTodayRange = () => {
  const today = new Date();

  return {
    start: startOfDay(today),
    end: endOfDay(today),
  };
};


// =========================================================
// RANGO ÚLTIMAS 24 HORAS
// =========================================================

export const getLast24HoursRange = () => {
  const end = new Date();

  const start = new Date(
    end.getTime() -
    24 * 60 * 60 * 1000
  );

  return {
    start,
    end,
  };
};


// =========================================================
// RANGO ÚLTIMOS 7 DÍAS
// =========================================================

export const getLast7DaysRange = () => {
  const end = new Date();

  const start = subtractDays(
    end,
    7
  );

  return {
    start,
    end,
  };
};


// =========================================================
// RANGO ÚLTIMOS 30 DÍAS
// =========================================================

export const getLast30DaysRange = () => {
  const end = new Date();

  const start = subtractDays(
    end,
    30
  );

  return {
    start,
    end,
  };
};


// =========================================================
// OBTENER RANGO SEGÚN PERÍODO
// =========================================================

/**
 * Convierte los períodos definidos en constants.js
 * en rangos Date utilizables por repositories.
 */
export const getDateRangeByPeriod = (
  period
) => {
  switch (period) {

    case "hoy":
      return getTodayRange();

    case "24h":
      return getLast24HoursRange();

    case "7d":
      return getLast7DaysRange();

    case "30d":
      return getLast30DaysRange();

    default:
      return null;
  }
};


// =========================================================
// COMPROBAR RANGO
// =========================================================

export const isDateInRange = (
  value,
  start,
  end
) => {
  const date = toDate(value);
  const startDate = toDate(start);
  const endDate = toDate(end);

  if (
    !date ||
    !startDate ||
    !endDate
  ) {
    return false;
  }

  return (
    date >= startDate &&
    date <= endDate
  );
};


// =========================================================
// DIFERENCIA ENTRE DOS FECHAS
// =========================================================

export const getDifferenceInSeconds = (
  start,
  end
) => {
  const startDate = toDate(start);
  const endDate = toDate(end);

  if (!startDate || !endDate) {
    return null;
  }

  return Math.floor(
    (
      endDate.getTime() -
      startDate.getTime()
    ) / 1000
  );
};


// =========================================================
// COMPROBAR MEDICIÓN RECIENTE
// =========================================================

/**
 * Comprueba si una medición se recibió dentro del
 * intervalo esperado del sistema.
 *
 * En M.T.P.A. el intervalo máximo esperado es
 * de 10 segundos.
 */
export const isRecentMeasurement = (
  value
) => {
  const seconds =
    getElapsedSeconds(value);

  if (
    seconds === null ||
    seconds < 0
  ) {
    return false;
  }

  return (
    seconds <=
    SYSTEM_INTERVALS
      .MEASUREMENT_MAX_SECONDS
  );
};


// =========================================================
// COMPROBAR PÉRDIDA DE COMUNICACIÓN
// =========================================================

/**
 * M.T.P.A. considera pérdida de comunicación cuando
 * han transcurrido más de 30 segundos desde el último
 * reporte del dispositivo.
 */
export const hasCommunicationTimeout = (
  lastCommunication
) => {
  const seconds =
    getElapsedSeconds(
      lastCommunication
    );

  if (seconds === null) {
    return true;
  }

  return (
    seconds >
    SYSTEM_INTERVALS
      .COMMUNICATION_TIMEOUT_SECONDS
  );
};


// =========================================================
// ESTADO DE COMUNICACIÓN
// =========================================================

/**
 * Retorna:
 *
 * connected
 * delayed
 * disconnected
 * unknown
 */
export const getCommunicationStatus = (
  lastCommunication
) => {
  const seconds =
    getElapsedSeconds(
      lastCommunication
    );

  if (
    seconds === null ||
    seconds < 0
  ) {
    return "unknown";
  }

  if (
    seconds <=
    SYSTEM_INTERVALS
      .MEASUREMENT_MAX_SECONDS
  ) {
    return "connected";
  }

  if (
    seconds <=
    SYSTEM_INTERVALS
      .COMMUNICATION_TIMEOUT_SECONDS
  ) {
    return "delayed";
  }

  return "disconnected";
};


// =========================================================
// FECHA PARA INPUT TYPE="DATE"
// =========================================================

/**
 * Convierte una fecha a:
 *
 * 2026-09-08
 *
 * Útil para:
 *
 * <input type="date" />
 */
export const toInputDate = (value) => {
  const date = toDate(value);

  if (!date) {
    return "";
  }

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  return `${year}-${month}-${day}`;
};


// =========================================================
// FECHA/HORA PARA DATETIME-LOCAL
// =========================================================

/**
 * Convierte una fecha a:
 *
 * 2026-09-08T09:35
 *
 * Útil para:
 *
 * <input type="datetime-local" />
 */
export const toDateTimeLocal = (
  value
) => {
  const date = toDate(value);

  if (!date) {
    return "";
  }

  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(
      2,
      "0"
    );

  const day =
    String(
      date.getDate()
    ).padStart(
      2,
      "0"
    );

  const hours =
    String(
      date.getHours()
    ).padStart(
      2,
      "0"
    );

  const minutes =
    String(
      date.getMinutes()
    ).padStart(
      2,
      "0"
    );

  return (
    `${year}-${month}-${day}` +
    `T${hours}:${minutes}`
  );
};


// =========================================================
// TIMESTAMP ISO
// =========================================================

/**
 * Convierte una fecha a ISO.
 *
 * Ejemplo:
 *
 * 2026-09-08T14:35:00.000Z
 */
export const toISOString = (value) => {
  const date = toDate(value);

  if (!date) {
    return null;
  }

  return date.toISOString();
};


// =========================================================
// NOMBRE DEL DÍA
// =========================================================

/**
 * Ejemplo:
 *
 * lunes
 * martes
 * miércoles
 */
export const getDayName = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      weekday: "long",
    }
  ).format(date);
};


// =========================================================
// NOMBRE DEL MES
// =========================================================

/**
 * Ejemplo:
 *
 * enero
 * febrero
 * septiembre
 */
export const getMonthName = (
  value,
  locale = DEFAULT_LOCALE
) => {
  const date = toDate(value);

  if (!date) {
    return "-";
  }

  return new Intl.DateTimeFormat(
    locale,
    {
      month: "long",
    }
  ).format(date);
};


// =========================================================
// ORDENAR POR FECHA
// =========================================================

/**
 * Ordena un arreglo de objetos por un campo de fecha.
 *
 * Por defecto:
 * más reciente → más antiguo.
 *
 * No modifica el arreglo original.
 */
export const sortByDate = (
  items = [],
  field = "creadoEn",
  direction = "desc"
) => {
  return [...items].sort(
    (a, b) => {
      const dateA =
        toDate(a?.[field]);

      const dateB =
        toDate(b?.[field]);

      if (!dateA && !dateB) {
        return 0;
      }

      if (!dateA) {
        return 1;
      }

      if (!dateB) {
        return -1;
      }

      const difference =
        dateA.getTime() -
        dateB.getTime();

      return direction === "asc"
        ? difference
        : -difference;
    }
  );
};