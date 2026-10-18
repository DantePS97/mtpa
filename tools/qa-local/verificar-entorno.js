#!/usr/bin/env node
"use strict";

/**
 * Comprueba que el shell actual solo puede hablar con los emuladores de
 * Firebase. Termina con código 1 y explica qué falla si no se cumple:
 *
 *   - GCLOUD_PROJECT definido y con prefijo "demo-" seguido de algo. Si están
 *     definidas, también GOOGLE_CLOUD_PROJECT, GCP_PROJECT,
 *     CLOUDSDK_CORE_PROJECT y el projectId de FIREBASE_CONFIG.
 *   - FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST definidos como
 *     host:puerto (puerto 1-65535) de esta máquina (127.0.0.1, localhost, [::1]).
 *   - GOOGLE_APPLICATION_CREDENTIALS NO definida.
 *
 * Excepción explícita: con --migracion-ventiladores se admite
 * GOOGLE_APPLICATION_CREDENTIALS, pero solo si apunta a un JSON cuyo
 * "project_id" y "client_email" sean de un proyecto "demo-". Existe para
 * functions/scripts/crear-documentos-ventiladores.js, que la exige por
 * diseño; usalo con una cuenta de servicio FALSA, nunca con una real, y
 * corré la verificación en el MISMO shell que el script de migración.
 *
 * Uso:  node tools/qa-local/verificar-entorno.js [--migracion-ventiladores]
 * Los demás scripts del kit lo invocan con require("./verificar-entorno").
 */

const fs = require("fs");

const ANFITRIONES_LOCALES = ["127.0.0.1", "localhost", "[::1]"];
const esProyectoDemo = (valor) => typeof valor === "string" && /^demo-.+/.test(valor);

/** true si `valor` es host:puerto de esta máquina, con puerto 1-65535. */
function hostLocal(valor) {
  const puerto = /:(\d{1,5})$/.exec(valor || "");
  if (!puerto || Number(puerto[1]) < 1 || Number(puerto[1]) > 65535) return false;
  try {
    const url = new URL(`http://${valor}`);
    return ANFITRIONES_LOCALES.includes(url.hostname) && url.pathname === "/" && !url.username && !url.search;
  } catch {
    return false;
  }
}

function projectIdDeFirebaseConfig(valor) {
  try {
    const texto = valor.trim().startsWith("{") ? valor : fs.readFileSync(valor, "utf8");
    return { id: JSON.parse(texto).projectId };
  } catch (error) {
    return { error: error.message };
  }
}

function verificar({ migracionVentiladores = false } = {}) {
  const env = process.env;
  const errores = [];

  const proyecto = env.GCLOUD_PROJECT;
  if (!esProyectoDemo(proyecto)) {
    errores.push(`GCLOUD_PROJECT debe empezar con "demo-" (valor actual: ${proyecto || "sin definir"}).`);
  }
  for (const nombre of ["GOOGLE_CLOUD_PROJECT", "GCP_PROJECT", "CLOUDSDK_CORE_PROJECT"]) {
    if (env[nombre] && !esProyectoDemo(env[nombre])) {
      errores.push(`${nombre} no empieza con "demo-" (${env[nombre]}).`);
    }
  }
  if (env.FIREBASE_CONFIG) {
    const { id, error } = projectIdDeFirebaseConfig(env.FIREBASE_CONFIG);
    if (error) errores.push(`No se pudo interpretar FIREBASE_CONFIG: ${error}`);
    else if (id !== undefined && !esProyectoDemo(id)) errores.push(`El projectId de FIREBASE_CONFIG no empieza con "demo-" (${id}).`);
  }

  const hosts = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080", FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
  for (const [nombre, ejemplo] of Object.entries(hosts)) {
    if (!env[nombre]) errores.push(`${nombre} no está definida (ej.: ${ejemplo}).`);
    else if (!hostLocal(env[nombre])) errores.push(`${nombre}=${env[nombre]} no es un host:puerto de esta máquina (ej.: ${ejemplo}).`);
  }

  const credenciales = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credenciales && !migracionVentiladores) {
    errores.push(
      "GOOGLE_APPLICATION_CREDENTIALS está definida: con ella el Admin SDK podría " +
        "usar un proyecto real. Quitala (unset). Única excepción: --migracion-ventiladores."
    );
  } else if (credenciales) {
    try {
      const { project_id: id, client_email: correo } = JSON.parse(fs.readFileSync(credenciales, "utf8"));
      if (!esProyectoDemo(id)) errores.push(`La cuenta de servicio no es de un proyecto "demo-" (project_id: ${id}).`);
      if (typeof correo !== "string" || !correo.includes("demo-")) {
        errores.push(`El client_email de la cuenta de servicio no contiene "demo-" (${correo}).`);
      }
    } catch (error) {
      errores.push(`No se pudo leer la cuenta de servicio de GOOGLE_APPLICATION_CREDENTIALS: ${error.message}`);
    }
  } else if (migracionVentiladores) {
    errores.push("--migracion-ventiladores exige GOOGLE_APPLICATION_CREDENTIALS (una cuenta de servicio falsa de demo-).");
  }

  if (errores.length > 0) {
    console.error("VERIFICACION FALLIDA: el entorno no es seguro para pruebas locales.");
    errores.forEach((e) => console.error(` - ${e}`));
    process.exit(1);
  }

  console.log(
    `Entorno OK: proyecto ${proyecto}, Firestore ${env.FIRESTORE_EMULATOR_HOST}, ` +
      `Auth ${env.FIREBASE_AUTH_EMULATOR_HOST}, ` +
      (credenciales ? "cuenta de servicio demo- (solo migración)." : "sin GOOGLE_APPLICATION_CREDENTIALS.")
  );
}

module.exports = { verificar, hostLocal };

if (require.main === module) {
  verificar({ migracionVentiladores: process.argv.includes("--migracion-ventiladores") });
}
