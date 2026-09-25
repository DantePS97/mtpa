const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

// =========================================================
// ROLES VÁLIDOS
//
// Deben coincidir exactamente con ROLES en
// frontend/src/utils/constants.js. Este archivo vive en un
// paquete npm independiente (functions/) por lo que no puede
// importar código del frontend, y se mantiene esta lista en
// espejo de forma deliberada.
// =========================================================

const ROLES_VALIDOS = ["administrador", "operador", "consulta"];

const COLECCION_USUARIOS = "usuarios";
const COLECCION_INCUBADORAS = "incubadoras";
const COLECCION_DISPOSITIVOS = "dispositivos";

// =========================================================
// ESTADOS Y TIPOS VÁLIDOS (Sprint 2 — incubadoras/dispositivos)
//
// Igual que ROLES_VALIDOS, deben coincidir con INCUBATOR_STATUS
// y DEVICE_TYPES de frontend/src/utils/constants.js. Se acota
// deliberadamente a los valores que esta Cloud Function acepta
// en esta etapa (alta/edición manual y alta de dispositivo);
// otros valores de esas constantes (por ejemplo "advertencia" o
// "critica" en incubadoras) los escribe el Servicio de
// Integración IoT en un sprint posterior, no este endpoint.
// =========================================================

const ESTADOS_INCUBADORA_VALIDOS = ["activa", "inactiva"];

const TIPOS_DISPOSITIVO_VALIDOS = [
  "sensor_temperatura",
  "sensor_humedad",
  "ventilador",
];

/**
 * Helper compartido: exige sesión activa y uno de los roles
 * indicados, vía el custom claim "role" del token.
 *
 * Extraído de la lógica que ya usaba "gestionarUsuario" al
 * agregarse "gestionarIncubadora", que repite el mismo chequeo.
 *
 * @param {import("firebase-functions").https.CallableContext} context
 * @param {string[]} roles Roles permitidos.
 * @param {string} [mensajeError] Mensaje específico para el caso
 * de permiso denegado (si no se indica, se usa uno genérico).
 */
function requireRole(context, roles, mensajeError) {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión para realizar esta acción."
    );
  }

  if (!roles.includes(context.auth.token.role)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      mensajeError || "No tenés permisos suficientes para realizar esta acción."
    );
  }
}

/**
 * Genera un identificadorMqtt único para un dispositivo.
 *
 * Requisito de seguridad real del DDS: este identificador nunca
 * debe reutilizarse entre incubadoras. Se arma con el id de la
 * incubadora y el tipo de dispositivo (para que sea legible en
 * los tópicos MQTT, ver docs/contrato-mqtt.md) más un sufijo
 * aleatorio (UUID v4), y se verifica contra Firestore por si,
 * en un caso extremo, ya existiera un documento con ese mismo
 * valor.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {string} incubadoraId
 * @param {string} tipo
 * @returns {Promise<string>}
 */
async function generarIdentificadorMqttUnico(db, incubadoraId, tipo) {
  const prefijo = `${incubadoraId}-${tipo}`;

  for (let intento = 0; intento < 5; intento++) {
    const candidato = `${prefijo}-${crypto.randomUUID()}`;

    const coincidencias = await db
      .collection(COLECCION_DISPOSITIVOS)
      .where("identificadorMqtt", "==", candidato)
      .limit(1)
      .get();

    if (coincidencias.empty) {
      return candidato;
    }
  }

  throw new functions.https.HttpsError(
    "internal",
    "No fue posible generar un identificador MQTT único. Intentá nuevamente."
  );
}

/**
 * Cloud Function callable: gestionarUsuario
 *
 * Único punto de entrada autorizado para crear, editar o
 * desactivar usuarios. El cliente nunca escribe directamente
 * en la colección "usuarios" (ver firestore.rules).
 *
 * Datos esperados (data):
 * {
 *   accion: "crear" | "editar" | "desactivar",
 *   uid: string,        // requerido para "editar" y "desactivar"
 *   nombre: string,      // requerido para "crear", opcional para "editar"
 *   correo: string,      // requerido para "crear", opcional para "editar"
 *   rol: string,         // uno de ROLES_VALIDOS, requerido para "crear"
 * }
 */
exports.gestionarUsuario = functions.https.onCall(async (data, context) => {
  // ---------------------------------------------------------
  // 1. Autenticación y autorización: solo administradores.
  // ---------------------------------------------------------
  requireRole(
    context,
    ["administrador"],
    "Solo un administrador puede gestionar usuarios."
  );

  const accion = data && data.accion;

  if (!["crear", "editar", "desactivar"].includes(accion)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      'El campo "accion" debe ser "crear", "editar" o "desactivar".'
    );
  }

  // ---------------------------------------------------------
  // 2. Validación del rol (si viene incluido en la petición).
  // ---------------------------------------------------------
  if (data.rol !== undefined && !ROLES_VALIDOS.includes(data.rol)) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      `El rol "${data.rol}" no es válido. Los roles permitidos son: ` +
        ROLES_VALIDOS.join(", ") +
        "."
    );
  }

  const db = admin.firestore();

  // ---------------------------------------------------------
  // 3. CREAR
  // ---------------------------------------------------------
  if (accion === "crear") {
    if (!data.nombre || !data.correo || !data.rol) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Para crear un usuario se requieren nombre, correo y rol."
      );
    }

    const usuarioAuth = await admin.auth().createUser({
      email: data.correo,
      displayName: data.nombre,
    });

    await admin
      .auth()
      .setCustomUserClaims(usuarioAuth.uid, { role: data.rol });

    await db
      .collection(COLECCION_USUARIOS)
      .doc(usuarioAuth.uid)
      .set({
        uid: usuarioAuth.uid,
        nombre: data.nombre,
        correo: data.correo,
        rol: data.rol,
        activo: true,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      });

    return { uid: usuarioAuth.uid };
  }

  // A partir de acá se requiere el uid del usuario a modificar.
  if (!data.uid) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      'El campo "uid" es obligatorio para esta acción.'
    );
  }

  // ---------------------------------------------------------
  // 4. EDITAR
  // ---------------------------------------------------------
  if (accion === "editar") {
    const cambios = {};

    if (data.nombre !== undefined) cambios.nombre = data.nombre;
    if (data.correo !== undefined) cambios.correo = data.correo;
    if (data.rol !== undefined) cambios.rol = data.rol;
    if (data.activo !== undefined) cambios.activo = data.activo;

    if (Object.keys(cambios).length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "No se recibió ningún campo para editar."
      );
    }

    // Se valida que el uid exista en Authentication ANTES de escribir
    // nada en Firestore, para no dejar documentos huérfanos apuntando
    // a un usuario de Auth inexistente.
    let usuarioAuthActual;

    try {
      usuarioAuthActual = await admin.auth().getUser(data.uid);
    } catch (error) {
      throw new functions.https.HttpsError(
        "not-found",
        "El usuario no existe."
      );
    }

    await db
      .collection(COLECCION_USUARIOS)
      .doc(data.uid)
      .set(cambios, { merge: true });

    if (data.rol !== undefined) {
      await admin
        .auth()
        .setCustomUserClaims(data.uid, { role: data.rol });
    }

    // Solo se toca Authentication si el correo realmente cambió, para
    // no disparar una actualización (y su verificación) innecesaria.
    if (
      data.correo !== undefined &&
      data.correo !== usuarioAuthActual.email
    ) {
      await admin.auth().updateUser(data.uid, { email: data.correo });
    }

    // Se mantiene Authentication en espejo del campo "activo": un
    // usuario editado a activo:false queda deshabilitado igual que si
    // se hubiera usado la acción "desactivar".
    if (data.activo !== undefined) {
      await admin.auth().updateUser(data.uid, { disabled: !data.activo });
    }

    return { uid: data.uid };
  }

  // ---------------------------------------------------------
  // 5. DESACTIVAR
  // ---------------------------------------------------------
  if (accion === "desactivar") {
    try {
      await admin.auth().getUser(data.uid);
    } catch (error) {
      throw new functions.https.HttpsError(
        "not-found",
        "El usuario no existe."
      );
    }

    await db.collection(COLECCION_USUARIOS).doc(data.uid).set(
      { activo: false },
      { merge: true }
    );

    await admin.auth().updateUser(data.uid, { disabled: true });

    // Deshabilitar la cuenta no invalida los tokens de sesión ya
    // emitidos: hay que revocarlos explícitamente para que una sesión
    // activa del cliente deje de considerarse válida en el próximo
    // refresh del ID token.
    await admin.auth().revokeRefreshTokens(data.uid);

    return { uid: data.uid };
  }

  // No debería alcanzarse nunca (accion ya fue validada arriba).
  throw new functions.https.HttpsError("internal", "Acción no soportada.");
});

/**
 * Cloud Function callable: gestionarIncubadora
 *
 * Único punto de entrada autorizado para crear, editar o
 * desactivar incubadoras, y para dar de alta un dispositivo
 * asociado a una de ellas. El cliente nunca escribe
 * directamente en las colecciones "incubadoras" ni
 * "dispositivos" (ver firestore.rules).
 *
 * Datos esperados (data):
 * {
 *   accion: "crear" | "editar" | "desactivar" | "crear_dispositivo",
 *
 *   // Incubadora ("crear" / "editar" / "desactivar")
 *   id: string,          // requerido para "editar" y "desactivar"
 *   nombre: string,       // requerido para "crear", opcional para "editar"
 *   ubicacion: string,    // requerido para "crear", opcional para "editar"
 *   estado: string,       // "activa" | "inactiva", opcional (default "activa" al crear)
 *
 *   // Dispositivo ("crear_dispositivo")
 *   incubadoraId: string, // id de la incubadora dueña del dispositivo
 *   tipo: string,         // "sensor_temperatura" | "sensor_humedad" | "ventilador"
 * }
 */
exports.gestionarIncubadora = functions.https.onCall(async (data, context) => {
  // ---------------------------------------------------------
  // 1. Autenticación y autorización: solo administradores.
  // ---------------------------------------------------------
  requireRole(
    context,
    ["administrador"],
    "Solo un administrador puede gestionar incubadoras."
  );

  const accion = data && data.accion;

  if (
    !["crear", "editar", "desactivar", "crear_dispositivo"].includes(accion)
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      'El campo "accion" debe ser "crear", "editar", "desactivar" o ' +
        '"crear_dispositivo".'
    );
  }

  const db = admin.firestore();

  // ---------------------------------------------------------
  // 2. CREAR incubadora
  // ---------------------------------------------------------
  if (accion === "crear") {
    if (!data.nombre || !data.ubicacion) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Para crear una incubadora se requieren nombre y ubicación."
      );
    }

    const estado = data.estado !== undefined ? data.estado : "activa";

    if (!ESTADOS_INCUBADORA_VALIDOS.includes(estado)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `El estado "${estado}" no es válido. Los estados permitidos son: ` +
          ESTADOS_INCUBADORA_VALIDOS.join(", ") +
          "."
      );
    }

    const referencia = db.collection(COLECCION_INCUBADORAS).doc();

    await referencia.set({
      nombre: data.nombre,
      ubicacion: data.ubicacion,
      estado,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { id: referencia.id };
  }

  // ---------------------------------------------------------
  // 3. CREAR_DISPOSITIVO: dar de alta un dispositivo asociado
  //    a una incubadora existente.
  // ---------------------------------------------------------
  if (accion === "crear_dispositivo") {
    const incubadoraId = data.incubadoraId;

    if (!incubadoraId) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        'El campo "incubadoraId" es obligatorio para dar de alta un ' +
          "dispositivo."
      );
    }

    if (!TIPOS_DISPOSITIVO_VALIDOS.includes(data.tipo)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `El tipo "${data.tipo}" no es válido. Los tipos permitidos son: ` +
          TIPOS_DISPOSITIVO_VALIDOS.join(", ") +
          "."
      );
    }

    // Se valida que la incubadora exista ANTES de escribir el
    // dispositivo, para no dejar dispositivos huérfanos apuntando
    // a una incubadora inexistente (mismo patrón que "editar" en
    // gestionarUsuario).
    const incubadoraSnapshot = await db
      .collection(COLECCION_INCUBADORAS)
      .doc(incubadoraId)
      .get();

    if (!incubadoraSnapshot.exists) {
      throw new functions.https.HttpsError(
        "not-found",
        "La incubadora indicada no existe."
      );
    }

    const identificadorMqtt = await generarIdentificadorMqttUnico(
      db,
      incubadoraId,
      data.tipo
    );

    const referencia = db.collection(COLECCION_DISPOSITIVOS).doc();

    await referencia.set({
      incubadoraId,
      tipo: data.tipo,
      identificadorMqtt,
      estadoConexion: "desconocido",
      ultimaComunicacionEn: null,
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { id: referencia.id, identificadorMqtt };
  }

  // A partir de acá (editar/desactivar) se requiere el id de la incubadora.
  if (!data.id) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      'El campo "id" es obligatorio para esta acción.'
    );
  }

  // Se valida que la incubadora exista ANTES de escribir en ediciones,
  // mismo patrón que ya usa "gestionarUsuario" (evita documentos
  // huérfanos / ediciones fantasma).
  const referenciaIncubadora = db.collection(COLECCION_INCUBADORAS).doc(data.id);
  const snapshotIncubadora = await referenciaIncubadora.get();

  if (!snapshotIncubadora.exists) {
    throw new functions.https.HttpsError(
      "not-found",
      "La incubadora no existe."
    );
  }

  // ---------------------------------------------------------
  // 4. EDITAR
  // ---------------------------------------------------------
  if (accion === "editar") {
    const cambios = {};

    if (data.nombre !== undefined) cambios.nombre = data.nombre;
    if (data.ubicacion !== undefined) cambios.ubicacion = data.ubicacion;

    if (data.estado !== undefined) {
      if (!ESTADOS_INCUBADORA_VALIDOS.includes(data.estado)) {
        throw new functions.https.HttpsError(
          "invalid-argument",
          `El estado "${data.estado}" no es válido. Los estados permitidos ` +
            "son: " +
            ESTADOS_INCUBADORA_VALIDOS.join(", ") +
            "."
        );
      }
      cambios.estado = data.estado;
    }

    if (Object.keys(cambios).length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "No se recibió ningún campo para editar."
      );
    }

    await referenciaIncubadora.set(cambios, { merge: true });

    return { id: data.id };
  }

  // ---------------------------------------------------------
  // 5. DESACTIVAR
  // ---------------------------------------------------------
  if (accion === "desactivar") {
    await referenciaIncubadora.set({ estado: "inactiva" }, { merge: true });

    return { id: data.id };
  }

  // No debería alcanzarse nunca (accion ya fue validada arriba).
  throw new functions.https.HttpsError("internal", "Acción no soportada.");
});
