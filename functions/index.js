const functions = require("firebase-functions");
const admin = require("firebase-admin");

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
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Debes iniciar sesión para realizar esta acción."
    );
  }

  if (context.auth.token.role !== "administrador") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Solo un administrador puede gestionar usuarios."
    );
  }

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

    if (Object.keys(cambios).length === 0) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "No se recibió ningún campo para editar."
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

    if (data.correo !== undefined) {
      await admin.auth().updateUser(data.uid, { email: data.correo });
    }

    return { uid: data.uid };
  }

  // ---------------------------------------------------------
  // 5. DESACTIVAR
  // ---------------------------------------------------------
  if (accion === "desactivar") {
    await db.collection(COLECCION_USUARIOS).doc(data.uid).set(
      { activo: false },
      { merge: true }
    );

    await admin.auth().updateUser(data.uid, { disabled: true });

    return { uid: data.uid };
  }

  // No debería alcanzarse nunca (accion ya fue validada arriba).
  throw new functions.https.HttpsError("internal", "Acción no soportada.");
});
