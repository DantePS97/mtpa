"use strict";

// =========================================================
// M.T.P.A. - Servicio de Integración IoT
// lib/env.js — parser mínimo de archivos ".env"
// =========================================================
//
// Extraído de index.js y simulator/simulador.js, que antes
// tenían cada uno su propia copia de este parser. No se agrega
// la dependencia "dotenv" (no forma parte de las dependencias
// declaradas en package.json para este servicio: solo "mqtt" y
// "firebase-admin"): en su lugar, si existe el archivo ".env" en
// la ruta indicada, se parsean sus líneas "CLAVE=valor" y se
// completan en process.env las que todavía no estén definidas
// (por ejemplo, porque ya vinieron inyectadas por un gestor de
// procesos).
// =========================================================

const fs = require("fs");

/**
 * Carga variables de entorno desde un archivo ".env" hacia
 * process.env, sin sobreescribir las que ya estén definidas.
 * Si el archivo no existe, no hace nada (no es un error: las
 * variables pueden venir ya inyectadas de otra forma).
 *
 * @param {string} rutaEnv Ruta absoluta al archivo ".env".
 */
function cargarVariablesDeEntorno(rutaEnv) {
  if (!fs.existsSync(rutaEnv)) {
    return;
  }

  const contenido = fs.readFileSync(rutaEnv, "utf-8");

  contenido.split("\n").forEach((linea) => {
    const lineaLimpia = linea.trim();

    if (!lineaLimpia || lineaLimpia.startsWith("#")) {
      return;
    }

    const indiceIgual = lineaLimpia.indexOf("=");
    if (indiceIgual === -1) {
      return;
    }

    const clave = lineaLimpia.slice(0, indiceIgual).trim();
    let valor = lineaLimpia.slice(indiceIgual + 1).trim();

    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (process.env[clave] === undefined) {
      process.env[clave] = valor;
    }
  });
}

module.exports = { cargarVariablesDeEntorno };
