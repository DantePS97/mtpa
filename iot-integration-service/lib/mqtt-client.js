"use strict";

// =========================================================
// M.T.P.A. - Servicio de Integración IoT
// lib/mqtt-client.js — conexión MQTT compartida
// =========================================================
//
// Arma las opciones de conexión TLS al broker (HiveMQ Cloud) y
// devuelve un cliente "mqtt" ya conectando. Extraído de index.js
// y simulator/simulador.js, que antes tenían cada uno su propia
// copia de esta configuración (mismo host/puerto/usuario/
// contraseña, mismo "reconnectPeriod").
// =========================================================

const mqtt = require("mqtt");

/**
 * @param {Object} opciones
 * @param {string} opciones.host
 * @param {string|number} opciones.puerto
 * @param {string} opciones.usuario
 * @param {string} opciones.contrasena
 * @param {string} [opciones.clientIdPrefijo] Prefijo del clientId MQTT (default "mtpa").
 * @returns {import("mqtt").MqttClient}
 */
function conectarCliente({
  host,
  puerto,
  usuario,
  contrasena,
  clientIdPrefijo = "mtpa",
}) {
  const url = `mqtts://${host}:${puerto}`;

  return mqtt.connect(url, {
    username: usuario,
    password: contrasena,
    rejectUnauthorized: true,
    // El cliente "mqtt" de npm ya reconecta automáticamente por
    // defecto, pero se fija "reconnectPeriod" de forma explícita
    // en lugar de depender del valor implícito de la librería.
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    clientId: `${clientIdPrefijo}-${Math.random().toString(16).slice(2, 10)}`,
  });
}

module.exports = { conectarCliente };
