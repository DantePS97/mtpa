
"use strict";

// functions/lib/reportes.js

const PDFDocument = require("pdfkit");

const MAX_FILAS_CSV = 50000;
const MAX_FILAS_PDF = 2000;

const BOM_UTF8 = "\uFEFF";
const MENSAJE_SIN_DATOS = "Sin datos para el periodo";

/**
 * Convierte valores a texto para exportación.
 * Las fechas se expresan en ISO 8601.
 */
function convertirValor(valor) {
  if (valor === null || valor === undefined) {
    return "";
  }

  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? "" : valor.toISOString();
  }

  // Compatibilidad con Timestamp de Firebase Admin.
  if (
    valor &&
    typeof valor.toDate === "function" &&
    typeof valor.toMillis === "function"
  ) {
    return valor.toDate().toISOString();
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? String(valor) : "";
  }

  if (typeof valor === "boolean") {
    return String(valor);
  }

  if (typeof valor === "object") {
    return JSON.stringify(valor);
  }

  return String(valor);
}

/**
 * Neutraliza texto que pueda interpretarse como fórmula en Excel.
 * Se antepone un apóstrofo a los valores que comiencen con =, +, - o @.
 */

function neutralizarFormula(valor) {
  // Los números se conservan como números, incluidos los negativos.
  if (typeof valor === "number") {
    return Number.isFinite(valor) ? String(valor) : "";
  }

  // Las fechas se convierten a ISO sin tratarlas como fórmulas.
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? "" : valor.toISOString();
  }

  if (
    valor &&
    typeof valor.toDate === "function" &&
    typeof valor.toMillis === "function"
  ) {
    return valor.toDate().toISOString();
  }

  const texto = convertirValor(valor);

  // Evita fórmulas incluso si hay espacios o caracteres de control
  // antes del prefijo peligroso.
  if (/^[\s\u0000-\u001F]*[=+\-@]/.test(texto)) {
    return `'${texto}`;
  }

  return texto;
}


/**
 * Escapa campos CSV conforme a las reglas de comillas dobles.
 */
function escaparCampoCsv(valor) {
  const texto = neutralizarFormula(valor);
  return `"${texto.replace(/"/g, '""')}"`;
}

/**
 * Genera un CSV con separador coma y BOM UTF-8.
 *
 * @param {Array<string>} columnas
 * @param {Array<Array|Object>} filas
 * @returns {string}
 */
function generarCsv(columnas, filas) {
  validarEntrada(columnas, filas);

  if (filas.length > MAX_FILAS_CSV) {
    throw new RangeError(
      `El CSV supera el máximo permitido de ${MAX_FILAS_CSV} filas.`
    );
  }

  const lineas = [];

  lineas.push(columnas.map(escaparCampoCsv).join(","));

  if (filas.length === 0) {
    lineas.push(escaparCampoCsv(MENSAJE_SIN_DATOS));
  } else {
    for (const fila of filas) {
      const valores = Array.isArray(fila)
        ? fila
        : columnas.map((columna) => fila?.[columna]);

      lineas.push(
        columnas
          .map((_, indice) => escaparCampoCsv(valores[indice]))
          .join(",")
      );
    }
  }

  return BOM_UTF8 + lineas.join("\r\n") + "\r\n";
}

/**
 * Valida las entradas comunes de exportación.
 */
function validarEntrada(columnas, filas) {
  if (!Array.isArray(columnas) || columnas.length === 0) {
    throw new TypeError("columnas debe ser un arreglo no vacío.");
  }

  if (!Array.isArray(filas)) {
    throw new TypeError("filas debe ser un arreglo.");
  }

  if (
    columnas.some(
      (columna) => typeof columna !== "string" || columna.length === 0
    )
  ) {
    throw new TypeError("Cada columna debe tener un nombre de texto.");
  }
}

/**
 * Genera un PDF paginado y lo devuelve como Buffer.
 *
 * @param {Object} opciones
 * @param {string} opciones.titulo
 * @param {string} opciones.incubadora
 * @param {string} opciones.variable
 * @param {string} opciones.periodo
 * @param {Array<string>} opciones.columnas
 * @param {Array<Array|Object>} opciones.filas
 * @returns {Promise<Buffer>}
 */
async function generarPdf({
  titulo,
  incubadora,
  variable,
  periodo,
  columnas,
  filas,
}) {
  validarEntrada(columnas, filas);

  if (filas.length > MAX_FILAS_PDF) {
    throw new RangeError(
      `El PDF supera el máximo permitido de ${MAX_FILAS_PDF} filas.`
    );
  }

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: {
      top: 45,
      bottom: 45,
      left: 35,
      right: 35,
    },
    bufferPages: true,
    info: {
      Title: titulo || "Reporte",
      Author: "Sistema de monitoreo",
    },
  });

  const fragmentos = [];

  const resultado = new Promise((resolve, reject) => {
    doc.on("data", (fragmento) => fragmentos.push(fragmento));
    doc.on("end", () => resolve(Buffer.concat(fragmentos)));
    doc.on("error", reject);
  });

  const anchoPagina =
    doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const altoPagina =
    doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  const anchoColumna = anchoPagina / columnas.length;
  const altoFila = 25;

  function dibujarEncabezado() {
    const fechaGeneracion = new Date().toISOString();

    doc.font("Helvetica-Bold").fontSize(16).text(
      titulo || "Reporte",
      doc.page.margins.left,
      25,
      { width: anchoPagina }
    );

    doc.font("Helvetica").fontSize(9);

    doc.text(`Incubadora: ${incubadora || "No especificada"}`);
    doc.text(`Variable: ${variable || "No especificada"}`);
    doc.text(`Periodo: ${periodo || "No especificado"}`);
    doc.text(`Generado: ${fechaGeneracion}`);

    doc.moveDown(1);
  }

  function dibujarCabeceraTabla() {
    const y = doc.y;

    doc.font("Helvetica-Bold").fontSize(8);

    columnas.forEach((columna, indice) => {
      doc.text(
        columna,
        doc.page.margins.left + indice * anchoColumna,
        y,
        {
          width: anchoColumna - 5,
          height: altoFila,
          ellipsis: true,
        }
      );
    });

    doc.y = y + altoFila;

    doc.moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.margins.left + anchoPagina, doc.y)
      .stroke();

    doc.y += 5;
  }

  function nuevaPagina() {
    doc.addPage();
    dibujarEncabezado();
    dibujarCabeceraTabla();
  }

  dibujarEncabezado();

  if (filas.length === 0) {
    doc.font("Helvetica").fontSize(12);
    doc.text(MENSAJE_SIN_DATOS);
  } else {
    dibujarCabeceraTabla();

    for (const fila of filas) {
      const valores = Array.isArray(fila)
        ? fila
        : columnas.map((columna) => fila?.[columna]);

      if (doc.y + altoFila > doc.page.height - doc.page.margins.bottom) {
        nuevaPagina();
      }

      const y = doc.y;

      doc.font("Helvetica").fontSize(8);

      columnas.forEach((_, indice) => {
        const valor = convertirValor(valores[indice]);

        doc.text(
          valor,
          doc.page.margins.left + indice * anchoColumna,
          y,
          {
            width: anchoColumna - 5,
            height: altoFila,
            ellipsis: true,
          }
        );
      });

      doc.y = y + altoFila;

      doc.moveTo(doc.page.margins.left, doc.y)
        .lineTo(doc.page.margins.left + anchoPagina, doc.y)
        .stroke();

      doc.y += 4;
    }
  }

  doc.end();

  return resultado;
}

module.exports = {
  generarCsv,
  generarPdf,
  MAX_FILAS_CSV,
  MAX_FILAS_PDF,
};

