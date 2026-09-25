"use strict";

// =========================================================
// M.T.P.A. - Servicio de Integración IoT
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Traduce los mensajes MQTT publicados por los dispositivos
// físicos de cada incubadora. Por ahora (Sprint 2) solo se
// conecta al broker, se suscribe a los tópicos relevantes y
// loguea cada mensaje recibido; la escritura real en Firestore
// ("procesarMedicion") se implementa en Sprint 3.
//
// Ver docs/contrato-mqtt.md para la convención de tópicos y
// docs/broker-mqtt.md para los datos del cluster de HiveMQ Cloud.
// =========================================================

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

// =========================================================
// Carga de variables de entorno
//
// No se agrega la dependencia "dotenv" (no forma parte de las
// dependencias declaradas en package.json para este servicio):
// en su lugar, si existe un archivo ".env" junto a este archivo,
// se parsean sus líneas "CLAVE=valor" y se completan en
// process.env las que todavía no estén definidas (por ejemplo,
// porque ya vinieron inyectadas por un gestor de procesos).
// =========================================================

function cargarVariablesDeEntorno() {
  const rutaEnv = path.join(__dirname, ".env");

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

cargarVariablesDeEntorno();

// =========================================================
// Configuración desde variables de entorno (ver .env.example)
// =========================================================

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = process.env.MQTT_PORT || "8883";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "mtpa-dev";

if (!MQTT_HOST || !MQTT_USERNAME || !MQTT_PASSWORD) {
  console.error(
    "[iot-integration-service] Faltan variables de entorno obligatorias " +
      "(MQTT_HOST, MQTT_USERNAME, MQTT_PASSWORD). Copiá .env.example a " +
      ".env y completalo con las credenciales del cluster (ver " +
      "docs/broker-mqtt.md)."
  );
  process.exit(1);
}

// =========================================================
// Tópicos a suscribir (ver docs/contrato-mqtt.md)
// =========================================================

const TOPICO_MEDICIONES = `${MQTT_TOPIC_PREFIX}/+/sensores/+/medicion`;
const TOPICO_ESTADO_VENTILADORES = `${MQTT_TOPIC_PREFIX}/+/ventiladores/+/estado`;
const TOPICO_LATIDO = `${MQTT_TOPIC_PREFIX}/+/dispositivos/+/latido`;

// =========================================================
// Conexión TLS al broker MQTT (HiveMQ Cloud)
// =========================================================
//
// El cliente "mqtt" de npm ya reconecta automáticamente por
// defecto, pero acá se fija "reconnectPeriod" de forma explícita
// en lugar de depender del valor implícito de la librería, tal
// como lo requiere este bloque.

const MQTT_URL = `mqtts://${MQTT_HOST}:${MQTT_PORT}`;

const cliente = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  clientId: `mtpa-iot-integration-service-${Math.random()
    .toString(16)
    .slice(2, 10)}`,
});

cliente.on("connect", () => {
  console.log(
    `[iot-integration-service] Conectado a ${MQTT_HOST}:${MQTT_PORT}`
  );

  cliente.subscribe(
    [TOPICO_MEDICIONES, TOPICO_ESTADO_VENTILADORES, TOPICO_LATIDO],
    (error) => {
      if (error) {
        console.error("[iot-integration-service] Error al suscribirse:", error);
        return;
      }

      console.log(
        `[iot-integration-service] Suscripto a "${TOPICO_MEDICIONES}", ` +
          `"${TOPICO_ESTADO_VENTILADORES}" y "${TOPICO_LATIDO}"`
      );
    }
  );
});

cliente.on("reconnect", () => {
  console.warn("[iot-integration-service] Reconectando al broker MQTT...");
});

cliente.on("close", () => {
  console.warn("[iot-integration-service] Conexión con el broker cerrada.");
});

cliente.on("error", (error) => {
  console.error(
    "[iot-integration-service] Error de conexión MQTT:",
    error.message
  );
});

// =========================================================
// Manejo de mensajes entrantes
// =========================================================
//
// Por ahora solo se loguea el tópico y el payload parseado. La
// invocación real a "procesarMedicion" (escritura en Firestore,
// cálculo de estadoConexion, disparo de alertas, etc.) es de
// Sprint 3 y queda deliberadamente fuera de este bloque.

cliente.on("message", (topico, payloadBuffer) => {
  const payloadCrudo = payloadBuffer.toString();

  let payload;

  try {
    payload = JSON.parse(payloadCrudo);
  } catch (error) {
    console.warn(
      `[iot-integration-service] Mensaje en "${topico}" no es JSON válido, ` +
        "se loguea en crudo:",
      payloadCrudo
    );
    return;
  }

  console.log(`[iot-integration-service] Mensaje en "${topico}":`, payload);
});

// =========================================================
// Cierre ordenado del proceso
// =========================================================

function cerrar() {
  console.log("[iot-integration-service] Cerrando conexión MQTT...");
  cliente.end(false, () => process.exit(0));
}

process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
