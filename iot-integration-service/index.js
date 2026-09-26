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
// Este módulo expone "conectar(onMensaje)" en vez de conectarse
// directamente al importarse, para que Sprint 3 pueda reutilizar
// la misma conexión/suscripción con su propio handler de
// mensajes (el que sí escriba en Firestore), sin duplicar esta
// lógica. Ejecutado directamente (`node index.js` / `npm start`),
// se conecta con el handler por defecto, que solo loguea.
//
// Ver docs/contrato-mqtt.md para la convención de tópicos y
// docs/broker-mqtt.md para los datos del cluster de HiveMQ Cloud.
// =========================================================

const path = require("path");
const { cargarVariablesDeEntorno } = require("./lib/env");
const { conectarCliente } = require("./lib/mqtt-client");

cargarVariablesDeEntorno(path.join(__dirname, ".env"));

// =========================================================
// Configuración desde variables de entorno (ver .env.example)
// =========================================================

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = process.env.MQTT_PORT || "8883";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX || "mtpa-dev";

// =========================================================
// Tópicos a suscribir (ver docs/contrato-mqtt.md)
// =========================================================

const TOPICO_MEDICIONES = `${MQTT_TOPIC_PREFIX}/+/sensores/+/medicion`;
const TOPICO_ESTADO_VENTILADORES = `${MQTT_TOPIC_PREFIX}/+/ventiladores/+/estado`;
const TOPICO_LATIDO = `${MQTT_TOPIC_PREFIX}/+/dispositivos/+/latido`;

/**
 * Handler de mensajes por defecto: solo loguea el tópico y el
 * payload ya parseado. La invocación real a "procesarMedicion"
 * (escritura en Firestore, cálculo de estadoConexion, disparo de
 * alertas, etc.) es de Sprint 3 y queda deliberadamente fuera de
 * este bloque; Sprint 3 puede pasarle a "conectar()" su propio
 * handler en vez de este.
 *
 * @param {string} topico
 * @param {Object} payload
 */
function manejarMensajePorDefecto(topico, payload) {
  console.log(`[iot-integration-service] Mensaje en "${topico}":`, payload);
}

/**
 * Conecta al broker MQTT, se suscribe a los tópicos relevantes y
 * delega cada mensaje entrante (ya parseado como JSON) a
 * "onMensaje".
 *
 * @param {(topico: string, payload: Object) => void} [onMensaje]
 * @returns {import("mqtt").MqttClient}
 */
function conectar(onMensaje = manejarMensajePorDefecto) {
  if (!MQTT_HOST || !MQTT_USERNAME || !MQTT_PASSWORD) {
    console.error(
      "[iot-integration-service] Faltan variables de entorno obligatorias " +
        "(MQTT_HOST, MQTT_USERNAME, MQTT_PASSWORD). Copiá .env.example a " +
        ".env y completalo con las credenciales del cluster (ver " +
        "docs/broker-mqtt.md)."
    );
    process.exit(1);
  }

  const cliente = conectarCliente({
    host: MQTT_HOST,
    puerto: MQTT_PORT,
    usuario: MQTT_USERNAME,
    contrasena: MQTT_PASSWORD,
    clientIdPrefijo: "mtpa-iot-integration-service",
  });

  cliente.on("connect", () => {
    console.log(
      `[iot-integration-service] Conectado a ${MQTT_HOST}:${MQTT_PORT}`
    );

    cliente.subscribe(
      [TOPICO_MEDICIONES, TOPICO_ESTADO_VENTILADORES, TOPICO_LATIDO],
      (error) => {
        if (error) {
          console.error(
            "[iot-integration-service] Error al suscribirse:",
            error
          );
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

  cliente.on("message", (topico, payloadBuffer) => {
    const payloadCrudo = payloadBuffer.toString();

    let payload;

    try {
      payload = JSON.parse(payloadCrudo);
    } catch (error) {
      console.warn(
        `[iot-integration-service] Mensaje en "${topico}" no es JSON ` +
          "válido, se loguea en crudo:",
        payloadCrudo
      );
      return;
    }

    onMensaje(topico, payload);
  });

  return cliente;
}

// =========================================================
// Ejecución directa (`node index.js` / `npm start`)
// =========================================================
//
// Si este archivo se importa (por ejemplo, desde Sprint 3, para
// reutilizar "conectar()" con otro handler), no se conecta solo
// ni engancha señales de proceso: eso queda a cargo de quien lo
// importe.

if (require.main === module) {
  const cliente = conectar();

  function cerrar() {
    console.log("[iot-integration-service] Cerrando conexión MQTT...");
    cliente.end(false, () => process.exit(0));
  }

  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
}

module.exports = { conectar };
