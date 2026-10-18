"use strict";

// =========================================================
// M.T.P.A. - Servicio de Integración IoT
// lib/estado-conexion.js — detección de dispositivos desconectados
// =========================================================
//
// Un dispositivo que publica un latido o una medición está vivo.
// Si pasa más de LATIDO_TIMEOUT_SEGUNDOS (30 s por defecto, ver
// docs/contrato-mqtt.md) sin ninguna de las dos señales, se marca
// "estadoConexion: desconectado" en "dispositivos/{dispositivoId}".
//
// Para no agotar la cuota gratuita de Firestore NO se escribe en
// cada latido: el estado vive en memoria y solo se escribe
//
//   - al pasar a "conectado" (primera señal, o tras una caída),
//   - para refrescar "ultimaComunicacionEn" cada
//     LATIDO_REFRESCO_SEGUNDOS mientras sigue conectado,
//   - al pasar a "desconectado" (una sola vez por caída).
//
// Al marcar "desconectado" se crea además una alerta
// "dispositivo_desconectado" en "alertas" (la Cloud Function
// notificarAlerta envía el correo al crearse). No se crea otra
// mientras haya una abierta del mismo dispositivo. La alerta se
// resuelve cuando el dispositivo lleva conectado de forma estable
// LATIDO_ESTABILIDAD_SEGUNDOS (60 s por defecto): así un dispositivo
// con conexión intermitente no abre y cierra alertas (y correos) en
// cada intermitencia. Los latidos NO consultan Firestore: la revisión
// la hace el watchdog.
//
// Limitación: la detección corre dentro del Servicio de
// Integración. Si el servicio está caído nadie marca dispositivos
// como desconectados.
//
// =========================================================

const PREFIJO_LOG = "[iot-integration-service]";

const COLECCION_DISPOSITIVOS = "dispositivos";
const COLECCION_ALERTAS = "alertas";

const CONECTADO = "conectado";
const DESCONECTADO = "desconectado";
const DESCONOCIDO = "desconocido";

// Debe coincidir con ALERT_TYPES.DEVICE_DISCONNECTED y ALERT_STATUS de
// frontend/src/utils/constants.js.
const TIPO_ALERTA_DESCONEXION = "dispositivo_desconectado";
const ESTADOS_ALERTA_ABIERTA = ["activa", "reconocida"];

const VALORES_POR_DEFECTO = {
  timeoutSegundos: 30,
  revisionSegundos: 5,
  refrescoSegundos: 60,
  estabilidadSegundos: 60,
};

// Tiempo que se recuerda un dispositivo que no existe en Firestore
// antes de volver a intentar escribirle (y volver a avisar).
const DESCONOCIDO_RETENCION_MS = 10 * 60 * 1000;

const ID_PROHIBIDO_RE = /[\s/+#]/;

/**
 * Indica si el id proveniente del tópico sirve como id de documento.
 *
 * @param {*} dispositivoId
 * @returns {boolean}
 */
function esIdValido(dispositivoId) {
  return (
    typeof dispositivoId === "string" &&
    dispositivoId.length > 0 &&
    dispositivoId.length <= 128 &&
    !ID_PROHIBIDO_RE.test(dispositivoId) &&
    dispositivoId !== "." &&
    dispositivoId !== ".." &&
    !/^__.*__$/.test(dispositivoId)
  );
}

/**
 * Usa el valor configurado si es un número positivo; si no, el
 * valor por defecto.
 *
 * @param {*} valor
 * @param {number} porDefecto
 * @returns {number}
 */
function segundosValidos(valor, porDefecto) {
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
}

/**
 * Indica si un error de Firestore es "el documento no existe".
 *
 * @param {Object} error
 * @returns {boolean}
 */
function esNoEncontrado(error) {
  return (
    Boolean(error) &&
    (error.code === 5 ||
      error.code === "not-found" ||
      /NOT_FOUND/.test(String(error.message)))
  );
}

/**
 * Crea el rastreador de conexión de dispositivos.
 *
 * @param {Object} opciones
 * @param {import("firebase-admin").firestore.Firestore} opciones.db
 * @param {() => number} [opciones.ahora] Reloj en ms (inyectable en tests).
 * @param {Object} [opciones.config]
 * @param {number} [opciones.config.timeoutSegundos]
 * @param {number} [opciones.config.revisionSegundos]
 * @param {number} [opciones.config.refrescoSegundos]
 * @param {number} [opciones.config.estabilidadSegundos] Tiempo conectado
 *   sin cortes tras el cual se resuelve la alerta de desconexión.
 * @param {Object} [opciones.logger] Con log, warn y error.
 * @param {Object} [opciones.FieldValue] FieldValue de Firestore Admin.
 * @param {Object} [opciones.Timestamp] Timestamp de Firestore Admin
 *   (si no se inyecta, se carga de firebase-admin al crear una alerta).
 * @returns {{
 *   iniciar: () => Promise<void>,
 *   detener: () => void,
 *   registrarSenalDeVida: (dispositivoId: string, origen?: string, contexto?: {incubadoraId?: string}) => Promise<void>,
 *   revisarTimeouts: () => Promise<void>,
 *   cargarEstadoInicial: () => Promise<void>
 * }}
 */
function crearRastreadorConexion({
  db,
  ahora = () => Date.now(),
  config = {},
  logger = console,
  FieldValue = require("firebase-admin/firestore").FieldValue,
  Timestamp = null,
}) {
  const timeoutMs =
    segundosValidos(config.timeoutSegundos, VALORES_POR_DEFECTO.timeoutSegundos) *
    1000;

  const revisionMs =
    segundosValidos(config.revisionSegundos, VALORES_POR_DEFECTO.revisionSegundos) *
    1000;

  const refrescoMs =
    segundosValidos(config.refrescoSegundos, VALORES_POR_DEFECTO.refrescoSegundos) *
    1000;

  const estabilidadMs =
    segundosValidos(
      config.estabilidadSegundos,
      VALORES_POR_DEFECTO.estabilidadSegundos
    ) * 1000;

  // dispositivoId -> { ultimaSenal, estado, ultimoRefresco, cola,
  //   incubadoraId, conectadoDesde, revisarAlerta, ... }
  // "cola" encadena las escrituras del dispositivo para que lleguen
  // a Firestore en el mismo orden en que se decidieron.
  // "revisarAlerta" indica que puede haber una alerta de desconexión
  // abierta por resolver (arranca en true y vuelve a true al
  // desconectarse); "conectadoDesde" es el momento en que pasó a
  // "conectado". La estabilidad se mide con las señales realmente
  // recibidas (ultimaSenal - conectadoDesde), no con el reloj: el
  // dispositivo sigue "conectado" hasta 30 s después de su última señal
  // y ese margen no cuenta como tiempo estable.
  const dispositivos = new Map();

  // dispositivoId -> ms hasta el que se ignora (no existe en Firestore).
  const desconocidos = new Map();

  let temporizador = null;
  let activo = false;

  function encolar(entrada, tarea) {
    entrada.cola = entrada.cola.then(tarea, tarea);

    return entrada.cola;
  }

  function crearEntrada({ ultimaSenal, estado, ultimoRefresco, incubadoraId }) {
    return {
      ultimaSenal,
      estado,
      ultimoRefresco,
      cola: Promise.resolve(),
      incubadoraId: idIncubadoraValido(incubadoraId) ? incubadoraId : null,
      conectadoDesde: ultimaSenal,
      revisarAlerta: true,
      resolviendo: false,
      avisoSinIncubadora: false,
      falloResolucionLogueado: false,
      alertaPendiente: false,
      reintentando: false,
      falloAlertaLogueado: false,
      ultimaSenalCaida: null,
    };
  }

  function idIncubadoraValido(incubadoraId) {
    return typeof incubadoraId === "string" && incubadoraId.length > 0;
  }

  function obtenerTimestamp() {
    return Timestamp || require("firebase-admin/firestore").Timestamp;
  }

  /**
   * Alertas abiertas de desconexión de un dispositivo. Solo usa
   * filtros de igualdad (no requiere índice compuesto).
   */
  function consultarAlertasAbiertas(dispositivoId, limite) {
    let consulta = db
      .collection(COLECCION_ALERTAS)
      .where("dispositivoId", "==", dispositivoId)
      .where("tipo", "==", TIPO_ALERTA_DESCONEXION)
      .where("estado", "in", ESTADOS_ALERTA_ABIERTA);

    if (limite) {
      consulta = consulta.limit(limite);
    }

    return consulta.get();
  }

  /**
   * Crea la alerta de desconexión si el dispositivo no tiene ya una
   * abierta. Nunca lanza: un fallo se registra (una sola vez mientras
   * siga fallando) y no afecta al estado de conexión ya escrito.
   *
   * @param {string} dispositivoId
   * @param {Object} entrada
   * @param {number} ultimaSenal ms de la última señal vista.
   * @returns {Promise<boolean>} true si la alerta quedó creada o ya
   *   existía (o no hay nada que reintentar porque se desconoce la
   *   incubadora); false si falló y conviene reintentar.
   */
  async function crearAlertaDesconexion(dispositivoId, entrada, ultimaSenal) {
    try {
      if (!entrada.incubadoraId) {
        if (!entrada.avisoSinIncubadora) {
          entrada.avisoSinIncubadora = true;

          logger.warn(
            `${PREFIJO_LOG} No se crea la alerta de desconexión de ` +
              `"${dispositivoId}": se desconoce su incubadora.`
          );
        }

        return true;
      }

      const abiertas = await consultarAlertasAbiertas(dispositivoId, 1);

      if (!abiertas.empty) {
        entrada.falloAlertaLogueado = false;

        return true;
      }

      await db.collection(COLECCION_ALERTAS).add({
        incubadoraId: entrada.incubadoraId,
        dispositivoId,
        tipo: TIPO_ALERTA_DESCONEXION,
        estado: "activa",
        titulo: "Dispositivo desconectado",
        mensaje:
          `El dispositivo ${dispositivoId} dejó de enviar señales ` +
          `hace más de ${timeoutMs / 1000} segundos.`,
        ultimaSenalEn: obtenerTimestamp().fromMillis(ultimaSenal),
        creadaEn: FieldValue.serverTimestamp(),
      });

      logger.log(
        `${PREFIJO_LOG} Alerta de desconexión creada para ` +
          `"${dispositivoId}".`
      );

      entrada.falloAlertaLogueado = false;

      return true;
    } catch (error) {
      if (!entrada.falloAlertaLogueado) {
        entrada.falloAlertaLogueado = true;

        logger.error(
          `${PREFIJO_LOG} No se pudo crear la alerta de desconexión de ` +
            `"${dispositivoId}" (se reintenta):`,
          error && error.message ? error.message : error
        );
      }

      return false;
    }
  }

  /**
   * Resuelve las alertas de desconexión abiertas de un dispositivo
   * que ya lleva conectado de forma estable. Nunca lanza.
   *
   * @param {string} dispositivoId
   * @param {Object} entrada
   * @returns {Promise<boolean>} true si terminó (con o sin alertas).
   */
  async function resolverAlertasDesconexion(dispositivoId, entrada) {
    try {
      const abiertas = await consultarAlertasAbiertas(dispositivoId);

      if (!abiertas.empty) {
        const batch = db.batch();

        abiertas.forEach((doc) => {
          batch.update(doc.ref, {
            estado: "resuelta",
            resueltaEn: FieldValue.serverTimestamp(),
            resueltaPor: "sistema",
          });
        });

        await batch.commit();

        logger.log(
          `${PREFIJO_LOG} Alerta de desconexión de "${dispositivoId}" ` +
            "resuelta (el dispositivo volvió a comunicarse)."
        );
      }

      entrada.falloResolucionLogueado = false;

      return true;
    } catch (error) {
      // Se reintenta en el siguiente ciclo; se loguea una sola vez
      // mientras siga fallando para no inundar el log.
      if (!entrada.falloResolucionLogueado) {
        entrada.falloResolucionLogueado = true;

        logger.error(
          `${PREFIJO_LOG} No se pudo resolver la alerta de desconexión ` +
            `de "${dispositivoId}" (se reintenta):`,
          error && error.message ? error.message : error
        );
      }

      return false;
    }
  }

  /**
   * Hace update sobre dispositivos/{id}. Nunca lanza.
   *
   * @returns {Promise<"ok"|"no-encontrado"|"error">}
   */
  async function actualizar(dispositivoId, campos) {
    try {
      await db
        .collection(COLECCION_DISPOSITIVOS)
        .doc(dispositivoId)
        .update(campos);

      return "ok";
    } catch (error) {
      if (esNoEncontrado(error)) {
        olvidarComoDesconocido(dispositivoId);

        return "no-encontrado";
      }

      logger.error(
        `${PREFIJO_LOG} No se pudo actualizar el estado de conexión ` +
          `de "${dispositivoId}":`,
        error && error.message ? error.message : error
      );

      return "error";
    }
  }

  function olvidarComoDesconocido(dispositivoId) {
    dispositivos.delete(dispositivoId);

    if (!desconocidos.has(dispositivoId)) {
      logger.warn(
        `${PREFIJO_LOG} El dispositivo "${dispositivoId}" envía ` +
          "señales pero no está registrado en Firestore, se ignora."
      );
    }

    desconocidos.set(dispositivoId, ahora() + DESCONOCIDO_RETENCION_MS);
  }

  function estaIgnorado(dispositivoId) {
    const hasta = desconocidos.get(dispositivoId);

    if (hasta === undefined) {
      return false;
    }

    if (ahora() >= hasta) {
      desconocidos.delete(dispositivoId);

      return false;
    }

    return true;
  }

  /**
   * Registra que el dispositivo dio señales de vida (latido o
   * medición válida). Nunca lanza ni rechaza.
   *
   * @param {string} dispositivoId
   * @param {string} [origen] "latido" o "medicion" (solo para logs).
   * @param {{incubadoraId?: string}} [contexto] Incubadora del tópico:
   *   la alerta de desconexión la necesita.
   * @returns {Promise<void>}
   */
  async function registrarSenalDeVida(
    dispositivoId,
    origen = "señal",
    contexto = {}
  ) {
    try {
      if (!activo || !esIdValido(dispositivoId) || estaIgnorado(dispositivoId)) {
        return;
      }

      const t = ahora();
      let entrada = dispositivos.get(dispositivoId);

      if (!entrada) {
        entrada = crearEntrada({
          ultimaSenal: t,
          estado: DESCONOCIDO,
          ultimoRefresco: Number.NEGATIVE_INFINITY,
        });

        dispositivos.set(dispositivoId, entrada);
      }

      entrada.ultimaSenal = t;

      if (contexto && idIncubadoraValido(contexto.incubadoraId)) {
        entrada.incubadoraId = contexto.incubadoraId;
      }

      if (entrada.estado === CONECTADO) {
        if (t - entrada.ultimoRefresco < refrescoMs) {
          return;
        }

        entrada.ultimoRefresco = t;

        await encolar(entrada, () =>
          actualizar(dispositivoId, {
            ultimaComunicacionEn: FieldValue.serverTimestamp(),
          })
        );

        return;
      }

      const estadoAnterior = entrada.estado;

      entrada.estado = CONECTADO;
      entrada.ultimoRefresco = t;
      entrada.conectadoDesde = t;

      // Si la alerta de esta caída seguía sin crearse, ya no se crea:
      // el dispositivo volvió. La próxima caída avisa con normalidad.
      entrada.alertaPendiente = false;

      const resultado = await encolar(entrada, () =>
        actualizar(dispositivoId, {
          estadoConexion: CONECTADO,
          ultimaComunicacionEn: FieldValue.serverTimestamp(),
        })
      );

      if (resultado === "ok") {
        logger.log(
          `${PREFIJO_LOG} Dispositivo "${dispositivoId}" conectado ` +
            `(${origen}).`
        );
      } else if (
        resultado === "error" &&
        entrada.estado === CONECTADO &&
        entrada.ultimoRefresco === t
      ) {
        // No se pudo escribir: la próxima señal lo reintenta.
        entrada.estado = estadoAnterior;
      }
    } catch (error) {
      logger.error(
        `${PREFIJO_LOG} Error al registrar la señal de "${dispositivoId}":`,
        error && error.message ? error.message : error
      );
    }
  }

  /**
   * Marca como desconectados los dispositivos conectados que
   * superaron el timeout. Nunca lanza ni rechaza.
   *
   * @returns {Promise<void>}
   */
  async function revisarTimeouts() {
    try {
      const t = ahora();
      const pendientes = [];

      for (const [dispositivoId, hasta] of desconocidos) {
        if (t >= hasta) {
          desconocidos.delete(dispositivoId);
        }
      }

      for (const [dispositivoId, entrada] of dispositivos) {
        if (
          entrada.estado === DESCONECTADO &&
          entrada.alertaPendiente &&
          !entrada.reintentando
        ) {
          // La alerta de esta caída no se pudo crear: se reintenta en
          // cada ciclo mientras siga desconectado (sin intentos en
          // paralelo; la consulta de duplicados evita crear dos).
          entrada.reintentando = true;

          pendientes.push(
            encolar(entrada, async () => {
              try {
                if (entrada.estado !== DESCONECTADO || !entrada.alertaPendiente) {
                  return;
                }

                if (
                  await crearAlertaDesconexion(
                    dispositivoId,
                    entrada,
                    entrada.ultimaSenalCaida
                  )
                ) {
                  entrada.alertaPendiente = false;
                }
              } finally {
                entrada.reintentando = false;
              }
            })
          );

          continue;
        }

        if (entrada.estado !== CONECTADO) {
          continue;
        }

        if (t - entrada.ultimaSenal <= timeoutMs) {
          // Sigue vivo: si lleva conectado de forma estable, se
          // resuelve la alerta de desconexión que pueda haber abierta.
          if (
            entrada.revisarAlerta &&
            !entrada.resolviendo &&
            entrada.ultimaSenal - entrada.conectadoDesde >= estabilidadMs
          ) {
            entrada.resolviendo = true;

            pendientes.push(
              encolar(entrada, async () => {
                try {
                  // Puede haberse caído mientras esperaba en la cola.
                  if (
                    entrada.estado !== CONECTADO ||
                    entrada.ultimaSenal - entrada.conectadoDesde < estabilidadMs
                  ) {
                    return;
                  }

                  // Si se desconecta durante la consulta, revisarAlerta
                  // vuelve a true y no se pisa.
                  entrada.revisarAlerta = false;

                  if (!(await resolverAlertasDesconexion(dispositivoId, entrada))) {
                    entrada.revisarAlerta = true;
                  }
                } finally {
                  entrada.resolviendo = false;
                }
              })
            );
          }

          continue;
        }

        // Se cambia el estado antes de escribir para que los
        // siguientes ciclos no repitan la escritura.
        entrada.estado = DESCONECTADO;
        entrada.revisarAlerta = true;

        const ultimaSenal = entrada.ultimaSenal;

        entrada.ultimaSenalCaida = ultimaSenal;

        pendientes.push(
          encolar(entrada, async () => {
            // ultimaComunicacionEn no se toca: es la última vez visto.
            const resultado = await actualizar(dispositivoId, {
              estadoConexion: DESCONECTADO,
            });

            if (resultado === "ok") {
              const creada = await crearAlertaDesconexion(
                dispositivoId,
                entrada,
                ultimaSenal
              );

              // Si falló, el watchdog la reintenta mientras siga
              // desconectado; si ya volvió, no hay nada que reintentar.
              entrada.alertaPendiente =
                !creada && entrada.estado === DESCONECTADO;
            }

            return resultado;
          }).then((resultado) => {
            if (resultado === "ok") {
              logger.warn(
                `${PREFIJO_LOG} Dispositivo "${dispositivoId}" ` +
                  `desconectado (sin señales hace más de ${timeoutMs / 1000} s).`
              );
            } else if (resultado === "error" && entrada.estado === DESCONECTADO) {
              // No se pudo escribir: el próximo ciclo lo reintenta.
              entrada.estado = CONECTADO;
            }
          })
        );
      }

      await Promise.all(pendientes);
    } catch (error) {
      logger.error(
        `${PREFIJO_LOG} Error al revisar timeouts de dispositivos:`,
        error && error.message ? error.message : error
      );
    }
  }

  /**
   * Carga los dispositivos que quedaron "conectado" en Firestore
   * (por ejemplo antes de reiniciar el servicio) para que, si no
   * vuelven a dar señales, se marquen desconectados. A todos se les
   * da el margen completo del timeout contado desde ahora:
   * "ultimaComunicacionEn" solo se refresca cada cierto tiempo y puede
   * estar vieja aunque el dispositivo siga vivo, así que no sirve para
   * decidir si venció.
   * Nunca lanza ni rechaza.
   *
   * @returns {Promise<void>}
   */
  async function cargarEstadoInicial() {
    try {
      const snapshot = await db
        .collection(COLECCION_DISPOSITIVOS)
        .where("estadoConexion", "==", CONECTADO)
        .get();

      const t = ahora();

      snapshot.forEach((doc) => {
        // Si ya llegó una señal más reciente, esa manda.
        if (!esIdValido(doc.id) || dispositivos.has(doc.id)) {
          return;
        }

        const datos = typeof doc.data === "function" ? doc.data() : null;

        dispositivos.set(
          doc.id,
          crearEntrada({
            ultimaSenal: t,
            estado: CONECTADO,
            ultimoRefresco: t,
            incubadoraId: datos ? datos.incubadoraId : null,
          })
        );
      });
    } catch (error) {
      logger.error(
        `${PREFIJO_LOG} No se pudo cargar el estado inicial de ` +
          "conexión de los dispositivos:",
        error && error.message ? error.message : error
      );
    }
  }

  /**
   * Activa el rastreador: arranca el watchdog y carga el estado
   * inicial. Es idempotente.
   *
   * @returns {Promise<void>}
   */
  async function iniciar() {
    if (activo) {
      return;
    }

    activo = true;

    temporizador = setInterval(() => {
      revisarTimeouts();
    }, revisionMs);

    // No mantiene vivo el proceso por sí solo.
    if (typeof temporizador.unref === "function") {
      temporizador.unref();
    }

    await cargarEstadoInicial();
  }

  /**
   * Detiene el watchdog. Después de esto se ignoran las señales.
   */
  function detener() {
    activo = false;

    if (temporizador) {
      clearInterval(temporizador);
      temporizador = null;
    }
  }

  return {
    iniciar,
    detener,
    registrarSenalDeVida,
    revisarTimeouts,
    cargarEstadoInicial,
  };
}

module.exports = {
  crearRastreadorConexion,
};
