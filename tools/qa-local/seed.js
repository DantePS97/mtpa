#!/usr/bin/env node
"use strict";

/**
 * Siembra el emulador con lo mínimo para probar M.T.P.A.:
 *   - tres usuarios (administrador, operador, consulta) con su claim "role";
 *   - una incubadora activa con un sensor de temperatura y dos ventiladores.
 *
 * Para no desfasarse de la lógica real reutiliza el código del repo:
 *   - el administrador lo crea functions/scripts/crear-primer-admin.js;
 *   - operador y consulta, la callable gestionarUsuario;
 *   - la incubadora y los dispositivos, gestionarIncubadora y crearDispositivo,
 *     llamadas con la sesión del administrador sembrado.
 * Por eso necesita los emuladores levantados con las funciones cargadas y el
 * arreglo de FieldValue (PR #43, ver README).
 *
 * Las claves se generan al azar y se guardan en .credenciales.local.json
 * (ignorado por git). Nunca se imprimen. Es idempotente: si el emulador ya está
 * sembrado, lo informa y no duplica nada.
 *
 * Uso (tras `source tools/qa-local/entorno.sh`):  node tools/qa-local/seed.js
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { createRequire } = require("module");
const { verificar, hostLocal } = require("./verificar-entorno");

verificar();

const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");
const admin = createRequire(path.join(FUNCTIONS_DIR, "package.json"))("firebase-admin");
const ARCHIVO = path.join(__dirname, ".credenciales.local.json");
const PROYECTO = process.env.GCLOUD_PROJECT;
const FUNCTIONS_HOST = process.env.QA_FUNCTIONS_HOST || "127.0.0.1:5001";
if (!hostLocal(FUNCTIONS_HOST)) {
  console.error(`QA_FUNCTIONS_HOST=${FUNCTIONS_HOST} no es un host:puerto de esta máquina (ej.: 127.0.0.1:5001).`);
  process.exit(1);
}
const NOMBRE_INCUBADORA = "QA Local Incubadora 1";
const USUARIOS = ["administrador", "operador", "consulta"].map((rol) => ({
  rol,
  nombre: `${rol[0].toUpperCase()}${rol.slice(1)} QA`,
  correo: `${rol}@mtpa-qa.test`,
}));
const DISPOSITIVOS = { sensor_temperatura: 1, ventilador: 2 };

const clave = () => crypto.randomBytes(18).toString("base64url");

const leerCredenciales = () => {
  let datos;
  try {
    datos = JSON.parse(fs.readFileSync(ARCHIVO, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { proyecto: PROYECTO, usuarios: {} };
    throw new Error(`${ARCHIVO} no es un JSON válido (${error.message}). Borralo para sembrar de cero.`);
  }
  const usuarios = datos && datos.usuarios;
  const valido =
    usuarios &&
    typeof usuarios === "object" &&
    Object.values(usuarios).every((u) => u && typeof u.correo === "string" && typeof u.password === "string" && u.password);
  if (!valido) {
    throw new Error(`${ARCHIVO} no tiene la forma esperada ({ usuarios: { <rol>: { correo, password } } }). Borralo para sembrar de cero.`);
  }
  return datos;
};

const guardar = (credenciales) =>
  fs.writeFileSync(ARCHIVO, JSON.stringify(credenciales, null, 2), { mode: 0o600 });

async function iniciarSesion(correo, password) {
  const url = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulador`;
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: correo, password, returnSecureToken: true }),
  });
  const cuerpo = await respuesta.json();
  if (!cuerpo.idToken) {
    throw new Error(`No se pudo iniciar sesión como ${correo}: ${cuerpo.error && cuerpo.error.message}`);
  }
  return cuerpo.idToken;
}

async function llamar(funcion, data, token) {
  const respuesta = await fetch(`http://${FUNCTIONS_HOST}/${PROYECTO}/us-central1/${funcion}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const cuerpo = await respuesta.json().catch(() => ({}));
  if (cuerpo.error) {
    const pista =
      cuerpo.error.status === "INTERNAL"
        ? " (¿falta el arreglo de FieldValue del PR #43? Ver README)"
        : "";
    const { status, message } = cuerpo.error;
    throw new Error(`${funcion}: ${status}${message && message !== status ? ` ${message}` : ""}${pista}`);
  }
  return cuerpo.result;
}

async function sembrarUsuarios(auth, db, credenciales) {
  let tokenAdmin;
  for (const { rol, nombre, correo } of USUARIOS) {
    const guardada = credenciales.usuarios[rol];
    const password = guardada ? guardada.password : clave();
    let existente = await auth.getUserByEmail(correo).catch((error) => {
      if (error.code === "auth/user-not-found") return null;
      throw error;
    });
    if (rol !== "administrador" && existente && !(await db.collection("usuarios").doc(existente.uid).get()).exists) {
      // Una corrida anterior falló a mitad de gestionarUsuario: se recrea desde cero.
      await auth.deleteUser(existente.uid);
      existente = null;
    }

    if (rol === "administrador") {
      // Idempotente por diseño: si el correo existe, solo asegura claim y documento.
      const resultado = spawnSync(process.execPath, [path.join(FUNCTIONS_DIR, "scripts", "crear-primer-admin.js")], {
        env: { ...process.env, ADMIN_EMAIL: correo, ADMIN_PASSWORD: password, ADMIN_NOMBRE: nombre },
        encoding: "utf8",
      });
      if (resultado.status !== 0) {
        throw new Error(`crear-primer-admin.js falló:\n${resultado.stderr || resultado.stdout}`);
      }
    } else if (!existente) {
      const { uid } = await llamar("gestionarUsuario", { accion: "crear", nombre, correo, rol }, tokenAdmin);
      await auth.updateUser(uid, { password }); // la callable crea al usuario sin clave
    }
    if (existente && !guardada) await auth.updateUser(existente.uid, { password });

    credenciales.usuarios[rol] = { correo, password };
    guardar(credenciales);
    console.log(`  ${rol.padEnd(13)} ${existente ? "ya existía" : "creado"} (${correo})`);
    if (rol === "administrador") tokenAdmin = await iniciarSesion(correo, password);
  }
  return tokenAdmin;
}

async function sembrarDatos(db, tokenAdmin) {
  const incubadoras = await db.collection("incubadoras").where("nombre", "==", NOMBRE_INCUBADORA).limit(1).get();
  let incubadoraId = incubadoras.empty ? null : incubadoras.docs[0].id;
  if (!incubadoraId) {
    const datos = { accion: "crear", nombre: NOMBRE_INCUBADORA, ubicacion: "Pruebas locales", estado: "activa" };
    incubadoraId = (await llamar("gestionarIncubadora", datos, tokenAdmin)).id;
  }
  console.log(`  incubadora    ${incubadoras.empty ? "creada" : "ya existía"} (${NOMBRE_INCUBADORA})`);

  const lista = async () =>
    (await db.collection("dispositivos").where("incubadoraId", "==", incubadoraId).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const previos = await lista();
  for (const [tipo, cantidad] of Object.entries(DISPOSITIVOS)) {
    const faltan = cantidad - previos.filter((d) => d.tipo === tipo).length;
    for (let i = 0; i < faltan; i++) await llamar("crearDispositivo", { incubadoraId, tipo }, tokenAdmin);
    console.log(`  ${tipo.padEnd(18)} ${faltan > 0 ? `${faltan} creado(s)` : "ya existía"}`);
  }

  const creado = (d) => (d.creadoEn && d.creadoEn.toMillis ? d.creadoEn.toMillis() : 0);
  const todos = (await lista()).sort((a, b) => creado(a) - creado(b) || a.id.localeCompare(b.id));
  return { incubadoraId, todos };
}

async function comprobarEmuladores() {
  const hosts = [process.env.FIRESTORE_EMULATOR_HOST, process.env.FIREBASE_AUTH_EMULATOR_HOST, FUNCTIONS_HOST];
  for (const host of hosts) {
    // Cualquier respuesta HTTP sirve; lo que importa es que alguien escuche.
    await fetch(`http://${host}/`, { signal: AbortSignal.timeout(3000) }).catch(() => {
      throw new Error(`No responde ${host}: ¿están levantados los emuladores?`);
    });
  }
}

async function main() {
  await comprobarEmuladores();
  admin.initializeApp({ projectId: PROYECTO });
  const credenciales = leerCredenciales();
  console.log(`Sembrando el proyecto ${PROYECTO}...`);
  const tokenAdmin = await sembrarUsuarios(admin.auth(), admin.firestore(), credenciales);
  const { incubadoraId, todos } = await sembrarDatos(admin.firestore(), tokenAdmin);
  const sensor = todos.find((d) => d.tipo === "sensor_temperatura");
  const ventiladores = todos.filter((d) => d.tipo === "ventilador");

  console.log(`\nIds de documento (para el simulador y el servicio):
  incubadora    ${incubadoraId}
  sensor        ${sensor.id}
  ventilador 1  ${ventiladores[0].id}
  ventilador 2  ${ventiladores[1].id}

Usuarios y claves (no se imprimen): ${ARCHIVO}

Siguiente paso: arrancá el broker, el servicio y el simulador (ver README, pasos 4 a 6) con:
  export SIMULADOR_INCUBADORA_ID=${incubadoraId}
  export SIMULADOR_SENSOR_ID=${sensor.id}
  export SIMULADOR_VENTILADOR_ID=${ventiladores[0].id}`);
}

main()
  .catch((error) => {
    const refusada = (error.cause && error.cause.code === "ECONNREFUSED") || /ECONNREFUSED/.test(error.message);
    console.error(refusada ? "No se pudo conectar: ¿están levantados los emuladores?" : `Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => admin.apps.length && admin.app().delete()); // cierra las conexiones y deja salir a node sin process.exit
