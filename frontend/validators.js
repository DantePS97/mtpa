// =========================================================
// M.T.P.A. - VALIDADORES
// Mejora Técnica de Producción Avícola
// =========================================================

import {
  ROLES,
  FAN_CONTROL_MODE,
  FAN_SPEED,
  VALIDATION,
} from "./constants";


// =========================================================
// VALIDAR VALOR VACÍO
// =========================================================

/**
 * Determina si un valor está vacío.
 *
 * 0 y false son considerados valores válidos.
 */
export const isEmpty = (value) => {
  return (
    value === null ||
    value === undefined ||
    (
      typeof value === "string" &&
      value.trim() === ""
    )
  );
};


// =========================================================
// CAMPO REQUERIDO
// =========================================================

/**
 * Valida que un campo tenga contenido.
 *
 * @returns {string}
 * Retorna "" cuando es válido.
 */
export const validateRequired = (
  value,
  fieldName = "Este campo"
) => {
  if (isEmpty(value)) {
    return `${fieldName} es obligatorio.`;
  }

  return "";
};


// =========================================================
// CORREO ELECTRÓNICO
// =========================================================

/**
 * Valida un correo electrónico.
 */
export const isValidEmail = (email) => {
  if (
    typeof email !== "string"
  ) {
    return false;
  }

  const value = email.trim();

  const regex =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return regex.test(value);
};


/**
 * Retorna el mensaje de error correspondiente.
 */
export const validateEmail = (
  email
) => {
  if (isEmpty(email)) {
    return "El correo electrónico es obligatorio.";
  }

  if (!isValidEmail(email)) {
    return "Ingresa un correo electrónico válido.";
  }

  return "";
};


// =========================================================
// CONTRASEÑA
// =========================================================

/**
 * Valida la longitud mínima de la contraseña.
 *
 * La longitud se toma desde constants.js.
 */
export const validatePassword = (
  password
) => {
  if (isEmpty(password)) {
    return "La contraseña es obligatoria.";
  }

  if (
    password.length <
    VALIDATION.PASSWORD_MIN_LENGTH
  ) {
    return (
      `La contraseña debe tener al menos ` +
      `${VALIDATION.PASSWORD_MIN_LENGTH} caracteres.`
    );
  }

  return "";
};


// =========================================================
// CONTRASEÑA SEGURA
// =========================================================

/**
 * Validación opcional más estricta.
 *
 * Requiere:
 * - longitud mínima
 * - una mayúscula
 * - una minúscula
 * - un número
 */
export const validateStrongPassword = (
  password
) => {
  const basicError =
    validatePassword(password);

  if (basicError) {
    return basicError;
  }

  if (!/[A-Z]/.test(password)) {
    return "La contraseña debe incluir una letra mayúscula.";
  }

  if (!/[a-z]/.test(password)) {
    return "La contraseña debe incluir una letra minúscula.";
  }

  if (!/[0-9]/.test(password)) {
    return "La contraseña debe incluir al menos un número.";
  }

  return "";
};


// =========================================================
// CONFIRMAR CONTRASEÑA
// =========================================================

export const validatePasswordConfirmation = (
  password,
  confirmation
) => {
  if (isEmpty(confirmation)) {
    return "Debes confirmar la contraseña.";
  }

  if (password !== confirmation) {
    return "Las contraseñas no coinciden.";
  }

  return "";
};


// =========================================================
// LONGITUD MÍNIMA
// =========================================================

export const validateMinLength = (
  value,
  min,
  fieldName = "El campo"
) => {
  if (isEmpty(value)) {
    return "";
  }

  if (
    String(value).trim().length < min
  ) {
    return (
      `${fieldName} debe tener al menos ` +
      `${min} caracteres.`
    );
  }

  return "";
};


// =========================================================
// LONGITUD MÁXIMA
// =========================================================

export const validateMaxLength = (
  value,
  max,
  fieldName = "El campo"
) => {
  if (isEmpty(value)) {
    return "";
  }

  if (
    String(value).trim().length > max
  ) {
    return (
      `${fieldName} no puede superar ` +
      `${max} caracteres.`
    );
  }

  return "";
};


// =========================================================
// NOMBRE
// =========================================================

export const validateName = (
  name,
  fieldName = "El nombre"
) => {
  const requiredError =
    validateRequired(
      name,
      fieldName
    );

  if (requiredError) {
    return requiredError;
  }

  const minError =
    validateMinLength(
      name,
      VALIDATION.NAME_MIN_LENGTH,
      fieldName
    );

  if (minError) {
    return minError;
  }

  const maxError =
    validateMaxLength(
      name,
      VALIDATION.NAME_MAX_LENGTH,
      fieldName
    );

  if (maxError) {
    return maxError;
  }

  return "";
};


// =========================================================
// DESCRIPCIÓN
// =========================================================

export const validateDescription = (
  description
) => {
  if (isEmpty(description)) {
    return "";
  }

  return validateMaxLength(
    description,
    VALIDATION.DESCRIPTION_MAX_LENGTH,
    "La descripción"
  );
};


// =========================================================
// NÚMERO
// =========================================================

export const isValidNumber = (
  value
) => {
  if (isEmpty(value)) {
    return false;
  }

  return Number.isFinite(
    Number(value)
  );
};


// =========================================================
// VALIDAR NÚMERO
// =========================================================

export const validateNumber = (
  value,
  fieldName = "El valor"
) => {
  if (isEmpty(value)) {
    return `${fieldName} es obligatorio.`;
  }

  if (!isValidNumber(value)) {
    return `${fieldName} debe ser un número válido.`;
  }

  return "";
};


// =========================================================
// RANGO NUMÉRICO
// =========================================================

export const validateNumberRange = (
  value,
  min,
  max,
  fieldName = "El valor"
) => {
  const numberError =
    validateNumber(
      value,
      fieldName
    );

  if (numberError) {
    return numberError;
  }

  const number = Number(value);

  if (number < min) {
    return (
      `${fieldName} no puede ser menor que ${min}.`
    );
  }

  if (number > max) {
    return (
      `${fieldName} no puede ser mayor que ${max}.`
    );
  }

  return "";
};


// =========================================================
// NÚMERO ENTERO
// =========================================================

export const validateInteger = (
  value,
  fieldName = "El valor"
) => {
  const numberError =
    validateNumber(
      value,
      fieldName
    );

  if (numberError) {
    return numberError;
  }

  if (
    !Number.isInteger(
      Number(value)
    )
  ) {
    return `${fieldName} debe ser un número entero.`;
  }

  return "";
};


// =========================================================
// NÚMERO POSITIVO
// =========================================================

export const validatePositiveNumber = (
  value,
  fieldName = "El valor"
) => {
  const numberError =
    validateNumber(
      value,
      fieldName
    );

  if (numberError) {
    return numberError;
  }

  if (Number(value) < 0) {
    return `${fieldName} no puede ser negativo.`;
  }

  return "";
};


// =========================================================
// ROL
// =========================================================

export const isValidRole = (
  role
) => {
  return Object.values(
    ROLES
  ).includes(role);
};


export const validateRole = (
  role
) => {
  if (isEmpty(role)) {
    return "Debes seleccionar un rol.";
  }

  if (!isValidRole(role)) {
    return "El rol seleccionado no es válido.";
  }

  return "";
};


// =========================================================
// TEMPERATURA
// =========================================================

/**
 * Comprueba únicamente que la temperatura sea
 * numéricamente válida.
 *
 * No determina si la temperatura es normal o crítica.
 * Esa decisión depende de los umbrales configurados.
 */
export const validateTemperature = (
  value
) => {
  return validateNumber(
    value,
    "La temperatura"
  );
};


// =========================================================
// HUMEDAD
// =========================================================

/**
 * La humedad relativa se expresa entre 0 y 100 %.
 */
export const validateHumidity = (
  value
) => {
  return validateNumberRange(
    value,
    0,
    100,
    "La humedad"
  );
};


// =========================================================
// VELOCIDAD DEL VENTILADOR
// =========================================================

export const validateFanSpeed = (
  value
) => {
  return validateNumberRange(
    value,
    FAN_SPEED.MIN,
    FAN_SPEED.MAX,
    "La velocidad del ventilador"
  );
};


// =========================================================
// MODO DE CONTROL DEL VENTILADOR
// =========================================================

export const isValidFanControlMode = (
  mode
) => {
  return Object.values(
    FAN_CONTROL_MODE
  ).includes(mode);
};


export const validateFanControlMode = (
  mode
) => {
  if (isEmpty(mode)) {
    return "Debes seleccionar un modo de control.";
  }

  if (
    !isValidFanControlMode(mode)
  ) {
    return "El modo de control seleccionado no es válido.";
  }

  return "";
};


// =========================================================
// UMBRAL MÍNIMO Y MÁXIMO
// =========================================================

/**
 * Comprueba que:
 *
 * - ambos valores existan
 * - ambos sean números
 * - mínimo < máximo
 */
export const validateThresholdRange = (
  min,
  max,
  fieldName = "El rango"
) => {
  if (isEmpty(min)) {
    return `${fieldName}: el valor mínimo es obligatorio.`;
  }

  if (isEmpty(max)) {
    return `${fieldName}: el valor máximo es obligatorio.`;
  }

  if (
    !isValidNumber(min) ||
    !isValidNumber(max)
  ) {
    return `${fieldName} debe contener valores numéricos válidos.`;
  }

  const minValue = Number(min);
  const maxValue = Number(max);

  if (minValue >= maxValue) {
    return (
      `${fieldName}: el valor mínimo debe ser ` +
      `menor que el valor máximo.`
    );
  }

  return "";
};


// =========================================================
// UMBRALES DE TEMPERATURA
// =========================================================

export const validateTemperatureThresholds = (
  min,
  max
) => {
  return validateThresholdRange(
    min,
    max,
    "El rango de temperatura"
  );
};


// =========================================================
// UMBRALES DE HUMEDAD
// =========================================================

export const validateHumidityThresholds = (
  min,
  max
) => {
  const rangeError =
    validateThresholdRange(
      min,
      max,
      "El rango de humedad"
    );

  if (rangeError) {
    return rangeError;
  }

  if (
    Number(min) < 0 ||
    Number(max) > 100
  ) {
    return (
      "Los límites de humedad deben estar " +
      "entre 0 % y 100 %."
    );
  }

  return "";
};


// =========================================================
// FECHA
// =========================================================

export const isValidDateValue = (
  value
) => {
  if (isEmpty(value)) {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(
    date.getTime()
  );
};


// =========================================================
// VALIDAR FECHA
// =========================================================

export const validateDate = (
  value,
  fieldName = "La fecha"
) => {
  if (isEmpty(value)) {
    return `${fieldName} es obligatoria.`;
  }

  if (!isValidDateValue(value)) {
    return `${fieldName} no es válida.`;
  }

  return "";
};


// =========================================================
// RANGO DE FECHAS
// =========================================================

export const validateDateRange = (
  start,
  end
) => {
  const startError =
    validateDate(
      start,
      "La fecha inicial"
    );

  if (startError) {
    return startError;
  }

  const endError =
    validateDate(
      end,
      "La fecha final"
    );

  if (endError) {
    return endError;
  }

  const startDate =
    new Date(start);

  const endDate =
    new Date(end);

  if (startDate > endDate) {
    return (
      "La fecha inicial no puede ser " +
      "posterior a la fecha final."
    );
  }

  return "";
};


// =========================================================
// FECHA FUTURA
// =========================================================

export const validateNotFutureDate = (
  value,
  fieldName = "La fecha"
) => {
  const dateError =
    validateDate(
      value,
      fieldName
    );

  if (dateError) {
    return dateError;
  }

  const date = new Date(value);
  const now = new Date();

  if (date > now) {
    return `${fieldName} no puede estar en el futuro.`;
  }

  return "";
};


// =========================================================
// IDENTIFICADOR
// =========================================================

export const validateId = (
  value,
  fieldName = "El identificador"
) => {
  if (isEmpty(value)) {
    return `${fieldName} es obligatorio.`;
  }

  if (
    typeof value !== "string"
  ) {
    return `${fieldName} no es válido.`;
  }

  return "";
};


// =========================================================
// IP
// =========================================================

/**
 * Valida IPv4.
 *
 * Ejemplo válido:
 * 192.168.1.25
 */
export const isValidIPv4 = (
  value
) => {
  if (
    typeof value !== "string"
  ) {
    return false;
  }

  const parts =
    value.trim().split(".");

  if (parts.length !== 4) {
    return false;
  }

  return parts.every(
    (part) => {
      if (
        !/^\d+$/.test(part)
      ) {
        return false;
      }

      const number =
        Number(part);

      return (
        number >= 0 &&
        number <= 255
      );
    }
  );
};


export const validateIPv4 = (
  value
) => {
  if (isEmpty(value)) {
    return "";
  }

  if (!isValidIPv4(value)) {
    return "La dirección IP no es válida.";
  }

  return "";
};


// =========================================================
// URL
// =========================================================

export const isValidUrl = (
  value
) => {
  if (
    typeof value !== "string" ||
    !value.trim()
  ) {
    return false;
  }

  try {
    const url =
      new URL(value.trim());

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
};


export const validateUrl = (
  value,
  required = false
) => {
  if (isEmpty(value)) {
    return required
      ? "La URL es obligatoria."
      : "";
  }

  if (!isValidUrl(value)) {
    return "Ingresa una URL válida.";
  }

  return "";
};


// =========================================================
// VALIDAR INCUBADORA
// =========================================================

/**
 * Validación general del formulario de incubadora.
 *
 * Retorna:
 *
 * {
 *   nombre: "...",
 *   descripcion: "..."
 * }
 *
 * Los campos válidos contienen "".
 */
export const validateIncubatorForm = (
  values = {}
) => {
  return {
    nombre:
      validateName(
        values.nombre,
        "El nombre"
      ),

    descripcion:
      validateDescription(
        values.descripcion
      ),
  };
};


// =========================================================
// VALIDAR USUARIO
// =========================================================

export const validateUserForm = (
  values = {},
  {
    requirePassword = true,
  } = {}
) => {
  const errors = {
    nombre:
      validateName(
        values.nombre,
        "El nombre"
      ),

    apellido:
      validateName(
        values.apellido,
        "El apellido"
      ),

    email:
      validateEmail(
        values.email
      ),

    rol:
      validateRole(
        values.rol
      ),
  };

  if (requirePassword) {
    errors.password =
      validatePassword(
        values.password
      );

    errors.confirmPassword =
      validatePasswordConfirmation(
        values.password,
        values.confirmPassword
      );
  }

  return errors;
};


// =========================================================
// VALIDAR LOGIN
// =========================================================

export const validateLoginForm = (
  values = {}
) => {
  return {
    email:
      validateEmail(
        values.email
      ),

    password:
      validateRequired(
        values.password,
        "La contraseña"
      ),
  };
};


// =========================================================
// VALIDAR CONFIGURACIÓN DE UMBRALES
// =========================================================

export const validateThresholdForm = (
  values = {}
) => {
  return {
    temperatura:
      validateTemperatureThresholds(
        values.temperaturaMin,
        values.temperaturaMax
      ),

    humedad:
      validateHumidityThresholds(
        values.humedadMin,
        values.humedadMax
      ),
  };
};


// =========================================================
// VALIDAR VENTILADOR
// =========================================================

export const validateFanForm = (
  values = {}
) => {
  return {
    modo:
      validateFanControlMode(
        values.modo
      ),

    velocidad:
      validateFanSpeed(
        values.velocidad
      ),
  };
};


// =========================================================
// COMPROBAR SI EXISTEN ERRORES
// =========================================================

/**
 * Determina si un objeto de validación contiene
 * al menos un error.
 *
 * Ejemplo:
 *
 * {
 *   nombre: "",
 *   email: "Correo inválido"
 * }
 *
 * -> true
 */
export const hasErrors = (
  errors = {}
) => {
  return Object.values(
    errors
  ).some(
    (error) => Boolean(error)
  );
};


// =========================================================
// ELIMINAR CAMPOS SIN ERROR
// =========================================================

/**
 * Convierte:
 *
 * {
 *   nombre: "",
 *   email: "Correo inválido"
 * }
 *
 * en:
 *
 * {
 *   email: "Correo inválido"
 * }
 */
export const getErrors = (
  errors = {}
) => {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(
        ([, error]) =>
          Boolean(error)
      )
  );
};


// =========================================================
// VALIDAR FORMULARIO
// =========================================================

/**
 * Ejecuta un conjunto de validadores.
 *
 * Ejemplo:
 *
 * validateForm(values, {
 *   nombre: (value) =>
 *     validateName(value),
 *
 *   email: (value) =>
 *     validateEmail(value),
 * });
 */
export const validateForm = (
  values = {},
  validators = {}
) => {
  const errors = {};

  Object.entries(
    validators
  ).forEach(
    ([field, validator]) => {
      if (
        typeof validator ===
        "function"
      ) {
        errors[field] =
          validator(
            values[field],
            values
          );
      }
    }
  );

  return errors;
};