"use strict";

// =========================================================
// M.T.P.A. - Servicio de Integración IoT
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Recibe mensajes MQTT y delega las mediciones a
// "procesarMedicion" mediante HTTPS.
//
// La conexión MQTT y las suscripciones permanecen dentro de
// "conectar()". El handler de producción procesa los tópicos de
// mediciones, de latidos y de estado de ventiladores.
//
// Además escucha en Firestore las órdenes pendientes de
// "ordenes_ventilador" y publica el comando MQTT
// correspondiente (ver "escucharOrdenesPendientes()"). Cuando el
// ventilador reporta su estado, cierra la orden como "ejecutada";
// las que nadie confirma las marca "fallida" un barrido periódico
// (ver "iniciarBarridoOrdenes()").
//
// =========================================================

const path = require("path");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { cargarVariablesDeEntorno } = require("./lib/env");
const { conectarCliente } = require("./lib/mqtt-client");
const { crearRastreadorConexion } = require("./lib/estado-conexion");

cargarVariablesDeEntorno(path.join(__dirname, ".env"));

// =========================================================
// Firebase Admin SDK
//
// Se usa para acceder a Firestore sin depender de las reglas
// del cliente.
// =========================================================

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// =========================================================
// Configuración MQTT
// =========================================================

const MQTT_HOST = process.env.MQTT_HOST;
const MQTT_PORT = process.env.MQTT_PORT || "8883";
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_TOPIC_PREFIX =
  process.env.MQTT_TOPIC_PREFIX || "mtpa-dev";

// =========================================================
// Configuración procesarMedicion
// =========================================================

const PROCESAR_MEDICION_URL =
  process.env.PROCESAR_MEDICION_URL;

const PROCESAR_MEDICION_TOKEN =
  process.env.PROCESAR_MEDICION_TOKEN;

const MAX_REINTENTOS = Number.parseInt(
  process.env.PROCESAR_MEDICION_MAX_REINTENTOS || "5",
  10
);

const BACKOFF_INICIAL_MS = Number.parseInt(
  process.env.PROCESAR_MEDICION_BACKOFF_MS || "500",
  10
);

// =========================================================
// Configuración de órdenes de ventilador
// =========================================================

/*
 * Una orden que sigue pendiente pasado este tiempo no se envía:
 * se marca "expirada". Evita que, por ejemplo tras reiniciar el
 * servicio, se accione un ventilador con una orden vieja.
 */
const ORDEN_MAX_ANTIGUEDAD_SEGUNDOS_ENTORNO = Number.parseInt(
  process.env.ORDEN_MAX_ANTIGUEDAD_SEGUNDOS,
  10
);

const ORDEN_MAX_ANTIGUEDAD_MS =
  (ORDEN_MAX_ANTIGUEDAD_SEGUNDOS_ENTORNO > 0
    ? ORDEN_MAX_ANTIGUEDAD_SEGUNDOS_ENTORNO
    : 60) * 1000;

/*
 * Una orden "enviada" que el dispositivo no confirma pasado este
 * tiempo se marca "fallida" (ver barrerOrdenesEnviadas). Se cuenta
 * desde "enviadaEn". Un valor inválido se reemplaza por 30 s.
 */
const ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS_ENTORNO = Number.parseInt(
  process.env.ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS,
  10
);

const ORDEN_CONFIRMACION_TIMEOUT_MS =
  (ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS_ENTORNO > 0
    ? ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS_ENTORNO
    : 30) * 1000;

// Cada cuánto se revisan las órdenes "enviada" sin confirmar.
const BARRIDO_ORDENES_INTERVALO_MS = 10 * 1000;

// =========================================================
// Detección de dispositivos desconectados
// =========================================================

/*
 * Un dispositivo sin latidos ni mediciones durante más de
 * LATIDO_TIMEOUT_SEGUNDOS se marca "desconectado" en Firestore
 * (ver lib/estado-conexion.js y docs/contrato-mqtt.md) y se crea una
 * alerta de desconexión. Los valores inválidos se reemplazan por los
 * valores por defecto del módulo.
 */
const rastreadorConexion = crearRastreadorConexion({
  db,
  config: {
    timeoutSegundos: Number.parseInt(
      process.env.LATIDO_TIMEOUT_SEGUNDOS,
      10
    ),
    revisionSegundos: Number.parseInt(
      process.env.LATIDO_REVISION_SEGUNDOS,
      10
    ),
    refrescoSegundos: Number.parseInt(
      process.env.LATIDO_REFRESCO_SEGUNDOS,
      10
    ),
    estabilidadSegundos: Number.parseInt(
      process.env.LATIDO_ESTABILIDAD_SEGUNDOS,
      10
    ),
  },
  FieldValue,
  Timestamp,
});

// =========================================================
// Tópicos MQTT
// =========================================================

const TOPICO_MEDICIONES =
  `${MQTT_TOPIC_PREFIX}/+/sensores/+/medicion`;

const TOPICO_ESTADO_VENTILADORES =
  `${MQTT_TOPIC_PREFIX}/+/ventiladores/+/estado`;

const TOPICO_LATIDO =
  `${MQTT_TOPIC_PREFIX}/+/dispositivos/+/latido`;

// =========================================================
// Validación de tópicos y mediciones
// =========================================================

const TOPICO_MEDICION_RE = new RegExp(
  `^${escapeRegExp(MQTT_TOPIC_PREFIX)}/([^/]+)/sensores/([^/]+)/medicion$`
);

const TOPICO_LATIDO_RE = new RegExp(
  `^${escapeRegExp(MQTT_TOPIC_PREFIX)}/([^/]+)/dispositivos/([^/]+)/latido$`
);

const TOPICO_ESTADO_RE = new RegExp(
  `^${escapeRegExp(MQTT_TOPIC_PREFIX)}/([^/]+)/ventiladores/([^/]+)/estado$`
);

/*
 * Un mensaje de medición del sensor trae temperatura y/o humedad
 * en un mismo payload (ver docs/contrato-mqtt.md y el simulador),
 * pero "procesarMedicion" recibe una variable por petición y exige
 * su unidad. Esta tabla fija la unidad de cada variable (mismos
 * valores que UNITS en frontend/src/utils/constants.js).
 */
const UNIDAD_POR_VARIABLE = {
  temperatura: "°C",
  humedad: "%",
};

/**
 * Escapa caracteres especiales para utilizar una cadena
 * dentro de una expresión regular.
 *
 * @param {string} valor
 * @returns {string}
 */
function escapeRegExp(valor) {
  return valor.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

/**
 * Obtiene la incubadora y el dispositivo desde el tópico.
 *
 * @param {string} topico
 * @returns {{incubadoraId: string, dispositivoId: string}|null}
 */
function obtenerContextoDelTopico(topico) {
  if (typeof topico !== "string") {
    return null;
  }

  const match = topico.match(TOPICO_MEDICION_RE);

  if (!match) {
    return null;
  }

  return {
    incubadoraId: match[1],
    dispositivoId: match[2],
  };
}

/**
 * Obtiene la incubadora y el dispositivo desde un tópico de latido.
 *
 * @param {string} topico
 * @returns {{incubadoraId: string, dispositivoId: string}|null}
 */
function obtenerContextoDelLatido(topico) {
  if (typeof topico !== "string") {
    return null;
  }

  const match = topico.match(TOPICO_LATIDO_RE);

  if (!match) {
    return null;
  }

  return {
    incubadoraId: match[1],
    dispositivoId: match[2],
  };
}

/**
 * Obtiene la incubadora y el ventilador desde un tópico de estado.
 * El id del ventilador es el dispositivoId del tópico.
 *
 * @param {string} topico
 * @returns {{incubadoraId: string, dispositivoId: string}|null}
 */
function obtenerContextoDelEstado(topico) {
  if (typeof topico !== "string") {
    return null;
  }

  const match = topico.match(TOPICO_ESTADO_RE);

  if (!match) {
    return null;
  }

  return {
    incubadoraId: match[1],
    dispositivoId: match[2],
  };
}

/**
 * Valida el payload de una medición y comprueba que el origen
 * declarado en el payload coincida con el dispositivo e
 * incubadora indicados en el tópico MQTT.
 *
 * La autorización del dispositivo debe permanecer garantizada
 * por las ACL del broker MQTT.
 *
 * @param {string} topico
 * @param {Object} payload
 * @returns {{valido: boolean, razon?: string, mediciones?: Object[]}}
 */
function validarMedicion(topico, payload) {
  const contexto =
    obtenerContextoDelTopico(topico);

  if (!contexto) {
    return {
      valido: false,
      razon:
        "El mensaje no pertenece a un tópico de mediciones.",
    };
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return {
      valido: false,
      razon:
        "El payload debe ser un objeto JSON.",
    };
  }

  if (
    payload.incubadoraId !==
    contexto.incubadoraId
  ) {
    return {
      valido: false,
      razon:
        "La incubadora del payload no coincide con la del tópico.",
    };
  }

  if (
    payload.dispositivoId !==
    contexto.dispositivoId
  ) {
    return {
      valido: false,
      razon:
        "El dispositivo del payload no coincide con la del tópico.",
    };
  }

  const variablesPresentes = Object.keys(
    UNIDAD_POR_VARIABLE
  ).filter(
    (variable) =>
      payload[variable] !== undefined
  );

  if (variablesPresentes.length === 0) {
    return {
      valido: false,
      razon:
        "La medición debe incluir temperatura y/o humedad.",
    };
  }

  for (const variable of variablesPresentes) {
    if (
      typeof payload[variable] !== "number" ||
      !Number.isFinite(payload[variable])
    ) {
      return {
        valido: false,
        razon:
          `El valor de ${variable} debe ser numérico y finito.`,
      };
    }
  }

  if (
    typeof payload.medidoEn !== "string" &&
    typeof payload.medidoEn !== "number"
  ) {
    return {
      valido: false,
      razon:
        "La medición debe incluir medidoEn.",
    };
  }

  // Una medición por variable, con el formato que espera
  // "procesarMedicion": { incubadoraId, dispositivoId, variable,
  // valor, unidad, medidoEn }.
  return {
    valido: true,
    mediciones: variablesPresentes.map((variable) => ({
      incubadoraId: contexto.incubadoraId,
      dispositivoId: contexto.dispositivoId,
      variable,
      valor: payload[variable],
      unidad: UNIDAD_POR_VARIABLE[variable],
      medidoEn: payload.medidoEn,
    })),
  };
}

// =========================================================
// Retry / backoff
// =========================================================

function esperar(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

/**
 * Invoca procesarMedicion mediante HTTPS.
 *
 * Los errores transitorios se reintentan con backoff
 * exponencial.
 *
 * @param {Object} medicion
 * @returns {Promise<Response>}
 */
async function invocarProcesarMedicion(medicion) {
  if (!PROCESAR_MEDICION_URL) {
    throw new Error(
      "Falta PROCESAR_MEDICION_URL."
    );
  }

  if (!PROCESAR_MEDICION_TOKEN) {
    throw new Error(
      "Falta PROCESAR_MEDICION_TOKEN."
    );
  }

  let ultimoError;

  for (
    let intento = 0;
    intento < MAX_REINTENTOS;
    intento += 1
  ) {
    try {
      const respuesta = await fetch(
        PROCESAR_MEDICION_URL,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${PROCESAR_MEDICION_TOKEN}`,
          },
          body: JSON.stringify(medicion),
        }
      );

      if (respuesta.ok) {
        return respuesta;
      }

      const cuerpo =
        await respuesta.text().catch(() => "");

      const error = new Error(
        `procesarMedicion respondió HTTP ` +
          `${respuesta.status}` +
          `${
            cuerpo
              ? `: ${cuerpo.slice(0, 300)}`
              : ""
          }`
      );

      /*
       * No reintentar errores 4xx permanentes.
       *
       * 408 y 429 sí pueden ser transitorios.
       */
      if (
        respuesta.status >= 400 &&
        respuesta.status < 500 &&
        respuesta.status !== 408 &&
        respuesta.status !== 429
      ) {
        error.permanente = true;
        throw error;
      }

      ultimoError = error;
    } catch (error) {
      if (error.permanente) {
        throw error;
      }

      ultimoError = error;
    }

    if (intento === MAX_REINTENTOS - 1) {
      break;
    }

    const demora =
      BACKOFF_INICIAL_MS *
      2 ** intento;

    await esperar(demora);
  }

  throw (
    ultimoError ||
    new Error(
      "Falló la invocación de procesarMedicion."
    )
  );
}

// =========================================================
// Handler de producción
// =========================================================

/**
 * Procesa los mensajes MQTT recibidos.
 *
 * Solo las mediciones son enviadas a procesarMedicion.
 * Los mensajes de estado de ventiladores se procesan aparte (ver
 * manejarEstadoVentilador) y tampoco van a dicha función. Los latidos
 * y las mediciones válidas se registran además como señal de vida
 * del dispositivo (ver lib/estado-conexion.js).
 *
 * @param {string} topico
 * @param {Object} payload
 * @returns {Promise<void>}
 */
async function manejarMensajeProduccion(
  topico,
  payload
) {
  const contextoLatido =
    obtenerContextoDelLatido(topico);

  if (contextoLatido) {
    // Si el payload declara otro origen, el latido no es confiable.
    if (
      payload &&
      typeof payload === "object" &&
      ((payload.dispositivoId !== undefined &&
        payload.dispositivoId !==
          contextoLatido.dispositivoId) ||
        (payload.incubadoraId !== undefined &&
          payload.incubadoraId !==
            contextoLatido.incubadoraId))
    ) {
      console.error(
        `[iot-integration-service] Latido rechazado ` +
          `("${topico}"): el origen del payload no coincide ` +
          "con el del tópico."
      );

      return;
    }

    await rastreadorConexion.registrarSenalDeVida(
      contextoLatido.dispositivoId,
      "latido",
      { incubadoraId: contextoLatido.incubadoraId }
    );

    return;
  }

  const contextoEstado =
    obtenerContextoDelEstado(topico);

  if (contextoEstado) {
    // Un fallo aquí no debe afectar a las mediciones ni a los latidos.
    try {
      await manejarEstadoVentilador(contextoEstado, payload);
    } catch (error) {
      console.error(
        `[iot-integration-service] Error al procesar el estado ` +
          `del ventilador ("${topico}"):`,
        error
      );
    }

    return;
  }

  const contexto =
    obtenerContextoDelTopico(topico);

  // Solo procesar tópicos de mediciones.
  if (!contexto) {
    return;
  }

  const validacion = validarMedicion(
    topico,
    payload
  );

  if (!validacion.valido) {
    console.error(
      `[iot-integration-service] Medición rechazada ` +
        `("${topico}"): ${validacion.razon}`
    );

    return;
  }

  // Una medición válida también es señal de vida del dispositivo.
  // No se espera: no debe demorar el envío a procesarMedicion.
  rastreadorConexion.registrarSenalDeVida(
    contexto.dispositivoId,
    "medicion",
    { incubadoraId: contexto.incubadoraId }
  );

  // Una petición por variable; si una falla, las demás se envían igual.
  for (const medicion of validacion.mediciones) {
    try {
      await invocarProcesarMedicion(medicion);

      console.log(
        `[iot-integration-service] Medición enviada a ` +
          `procesarMedicion: ${contexto.incubadoraId}/` +
          `${contexto.dispositivoId} (${medicion.variable})`
      );
    } catch (error) {
      console.error(
        `[iot-integration-service] Error al procesar ` +
          `la medición de ${contexto.incubadoraId}/` +
          `${contexto.dispositivoId} (${medicion.variable}):`,
        error.message
      );
    }
  }
}

// =========================================================
// Conexión MQTT
// =========================================================

/**
 * Conecta al broker MQTT, se suscribe a los tópicos relevantes
 * y delega cada mensaje entrante a "onMensaje".
 *
 * @param {(topico: string, payload: Object) => void} [onMensaje]
 * @returns {import("mqtt").MqttClient}
 */
function conectar(
  onMensaje = manejarMensajeProduccion
) {
  if (
    !MQTT_HOST ||
    !MQTT_USERNAME ||
    !MQTT_PASSWORD
  ) {
    console.error(
      "[iot-integration-service] Faltan variables de entorno " +
        "obligatorias (MQTT_HOST, MQTT_USERNAME, MQTT_PASSWORD). " +
        "Copiá .env.example a .env y completalo con las " +
        "credenciales del cluster."
    );

    process.exit(1);
  }

  const cliente = conectarCliente({
    host: MQTT_HOST,
    puerto: MQTT_PORT,
    usuario: MQTT_USERNAME,
    contrasena: MQTT_PASSWORD,
    clientIdPrefijo:
      "mtpa-iot-integration-service",
  });

  cliente.on("connect", () => {
    console.log(
      `[iot-integration-service] Conectado a ` +
        `${MQTT_HOST}:${MQTT_PORT}`
    );

    cliente.subscribe(
      [
        TOPICO_MEDICIONES,
        TOPICO_ESTADO_VENTILADORES,
        TOPICO_LATIDO,
      ],
      (error) => {
        if (error) {
          console.error(
            "[iot-integration-service] Error al suscribirse:",
            error
          );

          return;
        }

        console.log(
          `[iot-integration-service] Suscripto a ` +
            `"${TOPICO_MEDICIONES}", ` +
            `"${TOPICO_ESTADO_VENTILADORES}" y ` +
            `"${TOPICO_LATIDO}"`
        );
      }
    );
  });

  cliente.on("reconnect", () => {
    console.warn(
      "[iot-integration-service] " +
        "Reconectando al broker MQTT..."
    );
  });

  cliente.on("close", () => {
    console.warn(
      "[iot-integration-service] " +
        "Conexión con el broker cerrada."
    );
  });

  cliente.on("error", (error) => {
    console.error(
      "[iot-integration-service] " +
        "Error de conexión MQTT:",
      error.message
    );
  });

  cliente.on(
    "message",
    async (topico, payloadBuffer) => {
      const payloadCrudo =
        payloadBuffer.toString();

      let payload;

      try {
        payload = JSON.parse(payloadCrudo);
      } catch (error) {
        console.warn(
          `[iot-integration-service] Mensaje en ` +
            `"${topico}" no es JSON válido, ` +
            "se ignora:",
          payloadCrudo
        );

        return;
      }

      try {
        await onMensaje(topico, payload);
      } catch (error) {
        console.error(
          "[iot-integration-service] Error en handler:",
          error
        );
      }
    }
  );

  return cliente;
}

// =========================================================
// LISTENER DE ÓRDENES DE VENTILADOR
// =========================================================
//
// Esta función es independiente de conectar().
//
// Escucha:
//
//   ordenes_ventilador
//
// solamente cuando:
//
//   estado == "pendiente"
//
// Por cada orden pendiente (ver procesarOrdenPendiente):
//
//   1. La reclama en una transacción (pendiente -> enviando).
//   2. Valida los datos y descarta las órdenes vencidas.
//   3. Construye el tópico MQTT.
//   4. La pasa a "enviada" y publica el comando (o la pasa a
//      "fallida"). "enviada" se escribe antes de publicar para que
//      una confirmación inmediata del dispositivo la encuentre.
//
// Si MQTT no está conectado la orden queda "pendiente" y se
// vuelve a revisar en cada (re)conexión.
//
// =========================================================

function escucharOrdenesPendientes(cliente) {
  if (!cliente) {
    throw new Error(
      "Se necesita un cliente MQTT para escuchar órdenes pendientes."
    );
  }

  console.log(
    "[iot-integration-service] Iniciando listener de " +
      "ordenes_ventilador..."
  );

  const consulta = db
    .collection("ordenes_ventilador")
    .where("estado", "==", ESTADO_ORDEN.PENDIENTE);

  // Al (re)conectar se revisan las órdenes que quedaron
  // pendientes mientras MQTT no estaba disponible.
  const revisarPendientes = async () => {
    try {
      const snapshot = await consulta.get();

      snapshot.docs.forEach((doc) => {
        procesarOrdenPendiente(doc, cliente);
      });
    } catch (error) {
      console.error(
        "[iot-integration-service] Error revisando " +
          "ordenes_ventilador pendientes:",
        error
      );
    }
  };

  cliente.on("connect", revisarPendientes);

  const cancelarSnapshot = consulta.onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        // Solo procesamos documentos que aparecen como nuevos.
        if (change.type !== "added") {
          return;
        }

        procesarOrdenPendiente(change.doc, cliente);
      });
    },
    (error) => {
      console.error(
        "[iot-integration-service] Error escuchando " +
          "ordenes_ventilador:",
        error
      );
    }
  );

  return () => {
    cancelarSnapshot();
    cliente.removeListener("connect", revisarPendientes);
  };
}

// =========================================================
// ESTADO DE LAS ÓRDENES
// =========================================================
//
// Vocabulario documentado en docs/modelo-datos.md (basado en
// COMMAND_STATUS de frontend/src/utils/constants.js).
//
// =========================================================

const ESTADO_ORDEN = {
  PENDIENTE: "pendiente",
  ENVIANDO: "enviando",
  ENVIADA: "enviada",
  FALLIDA: "fallida",
  EXPIRADA: "expirada",
  EJECUTADA: "ejecutada",
};

const ACCIONES_VALIDAS = ["encender", "apagar"];

// Valores de FAN_STATUS (frontend/src/utils/constants.js).
const ESTADO_VENTILADOR = {
  ENCENDIDO: "encendido",
  APAGADO: "apagado",
};

// Estado en que debe quedar el ventilador para dar por cumplida cada acción.
const ESTADO_ESPERADO_POR_ACCION = {
  encender: ESTADO_VENTILADOR.ENCENDIDO,
  apagar: ESTADO_VENTILADOR.APAGADO,
};

// Cuántas órdenes recientes del ventilador se miran para correlacionar.
const ORDENES_A_CORRELACIONAR = 10;

// Un id que se usa como segmento de tópico no puede traer
// separadores ni comodines MQTT.
const SEGMENTO_TOPICO_RE = /^[^/+#\s]+$/;

/**
 * Comprueba que la orden tenga todo lo necesario para publicar
 * el comando.
 *
 * @param {Object} orden
 * @returns {string|null} Motivo del rechazo, o null si es válida.
 */
function validarOrden(orden) {
  if (!orden || typeof orden !== "object") {
    return "La orden no tiene datos.";
  }

  if (
    typeof orden.incubadoraId !== "string" ||
    !SEGMENTO_TOPICO_RE.test(orden.incubadoraId)
  ) {
    return "La orden no tiene un incubadoraId válido.";
  }

  if (
    typeof orden.dispositivoId !== "string" ||
    !SEGMENTO_TOPICO_RE.test(orden.dispositivoId)
  ) {
    return "La orden no tiene un dispositivoId válido.";
  }

  if (!ACCIONES_VALIDAS.includes(orden.accionSolicitada)) {
    return (
      'accionSolicitada debe ser "encender" o "apagar" ' +
      `(recibido: ${JSON.stringify(orden.accionSolicitada)}).`
    );
  }

  // Sin fecha de creación no se puede saber si la orden venció.
  if (
    !orden.creadaEn ||
    typeof orden.creadaEn.toMillis !== "function"
  ) {
    return "La orden no tiene una fecha de creación (creadaEn) válida.";
  }

  return null;
}

/**
 * Cambia el estado de una orden y registra cuándo.
 *
 * @param {FirebaseFirestore.DocumentReference} ordenRef
 * @param {string} estado
 * @param {Object} [campos] Campos adicionales a escribir.
 * @returns {Promise<void>}
 */
async function marcarOrden(ordenRef, estado, campos = {}) {
  await ordenRef.update({
    ...campos,
    estado,
    actualizadaEn: FieldValue.serverTimestamp(),
  });
}

/**
 * Marca una orden como fallida guardando el motivo. Nunca lanza:
 * si Firestore también falla, solo se loguea.
 *
 * @param {FirebaseFirestore.DocumentReference} ordenRef
 * @param {string} motivo
 * @param {string} [desde] Si se indica, la orden solo pasa a fallida
 * (en una transacción) si todavía está en ese estado; así no pisa una
 * orden que otro proceso ya cerró.
 * @returns {Promise<void>}
 */
async function marcarOrdenFallida(ordenRef, motivo, desde = null) {
  try {
    if (desde) {
      const orden = await transicionarOrden(
        ordenRef,
        desde,
        ESTADO_ORDEN.FALLIDA,
        { error: motivo }
      );

      if (!orden) {
        console.warn(
          `[iot-integration-service] La orden ${ordenRef.id} ya no ` +
            `estaba en "${desde}"; no se marca fallida.`
        );

        return;
      }
    } else {
      await marcarOrden(ordenRef, ESTADO_ORDEN.FALLIDA, {
        error: motivo,
      });
    }

    console.error(
      `[iot-integration-service] Orden ${ordenRef.id} fallida: ` +
        motivo
    );
  } catch (error) {
    console.error(
      `[iot-integration-service] No se pudo marcar la orden ` +
        `${ordenRef.id} como fallida (${motivo}):`,
      error
    );
  }
}

/**
 * Cambia el estado de una orden dentro de una transacción, solo
 * si todavía está en el estado "desde". Es lo que garantiza que
 * dos instancias del servicio (o un snapshot repetido) no
 * reclamen la misma orden dos veces.
 *
 * @param {FirebaseFirestore.DocumentReference} ordenRef
 * @param {string} desde Estado esperado.
 * @param {string} hasta Estado nuevo.
 * @param {Object} [campos] Campos adicionales a escribir.
 * @returns {Promise<Object|null>} Datos de la orden si se hizo el
 * cambio, o null si ya no estaba en el estado esperado.
 */
function transicionarOrden(ordenRef, desde, hasta, campos = {}) {
  return db.runTransaction(async (transaccion) => {
    const snapshot = await transaccion.get(ordenRef);

    if (!snapshot.exists || snapshot.data().estado !== desde) {
      return null;
    }

    transaccion.update(ordenRef, {
      ...campos,
      estado: hasta,
      actualizadaEn: FieldValue.serverTimestamp(),
    });

    return snapshot.data();
  });
}

// =========================================================
// CONFIRMACIÓN DEL ESTADO DEL VENTILADOR
// =========================================================
//
// Cuando el ventilador publica su estado en ".../estado" (ver
// docs/contrato-mqtt.md), el servicio:
//
//   1. Actualiza "ventiladores/{dispositivoId}" (estadoActual).
//   2. Si hay una orden "enviada" cuya acción coincide con ese
//      estado, la cierra como "ejecutada".
//
// El mensaje no trae "ordenId": se correlaciona con la orden
// "enviada" más reciente del ventilador cuya acción coincide con el
// estado reportado. Los mensajes de un mismo ventilador se procesan
// de a uno. Las órdenes "enviada" que nadie confirma las marca
// "fallida" el barrido periódico (barrerOrdenesEnviadas), que
// también cubre el caso de un reinicio del servicio.
//
// =========================================================

// Un id que se usa como id de documento: sin separadores ni
// comodines, y sin los valores que Firestore reserva.
function esIdDeDocumentoValido(id) {
  return (
    typeof id === "string" &&
    id.length <= 128 &&
    SEGMENTO_TOPICO_RE.test(id) &&
    id !== "." &&
    id !== ".." &&
    !/^__.*__$/.test(id)
  );
}

/**
 * Valida el payload de estado de un ventilador y lo traduce al
 * vocabulario de FAN_STATUS.
 *
 * @param {{incubadoraId: string, dispositivoId: string}} contexto
 * @param {Object} payload
 * @returns {{valido: boolean, razon?: string, estado?: string}}
 */
function validarEstadoVentilador(contexto, payload) {
  if (
    !esIdDeDocumentoValido(contexto.incubadoraId) ||
    !esIdDeDocumentoValido(contexto.dispositivoId)
  ) {
    return {
      valido: false,
      razon:
        "La incubadora o el ventilador del tópico no son ids válidos.",
    };
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return {
      valido: false,
      razon: "El payload debe ser un objeto JSON.",
    };
  }

  // Si el payload declara otro origen, el estado no es confiable.
  if (
    (payload.incubadoraId !== undefined &&
      payload.incubadoraId !== contexto.incubadoraId) ||
    (payload.dispositivoId !== undefined &&
      payload.dispositivoId !== contexto.dispositivoId)
  ) {
    return {
      valido: false,
      razon:
        "El origen del payload no coincide con el del tópico.",
    };
  }

  if (typeof payload.encendido !== "boolean") {
    return {
      valido: false,
      razon: "encendido debe ser booleano.",
    };
  }

  return {
    valido: true,
    estado: payload.encendido
      ? ESTADO_VENTILADOR.ENCENDIDO
      : ESTADO_VENTILADOR.APAGADO,
  };
}

// dispositivoId -> última tarea de estado encolada (nunca rechaza).
const colasDeEstado = new Map();

/**
 * Ejecuta las tareas de un mismo ventilador una tras otra, en el orden
 * en que llegaron: así un "update" lento de un reporte no pisa a uno
 * posterior. Un error en una tarea se devuelve a quien la encoló pero
 * no corta la cadena. La entrada se borra cuando la cadena se vacía.
 *
 * @param {string} clave
 * @param {() => Promise<void>} tarea
 * @returns {Promise<void>}
 */
function encolarPorVentilador(clave, tarea) {
  const previa = colasDeEstado.get(clave) || Promise.resolve();
  const resultado = previa.then(tarea);
  const cola = resultado.catch(() => {});

  colasDeEstado.set(clave, cola);

  cola.then(() => {
    if (colasDeEstado.get(clave) === cola) {
      colasDeEstado.delete(clave);
    }
  });

  return resultado;
}

/**
 * Procesa el estado que reporta un ventilador, de a un mensaje por
 * ventilador (ver encolarPorVentilador).
 *
 * @param {{incubadoraId: string, dispositivoId: string}} contexto
 * @param {Object} payload
 * @returns {Promise<void>}
 */
function manejarEstadoVentilador(contexto, payload) {
  // El documento que se escribe es ventiladores/{dispositivoId}.
  return encolarPorVentilador(contexto.dispositivoId, () =>
    procesarEstadoVentilador(contexto, payload)
  );
}

/**
 * Procesa el estado que reporta un ventilador: actualiza
 * "ventiladores/{dispositivoId}" y cierra la orden en curso si el
 * estado reportado es el que pedía.
 *
 * Si el ventilador no existe en Firestore, lo registra y no lo crea.
 *
 * @param {{incubadoraId: string, dispositivoId: string}} contexto
 * @param {Object} payload
 * @returns {Promise<void>}
 */
async function procesarEstadoVentilador(contexto, payload) {
  const { incubadoraId, dispositivoId } = contexto;

  const validacion = validarEstadoVentilador(contexto, payload);

  if (!validacion.valido) {
    console.error(
      `[iot-integration-service] Estado de ventilador rechazado ` +
        `(${incubadoraId}/${dispositivoId}): ${validacion.razon}`
    );

    return;
  }

  const estado = validacion.estado;
  const ventiladorRef = db
    .collection("ventiladores")
    .doc(dispositivoId);

  // El documento lo crea crearDispositivo: aquí solo se actualiza.
  const ventilador = await ventiladorRef.get();

  if (!ventilador.exists) {
    console.warn(
      `[iot-integration-service] Estado ignorado: el ventilador ` +
        `${dispositivoId} no existe en "ventiladores".`
    );

    return;
  }

  if (ventilador.data().incubadoraId !== incubadoraId) {
    console.error(
      `[iot-integration-service] Estado rechazado: el ventilador ` +
        `${dispositivoId} no pertenece a la incubadora ` +
        `"${incubadoraId}" del tópico.`
    );

    return;
  }

  await ventiladorRef.update({
    estadoActual: estado,
    actualizadoEn: FieldValue.serverTimestamp(),
  });

  console.log(
    `[iot-integration-service] Ventilador ${dispositivoId} ` +
      `actualizado a "${estado}".`
  );

  // Cerrar la orden no puede impedir que el estado ya quede guardado.
  try {
    await cerrarOrdenEnCurso(dispositivoId, estado);
  } catch (error) {
    console.error(
      `[iot-integration-service] No se pudo cerrar la orden en ` +
        `curso del ventilador ${dispositivoId}:`,
      error
    );
  }
}

/**
 * Busca la orden "enviada" más reciente del ventilador cuya acción
 * coincida con el estado reportado y la marca "ejecutada". Si no hay
 * ninguna (reporte espontáneo, o el estado no es el que pedía ninguna
 * orden en vuelo), no toca nada.
 *
 * Mira las últimas ORDENES_A_CORRELACIONAR órdenes del ventilador:
 * usa el índice existente (ventiladorId + creadaEn desc) y filtra el
 * estado y la acción en memoria.
 *
 * @param {string} ventiladorId
 * @param {string} estado Estado reportado ("encendido" o "apagado").
 * @returns {Promise<void>}
 */
async function cerrarOrdenEnCurso(ventiladorId, estado) {
  const snapshot = await db
    .collection("ordenes_ventilador")
    .where("ventiladorId", "==", ventiladorId)
    .orderBy("creadaEn", "desc")
    .limit(ORDENES_A_CORRELACIONAR)
    .get();

  const enviadas = snapshot.docs.filter(
    (doc) => doc.data().estado === ESTADO_ORDEN.ENVIADA
  );

  if (enviadas.length === 0) {
    return;
  }

  const ordenDoc = enviadas.find(
    (doc) =>
      ESTADO_ESPERADO_POR_ACCION[doc.data().accionSolicitada] === estado
  );

  if (!ordenDoc) {
    console.warn(
      `[iot-integration-service] El ventilador ${ventiladorId} ` +
        `reportó "${estado}", pero ninguna orden enviada lo pedía: ` +
        "siguen enviadas."
    );

    return;
  }

  // Con precondición: no pisa una orden que el barrido ya marcó fallida.
  const orden = await transicionarOrden(
    ordenDoc.ref,
    ESTADO_ORDEN.ENVIADA,
    ESTADO_ORDEN.EJECUTADA,
    { ejecutadaEn: FieldValue.serverTimestamp() }
  );

  if (!orden) {
    console.warn(
      `[iot-integration-service] La orden ${ordenDoc.id} ya no ` +
        "estaba enviada; no se marca ejecutada."
    );

    return;
  }

  console.log(
    `[iot-integration-service] Orden ${ordenDoc.id} ejecutada ` +
      `(ventilador ${ventiladorId} "${estado}").`
  );
}

// =========================================================
// BARRIDO DE ÓRDENES SIN CONFIRMAR
// =========================================================

/**
 * Milisegundos de una marca de tiempo de Firestore, o null.
 *
 * @param {*} marca
 * @returns {number|null}
 */
function milisegundosDe(marca) {
  return marca && typeof marca.toMillis === "function"
    ? marca.toMillis()
    : null;
}

/**
 * Marca "fallida" cada orden "enviada" que lleva más de
 * ORDEN_CONFIRMACION_TIMEOUT_MS sin confirmarse. Una sola consulta
 * por ciclo. Cada orden se cierra con precondición, así que una
 * confirmación que llegue en el mismo momento gana si fue primera.
 *
 * La antigüedad se cuenta desde "enviadaEn"; si falta, desde
 * "actualizadaEn" y luego "creadaEn". Sin ninguna fecha no se puede
 * saber su antigüedad y la orden se deja como está.
 *
 * @returns {Promise<number>} Cantidad de órdenes marcadas fallidas.
 */
async function barrerOrdenesEnviadas() {
  const snapshot = await db
    .collection("ordenes_ventilador")
    .where("estado", "==", ESTADO_ORDEN.ENVIADA)
    .get();

  const ahora = Date.now();
  let vencidas = 0;

  for (const doc of snapshot.docs) {
    const datos = doc.data();

    const desde =
      milisegundosDe(datos.enviadaEn) ??
      milisegundosDe(datos.actualizadaEn) ??
      milisegundosDe(datos.creadaEn);

    if (desde === null || ahora - desde <= ORDEN_CONFIRMACION_TIMEOUT_MS) {
      continue;
    }

    const motivo =
      "El dispositivo no confirmó el estado en " +
      `${ORDEN_CONFIRMACION_TIMEOUT_MS / 1000} s.`;

    try {
      const orden = await transicionarOrden(
        doc.ref,
        ESTADO_ORDEN.ENVIADA,
        ESTADO_ORDEN.FALLIDA,
        { error: motivo }
      );

      // null: otra confirmación o instancia la cerró primero.
      if (orden) {
        vencidas += 1;

        console.error(
          `[iot-integration-service] Orden ${doc.id} fallida: ` +
            motivo
        );
      }
    } catch (error) {
      console.error(
        `[iot-integration-service] No se pudo marcar la orden ` +
          `${doc.id} como fallida:`,
        error
      );
    }
  }

  return vencidas;
}

/**
 * Arranca el barrido periódico de órdenes "enviada" sin confirmar
 * (uno inmediato y luego uno cada BARRIDO_ORDENES_INTERVALO_MS). Un
 * error en un ciclo se registra y no detiene el servicio.
 *
 * @returns {() => void} Función que detiene el barrido.
 */
function iniciarBarridoOrdenes() {
  let barriendo = false;

  const ciclo = async () => {
    // Si el ciclo anterior sigue en curso, se salta este.
    if (barriendo) {
      return;
    }

    barriendo = true;

    try {
      await barrerOrdenesEnviadas();
    } catch (error) {
      console.error(
        "[iot-integration-service] Error en el barrido de " +
          "órdenes enviadas:",
        error
      );
    } finally {
      barriendo = false;
    }
  };

  ciclo();

  const temporizador = setInterval(
    ciclo,
    BARRIDO_ORDENES_INTERVALO_MS
  );

  // No mantiene vivo el proceso por sí solo.
  if (typeof temporizador.unref === "function") {
    temporizador.unref();
  }

  return () => clearInterval(temporizador);
}

// =========================================================
// PROCESAR UNA ORDEN PENDIENTE
// =========================================================

async function procesarOrdenPendiente(ordenDoc, cliente) {
  const ordenRef = ordenDoc.ref;
  const ordenId = ordenDoc.id;

  // -------------------------------------------------------
  // Verificar conexión MQTT
  // -------------------------------------------------------
  //
  // Sin conexión no se toca la orden: queda "pendiente" y se
  // revisa de nuevo en la próxima conexión.
  //

  if (!cliente.connected) {
    console.warn(
      `[iot-integration-service] MQTT no está conectado. ` +
        `La orden ${ordenId} permanece pendiente.`
    );
    return;
  }

  // -------------------------------------------------------
  // Reclamar la orden (pendiente -> enviando)
  // -------------------------------------------------------

  let orden;

  try {
    orden = await transicionarOrden(
      ordenRef,
      ESTADO_ORDEN.PENDIENTE,
      ESTADO_ORDEN.ENVIANDO
    );
  } catch (error) {
    console.error(
      `[iot-integration-service] No se pudo reclamar la ` +
        `orden ${ordenId}:`,
      error
    );
    return;
  }

  if (!orden) {
    // Otra instancia (o un snapshot anterior) ya la tomó.
    return;
  }

  try {
    await enviarOrdenReclamada(ordenRef, orden, cliente);
  } catch (error) {
    // Un error inesperado ocurre antes de escribir "enviada"; con la
    // precondición no se pisa una orden que otro proceso ya cerró.
    await marcarOrdenFallida(
      ordenRef,
      `Error inesperado: ${error.message}`,
      ESTADO_ORDEN.ENVIANDO
    );
  }
}

/**
 * Valida, descarta si venció y publica una orden que esta
 * instancia ya reclamó (estado "enviando").
 *
 * @param {FirebaseFirestore.DocumentReference} ordenRef
 * @param {Object} orden Datos de la orden reclamada.
 * @param {import("mqtt").MqttClient} cliente
 * @returns {Promise<void>}
 */
async function enviarOrdenReclamada(ordenRef, orden, cliente) {
  const ordenId = ordenRef.id;

  // -------------------------------------------------------
  // Validar datos necesarios
  // -------------------------------------------------------

  const problema = validarOrden(orden);

  if (problema) {
    await marcarOrdenFallida(ordenRef, problema);
    return;
  }

  // -------------------------------------------------------
  // Descartar órdenes vencidas
  // -------------------------------------------------------

  const antiguedadMs = Date.now() - orden.creadaEn.toMillis();

  if (antiguedadMs > ORDEN_MAX_ANTIGUEDAD_MS) {
    const motivo =
      `La orden venció: tiene ${Math.round(antiguedadMs / 1000)} s ` +
      `y el máximo es ${ORDEN_MAX_ANTIGUEDAD_MS / 1000} s.`;

    console.warn(
      `[iot-integration-service] Orden ${ordenId} expirada. ` +
        motivo
    );

    await marcarOrden(ordenRef, ESTADO_ORDEN.EXPIRADA, {
      error: motivo,
    });
    return;
  }

  // -------------------------------------------------------
  // Reconfirmar la conexión MQTT
  // -------------------------------------------------------
  //
  // Si se cayó mientras se reclamaba la orden, se devuelve a
  // "pendiente": el cliente MQTT encolaría la publicación y la
  // entregaría recién al reconectar, quizás tarde.
  //

  if (!cliente.connected) {
    console.warn(
      `[iot-integration-service] MQTT se desconectó. ` +
        `La orden ${ordenId} vuelve a pendiente.`
    );

    await marcarOrden(ordenRef, ESTADO_ORDEN.PENDIENTE);
    return;
  }

  // -------------------------------------------------------
  // Construir tópico y payload
  // -------------------------------------------------------
  //
  // Formato definido en docs/contrato-mqtt.md: el dispositivo
  // (y el simulador) leen "accion".
  //

  const topico =
    `${MQTT_TOPIC_PREFIX}/` +
    `${orden.incubadoraId}/` +
    `ventiladores/` +
    `${orden.dispositivoId}/` +
    `comando`;

  const payload = JSON.stringify({
    accion: orden.accionSolicitada,
    ordenId,
    solicitadoEn: new Date(orden.creadaEn.toMillis()).toISOString(),
  });

  // -------------------------------------------------------
  // Marcar la orden como enviada (antes de publicar)
  // -------------------------------------------------------
  //
  // Se escribe "enviada" ANTES de publicar: el dispositivo puede
  // responder en milisegundos y su estado se correlaciona con las
  // órdenes "enviada" (ver cerrarOrdenEnCurso); si la escritura
  // llegara después, la confirmación no encontraría la orden y el
  // barrido la daría por fallida. "enviada" significa entonces que el
  // servicio está por publicar el comando (o ya lo publicó), no que
  // se haya entregado.
  //
  // Si esta escritura falla no se publica: la orden pasa a "fallida"
  // con el motivo. Si el proceso muere entre esta escritura y la
  // publicación, la orden queda "enviada" y el barrido la cierra como
  // fallida: el servicio no vuelve a publicar una orden.
  //

  let enviada;

  try {
    enviada = await transicionarOrden(
      ordenRef,
      ESTADO_ORDEN.ENVIANDO,
      ESTADO_ORDEN.ENVIADA,
      { enviadaEn: FieldValue.serverTimestamp() }
    );
  } catch (error) {
    await marcarOrdenFallida(
      ordenRef,
      `No se pudo marcar la orden como enviada: ${error.message}`,
      ESTADO_ORDEN.ENVIANDO
    );
    return;
  }

  if (!enviada) {
    // Ya no estaba "enviando" (por ejemplo, otro proceso la cerró).
    console.warn(
      `[iot-integration-service] La orden ${ordenId} ya no estaba ` +
        'en "enviando"; no se publica.'
    );
    return;
  }

  // -------------------------------------------------------
  // Publicar comando
  // -------------------------------------------------------
  //
  // La escritura de "enviada" pudo tardar y la conexión caerse
  // mientras tanto. Publicar sin conexión no falla: el cliente MQTT
  // guarda el paquete y lo entrega al reconectar, sin vencimiento,
  // cuando la orden ya figura fallida y quizás vencida. Por eso se
  // vuelve a comprobar aquí, sin ningún "await" entre el chequeo y la
  // llamada a publish.
  //

  if (!cliente.connected) {
    await marcarOrdenFallida(
      ordenRef,
      "Se perdió la conexión con el broker antes de publicar el comando",
      ESTADO_ORDEN.ENVIADA
    );
    return;
  }

  try {
    await publicarMensaje(cliente, topico, payload);
  } catch (error) {
    await marcarOrdenFallida(
      ordenRef,
      `No se pudo publicar el comando: ${error.message}`,
      ESTADO_ORDEN.ENVIADA
    );
    return;
  }

  console.log(
    `[iot-integration-service] Orden ${ordenId} publicada ` +
      `en "${topico}".`
  );
}

// =========================================================
// PUBLICAR MENSAJE MQTT
// =========================================================

function publicarMensaje(cliente, topico, payload) {
  return new Promise((resolve, reject) => {
    cliente.publish(
      topico,
      payload,
      { qos: 1 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      }
    );
  });
}

// =========================================================
// Ejecución directa
// =========================================================

if (require.main === module) {
  const cliente = conectar(
    manejarMensajeProduccion
  );

  const unsubscribeOrdenes = escucharOrdenesPendientes(cliente);

  // Cierra como fallidas las órdenes enviadas que nadie confirmó.
  const detenerBarridoOrdenes = iniciarBarridoOrdenes();

  // Detección de dispositivos desconectados (no rechaza).
  rastreadorConexion.iniciar();

  function cerrar() {
    console.log(
      "[iot-integration-service] " +
        "Cerrando conexión MQTT..."
    );

    // Detener el listener de Firestore.
    unsubscribeOrdenes();

    // Detener el barrido de órdenes sin confirmar.
    detenerBarridoOrdenes();

    // Detener el watchdog de conexión.
    rastreadorConexion.detener();

    cliente.end(
      false,
      () => process.exit(0)
    );
  }

  process.on("SIGINT", cerrar);
  process.on("SIGTERM", cerrar);
}

// =========================================================
// Exports
// =========================================================

module.exports = {
  conectar,
  escucharOrdenesPendientes,
  iniciarBarridoOrdenes,
  barrerOrdenesEnviadas,
  manejarMensajeProduccion,
  validarMedicion,
  invocarProcesarMedicion,
};