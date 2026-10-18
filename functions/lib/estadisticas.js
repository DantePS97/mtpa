
"use strict";

// functions/lib/estadisticas.js

/**
 * Zona horaria del proyecto.
 * Puede configurarse mediante la variable PROJECT_TIME_ZONE.
 * Ejemplo: America/Bogota
 */
const ZONA_HORARIA_PROYECTO =
  process.env.PROJECT_TIME_ZONE || "America/Bogota";

/**
 * Calcula estadísticas de una lista de valores numéricos.
 *
 * Ignora valores no finitos.
 *
 * @param {Array<number>} valores
 * @returns {{
 *   cantidad: number,
 *   promedio: number,
 *   maximo: number,
 *   minimo: number,
 *   desviacion: number
 * } | null}
 */
function calcularEstadisticasDia(valores) {
  if (!Array.isArray(valores)) {
    return null;
  }

  const validos = valores.filter(
    (valor) => typeof valor === "number" && Number.isFinite(valor)
  );

  if (validos.length === 0) {
    return null;
  }

  const cantidad = validos.length;
  const suma = validos.reduce((total, valor) => total + valor, 0);
  const promedio = suma / cantidad;

  const maximo = Math.max(...validos);
  const minimo = Math.min(...validos);

  const varianza =
    validos.reduce(
      (total, valor) => total + Math.pow(valor - promedio, 2),
      0
    ) / cantidad;

  const desviacion = Math.sqrt(varianza);

  return {
    cantidad,
    promedio,
    maximo,
    minimo,
    desviacion,
  };
}

/**
 * Combina estadísticas previamente calculadas.
 *
 * Usa cantidad y promedio para obtener el promedio ponderado,
 * y la desviación estándar poblacional para combinar varianzas.
 *
 * Cada elemento debe tener:
 * cantidad, promedio, maximo, minimo y desviacion.
 *
 * @param {Array<object>} lista
 * @returns {{
 *   cantidad: number,
 *   promedio: number,
 *   maximo: number,
 *   minimo: number,
 *   desviacion: number
 * } | null}
 */
function combinarEstadisticas(lista) {
  if (!Array.isArray(lista)) {
    return null;
  }

  const validas = lista.filter((estadistica) => {
    return (
      estadistica &&
      Number.isSafeInteger(estadistica.cantidad) &&
      estadistica.cantidad > 0 &&
      Number.isFinite(estadistica.promedio) &&
      Number.isFinite(estadistica.maximo) &&
      Number.isFinite(estadistica.minimo) &&
      Number.isFinite(estadistica.desviacion) &&
      estadistica.desviacion >= 0
    );
  });

  if (validas.length === 0) {
    return null;
  }

  const cantidad = validas.reduce(
    (total, estadistica) => total + estadistica.cantidad,
    0
  );

  if (!Number.isSafeInteger(cantidad)) {
    throw new RangeError("La cantidad total excede el rango entero seguro.");
  }

  const promedio =
    validas.reduce(
      (total, estadistica) =>
        total + estadistica.cantidad * estadistica.promedio,
      0
    ) / cantidad;

  const maximo = Math.max(...validas.map((item) => item.maximo));
  const minimo = Math.min(...validas.map((item) => item.minimo));

  // Varianza combinada: incluye la variación interna de cada grupo
  // y las diferencias entre los promedios de los grupos.
  const varianza =
    validas.reduce((total, estadistica) => {
      const diferencia = estadistica.promedio - promedio;

      return (
        total +
        estadistica.cantidad *
          (Math.pow(estadistica.desviacion, 2) +
            Math.pow(diferencia, 2))
      );
    }, 0) / cantidad;

  const desviacion = Math.sqrt(Math.max(0, varianza));

  return {
    cantidad,
    promedio,
    maximo,
    minimo,
    desviacion,
  };
}

/**
 * Genera el ID determinista de una estadística diaria.
 *
 * @param {string} incubadoraId
 * @param {string} variable
 * @param {string} fecha Formato YYYY-MM-DD
 * @returns {string}
 */
function idEstadisticaDiaria(incubadoraId, variable, fecha) {
  if (
    typeof incubadoraId !== "string" ||
    !incubadoraId.trim() ||
    typeof variable !== "string" ||
    !variable.trim() ||
    typeof fecha !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(fecha)
  ) {
    throw new TypeError(
      "Se requieren incubadoraId, variable y fecha válida (YYYY-MM-DD)."
    );
  }

  return `${incubadoraId}_${variable}_${fecha}`;
}

/**
 * Convierte un instante a YYYY-MM-DD en la zona horaria del proyecto.
 *
 * Acepta un objeto Date, una cadena de fecha con zona horaria
 * o un timestamp numérico en milisegundos.
 *
 * @param {Date|string|number} instante
 * @param {string} zonaHoraria
 * @returns {string}
 */
function instanteAFecha(
  instante,
  zonaHoraria = ZONA_HORARIA_PROYECTO
) {
  const fecha = instante instanceof Date
    ? instante
    : new Date(instante);

  if (!Number.isFinite(fecha.getTime())) {
    throw new TypeError("El instante proporcionado no es válido.");
  }

  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zonaHoraria,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(fecha);

  const valores = Object.fromEntries(
    partes.map((parte) => [parte.type, parte.value])
  );

  return `${valores.year}-${valores.month}-${valores.day}`;
}

module.exports = {
  calcularEstadisticasDia,
  combinarEstadisticas,
  idEstadisticaDiaria,
  instanteAFecha,
  ZONA_HORARIA_PROYECTO,
};
