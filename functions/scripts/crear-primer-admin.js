#!/usr/bin/env node
/**
 * Script standalone para crear el primer usuario administrador de
 * M.T.P.A.
 *
 * Por qué existe: la Cloud Function callable "gestionarUsuario" exige
 * que quien la invoca ya sea administrador, incluso para la acción
 * "crear" (ver functions/index.js). Es un problema de huevo-y-gallina
 * intencional: nadie sin ser administrador puede crear usuarios desde
 * la aplicación. La única forma de crear al PRIMER administrador es
 * por fuera de la app, con credenciales de administrador del proyecto
 * de Firebase (no del rol de la aplicación).
 *
 * IMPORTANTE:
 * - Este script NO se despliega como Cloud Function (ver
 *   "functions.ignore" en firebase.json, que excluye "scripts/**").
 *   Se ejecuta manualmente, a mano, una vez por entorno.
 * - Requiere credenciales de una cuenta de servicio (Service Account)
 *   con permisos administrativos sobre el proyecto de Firebase. Se
 *   descargan desde Firebase Console > Configuración del proyecto >
 *   Cuentas de servicio > Generar nueva clave privada.
 *
 * Ver procedimiento completo en docs/bootstrap-admin.md.
 *
 * Uso (variables de entorno):
 *
 *   GOOGLE_APPLICATION_CREDENTIALS="./service-account.json" \
 *   ADMIN_EMAIL="admin@mtpa.com" \
 *   ADMIN_PASSWORD="unaContraseñaSegura123" \
 *   ADMIN_NOMBRE="Administrador Inicial" \
 *   node scripts/crear-primer-admin.js
 *
 * Uso (argumentos posicionales):
 *
 *   node scripts/crear-primer-admin.js admin@mtpa.com unaContraseñaSegura123 "Administrador Inicial"
 *
 * Es idempotente respecto al rol: si el correo ya existe en
 * Authentication, no crea un usuario nuevo, solo le asegura el custom
 * claim { role: "administrador" } y su documento en Firestore.
 */

const admin = require("firebase-admin");

const ROL_ADMINISTRADOR = "administrador";
const COLECCION_USUARIOS = "usuarios";

const leerArgumentos = () => {
  const [, , argEmail, argPassword, ...restoNombre] = process.argv;

  const email = argEmail || process.env.ADMIN_EMAIL;
  const password = argPassword || process.env.ADMIN_PASSWORD;

  const nombre =
    (restoNombre.length > 0 ? restoNombre.join(" ") : undefined) ||
    process.env.ADMIN_NOMBRE ||
    "Administrador";

  if (!email || !password) {
    console.error(
      "Uso: node crear-primer-admin.js <email> <password> [nombre]\n" +
        "     (o vía variables de entorno ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NOMBRE)"
    );

    process.exit(1);
  }

  return { email, password, nombre };
};

const main = async () => {
  const { email, password, nombre } = leerArgumentos();

  admin.initializeApp();

  const db = admin.firestore();

  let usuarioAuth;

  try {
    usuarioAuth = await admin.auth().getUserByEmail(email);

    console.log(
      `Ya existe un usuario de Authentication con ese correo ` +
        `(uid: ${usuarioAuth.uid}). No se crea uno nuevo.`
    );
  } catch (error) {
    usuarioAuth = await admin.auth().createUser({
      email,
      password,
      displayName: nombre,
    });

    console.log(
      `Usuario de Authentication creado (uid: ${usuarioAuth.uid}).`
    );
  }

  await admin.auth().setCustomUserClaims(usuarioAuth.uid, {
    role: ROL_ADMINISTRADOR,
  });

  console.log(`Custom claim "role: ${ROL_ADMINISTRADOR}" asignado.`);

  await db
    .collection(COLECCION_USUARIOS)
    .doc(usuarioAuth.uid)
    .set(
      {
        uid: usuarioAuth.uid,
        nombre,
        correo: email,
        rol: ROL_ADMINISTRADOR,
        activo: true,
        creadoEn: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

  console.log(
    `Documento usuarios/${usuarioAuth.uid} creado/actualizado en Firestore.`
  );

  console.log(
    "Listo. Ya se puede iniciar sesión con este usuario como administrador."
  );
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error al crear el primer administrador:", error);
    process.exit(1);
  });
