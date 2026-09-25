"use strict";

// =========================================================
// M.T.P.A. - Simulador de dispositivo MQTT
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Simula, para una incubadora y un dispositivo de prueba, la
// publicación periódica de mediciones y latidos, y la respuesta
// a comandos de ventilador. Sirve para probar el Servicio de
// Integración IoT (../index.js) sin depender del hardware real.
//
// Ver docs/contrato-mqtt.md para la convención de tópicos.
// =========================================================

const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");

// =========================================================
// Carga de variables de entorno
//
// Reutiliza el mismo ".env" del servicio principal (un nivel
// arriba), ya que el simulador se conecta al mismo broker con
// las mismas credenciales.
// =========================================================

function cargarVariablesDeEntorno() {
  const rutaEnv = path.join(__dirname, "..", ".env");

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
    "[simulador] Faltan variables de entorno obligatorias (MQTT_HOST, " +
      "MQTT_USERNAME, MQTT_PASSWORD). Copiá ../.env.example a ../.env y " +
      "completalo con las credenciales del cluster (ver docs/broker-mqtt.md)."
  );
  process.exit(1);
}

// =========================================================
// Identificadores del dispositivo/incubadora de prueba
//
// Configurables por variable de entorno para poder simular
// varias incubadoras/dispositivos sin tocar el código; si no se
// definen, se usan estos valores por defecto.
// =========================================================

const INCUBADORA_ID = process.env.SIMULADOR_INCUBADORA_ID || "incubadora-simulada-01";
const DISPOSITIVO_SENSOR_ID =
  process.env.SIMULADOR_SENSOR_ID || "sensor-simulado-01";
const DISPOSITIVO_VENTILADOR_ID =
  process.env.SIMULADOR_VENTILADOR_ID || "ventilador-simulado-01";

// Intervalo de publicación de medición + latido (ver contrato
// MQTT: SYSTEM_INTERVALS.MEASUREMENT_MAX_SECONDS = 10s como
// máximo esperado entre mediciones).
const INTERVALO_PUBLICACION_MS = 8000;

// =========================================================
// Tópicos (ver docs/contrato-mqtt.md)
// =========================================================

const TOPICO_MEDICION = `${MQTT_TOPIC_PREFIX}/${INCUBADORA_ID}/sensores/${DISPOSITIVO_SENSOR_ID}/medicion`;
const TOPICO_LATIDO_SENSOR = `${MQTT_TOPIC_PREFIX}/${INCUBADORA_ID}/dispositivos/${DISPOSITIVO_SENSOR_ID}/latido`;
const TOPICO_LATIDO_VENTILADOR = `${MQTT_TOPIC_PREFIX}/${INCUBADORA_ID}/dispositivos/${DISPOSITIVO_VENTILADOR_ID}/latido`;
const TOPICO_COMANDO_VENTILADOR = `${MQTT_TOPIC_PREFIX}/${INCUBADORA_ID}/ventiladores/${DISPOSITIVO_VENTILADOR_ID}/comando`;
const TOPICO_ESTADO_VENTILADOR = `${MQTT_TOPIC_PREFIX}/${INCUBADORA_ID}/ventiladores/${DISPOSITIVO_VENTILADOR_ID}/estado`;

// =========================================================
// Conexión TLS al broker MQTT
// =========================================================

const MQTT_URL = `mqtts://${MQTT_HOST}:${MQTT_PORT}`;

const cliente = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  rejectUnauthorized: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  clientId: `mtpa-simulador-${Math.random().toString(16).slice(2, 10)}`,
});

// =========================================================
// Caminata aleatoria acotada para temperatura y humedad
//
// Arranca en un valor "razonable" (dentro de REFERENCE_RANGES
// de frontend/src/utils/constants.js) y en cada tick se mueve un
// paso pequeño en una dirección aleatoria, sin salir de un rango
// físicamente plausible. Así los valores varían de verdad en vez
// de quedar fijos, sin dejar de ser realistas.
// =========================================================

const estadoSimulado = {
  temperatura: 37.5,
  humedad: 55,
};

function pasoAleatorio(valorActual, paso, minimo, maximo) {
  const delta = (Math.random() * 2 - 1) * paso;
  const nuevoValor = valorActual + delta;

  return Math.min(maximo, Math.max(minimo, nuevoValor));
}

function generarMedicion() {
  estadoSimulado.temperatura = pasoAleatorio(
    estadoSimulado.temperatura,
    0.15,
    35,
    40
  );

  estadoSimulado.humedad = pasoAleatorio(estadoSimulado.humedad, 1.5, 40, 70);

  return {
    incubadoraId: INCUBADORA_ID,
    dispositivoId: DISPOSITIVO_SENSOR_ID,
    temperatura: Number(estadoSimulado.temperatura.toFixed(2)),
    humedad: Number(estadoSimulado.humedad.toFixed(2)),
    medidoEn: new Date().toISOString(),
  };
}

function generarLatido(dispositivoId) {
  return {
    incubadoraId: INCUBADORA_ID,
    dispositivoId,
    timestamp: new Date().toISOString(),
  };
}

// =========================================================
// Estado del ventilador simulado
// =========================================================

const estadoVentilador = {
  encendido: false,
  velocidad: 0,
};

function publicarEstadoVentilador() {
  const payload = JSON.stringify({
    incubadoraId: INCUBADORA_ID,
    dispositivoId: DISPOSITIVO_VENTILADOR_ID,
    encendido: estadoVentilador.encendido,
    velocidad: estadoVentilador.velocidad,
    actualizadoEn: new Date().toISOString(),
  });

  cliente.publish(TOPICO_ESTADO_VENTILADOR, payload, { qos: 0 }, (error) => {
    if (error) {
      console.error("[simulador] Error al publicar estado de ventilador:", error);
      return;
    }

    console.log(`[simulador] Estado de ventilador publicado en "${TOPICO_ESTADO_VENTILADOR}":`, payload);
  });
}

function manejarComandoVentilador(payloadBuffer) {
  let comando;

  try {
    comando = JSON.parse(payloadBuffer.toString());
  } catch (error) {
    console.warn("[simulador] Comando de ventilador no es JSON válido:", payloadBuffer.toString());
    return;
  }

  // Acciones esperadas (ver FAN_ACTIONS en frontend/src/utils/constants.js):
  // "encender" | "apagar" | "establecer_velocidad".
  switch (comando.accion) {
    case "encender":
      estadoVentilador.encendido = true;
      if (estadoVentilador.velocidad === 0) {
        estadoVentilador.velocidad = 50;
      }
      break;

    case "apagar":
      estadoVentilador.encendido = false;
      estadoVentilador.velocidad = 0;
      break;

    case "establecer_velocidad": {
      const velocidad = Number(comando.velocidad);

      if (!Number.isNaN(velocidad)) {
        estadoVentilador.velocidad = Math.min(100, Math.max(0, velocidad));
        estadoVentilador.encendido = estadoVentilador.velocidad > 0;
      }
      break;
    }

    default:
      console.warn(`[simulador] Acción de comando desconocida: "${comando.accion}"`);
      return;
  }

  publicarEstadoVentilador();
}

// =========================================================
// Eventos de conexión
// =========================================================

cliente.on("connect", () => {
  console.log(`[simulador] Conectado a ${MQTT_HOST}:${MQTT_PORT}`);
  console.log(
    `[simulador] Simulando incubadora "${INCUBADORA_ID}", sensor ` +
      `"${DISPOSITIVO_SENSOR_ID}" y ventilador "${DISPOSITIVO_VENTILADOR_ID}".`
  );

  cliente.subscribe(TOPICO_COMANDO_VENTILADOR, (error) => {
    if (error) {
      console.error("[simulador] Error al suscribirse a comandos de ventilador:", error);
      return;
    }

    console.log(`[simulador] Suscripto a "${TOPICO_COMANDO_VENTILADOR}"`);
  });

  // Estado inicial del ventilador, para que el Servicio de
  // Integración IoT tenga algo que leer apenas arranca.
  publicarEstadoVentilador();

  setInterval(() => {
    const medicion = generarMedicion();

    cliente.publish(TOPICO_MEDICION, JSON.stringify(medicion), { qos: 0 });
    console.log(`[simulador] Medición publicada en "${TOPICO_MEDICION}":`, medicion);

    const latidoSensor = generarLatido(DISPOSITIVO_SENSOR_ID);
    cliente.publish(TOPICO_LATIDO_SENSOR, JSON.stringify(latidoSensor), {
      qos: 0,
    });

    const latidoVentilador = generarLatido(DISPOSITIVO_VENTILADOR_ID);
    cliente.publish(
      TOPICO_LATIDO_VENTILADOR,
      JSON.stringify(latidoVentilador),
      { qos: 0 }
    );
  }, INTERVALO_PUBLICACION_MS);
});

cliente.on("message", (topico, payloadBuffer) => {
  if (topico === TOPICO_COMANDO_VENTILADOR) {
    manejarComandoVentilador(payloadBuffer);
  }
});

cliente.on("reconnect", () => {
  console.warn("[simulador] Reconectando al broker MQTT...");
});

cliente.on("error", (error) => {
  console.error("[simulador] Error de conexión MQTT:", error.message);
});

function cerrar() {
  console.log("[simulador] Cerrando conexión MQTT...");
  cliente.end(false, () => process.exit(0));
}

process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);
