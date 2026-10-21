"use strict";

/**
 * Utilidades compartidas por los scripts de la demo:
 *
 *   - functions/scripts/cargar-datos-demo.js
 *   - functions/scripts/escenario-demo.js
 *
 * Este directorio NO se despliega (firebase.json excluye "scripts"). Se
 * ejecuta a mano, en la máquina de quien presenta.
 *
 * Seguridad por diseño (lo que garantiza validarEntorno):
 *
 *   - "--proyecto" es obligatorio y se imprime SIEMPRE el proyecto destino.
 *   - Con emuladores (FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST,
 *     ambos de esta máquina) todo es local. Si solo hay uno de los dos, se
 *     aborta: el otro servicio iría a la nube.
 *   - Sin emuladores se exige GOOGLE_APPLICATION_CREDENTIALS y que el
 *     "project_id" de esa clave sea exactamente el de "--proyecto".
 *   - La URL de procesarMedicion solo puede ser la del proyecto indicado.
 *   - Nada de lo que se imprime contiene contraseñas, tokens ni claves.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { parseArgs } = require("node:util");

// =========================================================
// CONSTANTES DE LA DEMO
// =========================================================

const REGION_POR_DEFECTO = "us-central1";

// Nombres de las incubadoras de demo. Son la clave de idempotencia: si ya
// existe una incubadora con ese nombre, se reutiliza.
const INCUBADORAS_DEMO = [
  {
    clave: "A",
    nombre: "Incubadora A - Lote 1 (demo)",
    ubicacion: "Sala de incubación 1 (demo)",
    estado: "activa",
  },
  {
    clave: "B",
    nombre: "Incubadora B - Lote 2 (demo)",
    ubicacion: "Sala de incubación 2 (demo)",
    estado: "activa",
  },
  {
    clave: "C",
    nombre: "Incubadora C - En mantenimiento (demo)",
    ubicacion: "Sala de mantenimiento (demo)",
    estado: "inactiva",
  },
];

// Límites que se cargan (mismo formato que ConfiguracionLimites.jsx).
const UMBRALES_DEMO = {
  temperatura: { minimo: 36.5, maximo: 38.5, unidad: "°C" },
  humedad: { minimo: 50, maximo: 65, unidad: "%" },
};

// Regla de automatización del ventilador de la Incubadora A.
const REGLA_DEMO = {
  modoControl: "mixto",
  variable: "temperatura",
  umbralActivacion: 38.5,
  margenHisteresis: 1.5,
  activa: true,
};

const UNIDAD_POR_VARIABLE = { temperatura: "°C", humedad: "%" };

// Fracción del rango que la medición debe recuperar para resolver una
// alerta (MARGEN_RESOLUCION en functions/index.js).
const MARGEN_RESOLUCION = 0.05;

// =========================================================
// SALIDA Y ABORTOS
// =========================================================

function abortar(mensaje) {
  console.error(`\nABORTADO: ${mensaje}\n`);
  process.exit(1);
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =========================================================
// ARGUMENTOS
// =========================================================

function leerArgumentos(argv, opciones, ayuda) {
  let resultado;

  try {
    resultado = parseArgs({
      args: argv,
      options: { ayuda: { type: "boolean", short: "h" }, help: { type: "boolean" }, ...opciones },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    console.error(`Argumentos inválidos: ${error.message}\n`);
    console.error(ayuda);
    process.exit(1);
  }

  if (resultado.values.ayuda || resultado.values.help) {
    console.log(ayuda);
    process.exit(0);
  }

  return resultado;
}

// =========================================================
// VALIDACIÓN DEL ENTORNO (lo más importante de este archivo)
// =========================================================

const ANFITRIONES_LOCALES = ["127.0.0.1", "localhost", "[::1]"];

/** true si `valor` es host:puerto de esta máquina (puerto 1-65535). */
function hostLocal(valor) {
  const puerto = /:(\d{1,5})$/.exec(valor || "");

  if (!puerto || Number(puerto[1]) < 1 || Number(puerto[1]) > 65535) {
    return false;
  }

  try {
    const url = new URL(`http://${valor}`);

    return (
      ANFITRIONES_LOCALES.includes(url.hostname) &&
      url.pathname === "/" &&
      !url.username &&
      !url.search
    );
  } catch {
    return false;
  }
}

const RE_PROYECTO = /^[a-z][a-z0-9-]{3,28}[a-z0-9]$/;

/**
 * Valida el entorno y decide si se trabaja contra emuladores o contra un
 * proyecto real. Aborta (process.exit(1)) ante cualquier duda.
 *
 * @param {{proyecto?: string, region?: string}} opciones
 * @returns {{
 *   modo: "emulador"|"real", proyecto: string, region: string,
 *   functionsBase: string, identityBase: string, procesarMedicionUrl: string
 * }}
 */
function validarEntorno({ proyecto, region = REGION_POR_DEFECTO }) {
  const env = process.env;

  if (!proyecto) {
    abortar(
      "Falta --proyecto <id>. Es obligatorio y debe ser el proyecto de Firebase " +
        "donde querés trabajar (por ejemplo mtpa-dev), o el de los emuladores."
    );
  }

  if (!RE_PROYECTO.test(proyecto)) {
    abortar(`El valor de --proyecto ("${proyecto}") no parece un id de proyecto de Firebase.`);
  }

  if (!/^[a-z0-9-]+$/.test(region)) {
    abortar(`El valor de --region ("${region}") no es válido.`);
  }

  for (const nombre of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "GCP_PROJECT"]) {
    if (env[nombre] && env[nombre] !== proyecto) {
      abortar(
        `La variable ${nombre} vale "${env[nombre]}" y --proyecto es "${proyecto}". ` +
          "No coinciden: corregí una de las dos para no escribir en el proyecto equivocado."
      );
    }
  }

  const hostFirestore = env.FIRESTORE_EMULATOR_HOST;
  const hostAuth = env.FIREBASE_AUTH_EMULATOR_HOST;
  const usaEmuladores = Boolean(hostFirestore || hostAuth);

  let modo;
  let functionsBase;
  let identityBase;

  if (usaEmuladores) {
    if (!hostFirestore || !hostAuth) {
      abortar(
        "Hay un emulador definido pero no los dos (FIRESTORE_EMULATOR_HOST y " +
          "FIREBASE_AUTH_EMULATOR_HOST). El servicio sin emulador iría a la nube."
      );
    }

    if (!hostLocal(hostFirestore) || !hostLocal(hostAuth)) {
      abortar(
        "FIRESTORE_EMULATOR_HOST y FIREBASE_AUTH_EMULATOR_HOST deben ser host:puerto de " +
          "esta máquina (127.0.0.1, localhost o [::1])."
      );
    }

    const hostFunctions = env.QA_FUNCTIONS_HOST || "127.0.0.1:5001";

    if (!hostLocal(hostFunctions)) {
      abortar(`QA_FUNCTIONS_HOST=${hostFunctions} no es un host:puerto de esta máquina.`);
    }

    modo = "emulador";
    functionsBase = `http://${hostFunctions}/${proyecto}/${region}`;
    identityBase = `http://${hostAuth}/identitytoolkit.googleapis.com/v1`;
  } else {
    const credenciales = env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!credenciales) {
      abortar(
        "No hay emuladores (FIRESTORE_EMULATOR_HOST) y falta GOOGLE_APPLICATION_CREDENTIALS. " +
          "Para trabajar contra un proyecto real apuntá esa variable a la clave de cuenta de " +
          "servicio de ese proyecto (archivo .json)."
      );
    }

    let clave;

    try {
      clave = JSON.parse(fs.readFileSync(credenciales, "utf8"));
    } catch (error) {
      abortar(`No se pudo leer la clave de GOOGLE_APPLICATION_CREDENTIALS: ${error.message}`);
    }

    if (!clave || clave.type !== "service_account" || typeof clave.project_id !== "string") {
      abortar("GOOGLE_APPLICATION_CREDENTIALS no apunta a una clave de cuenta de servicio válida.");
    }

    if (clave.project_id !== proyecto) {
      abortar(
        `La clave de GOOGLE_APPLICATION_CREDENTIALS es del proyecto "${clave.project_id}" ` +
          `pero --proyecto es "${proyecto}". No se escribe nada.`
      );
    }

    modo = "real";
    functionsBase = `https://${region}-${proyecto}.cloudfunctions.net`;
    identityBase = "https://identitytoolkit.googleapis.com/v1";
  }

  // URL de procesarMedicion: la de este proyecto y de ningún otro.
  const porDefecto = `${functionsBase}/procesarMedicion`;
  let procesarMedicionUrl = env.PROCESAR_MEDICION_URL || porDefecto;

  procesarMedicionUrl = procesarMedicionUrl.replace(/\/+$/, "");

  if (procesarMedicionUrl !== porDefecto) {
    abortar(
      `PROCESAR_MEDICION_URL (${procesarMedicionUrl}) no es la función procesarMedicion ` +
        `del proyecto "${proyecto}" (se esperaba ${porDefecto}). Quitá o corregí la variable.`
    );
  }

  return { modo, proyecto, region, functionsBase, identityBase, procesarMedicionUrl };
}

function imprimirEncabezado(titulo, entorno, { escribe, soloLectura = false, detalle = [] }) {
  const destino =
    entorno.modo === "emulador"
      ? `${entorno.proyecto}  (EMULADOR LOCAL: no toca la nube)`
      : `${entorno.proyecto}  (PROYECTO REAL en la nube)`;

  console.log("=".repeat(64));
  console.log(` ${titulo}`);
  console.log("=".repeat(64));
  console.log(` Proyecto destino : ${destino}`);
  console.log(` Funciones        : ${entorno.functionsBase}`);
  console.log(
    ` Modo             : ${
      soloLectura
        ? "SOLO LECTURA (no se escribe nada)"
        : escribe
          ? "ESCRITURA (--confirmar)"
          : "SIMULACRO (no se escribe nada)"
    }`
  );
  detalle.forEach((linea) => console.log(` ${linea}`));
  console.log("=".repeat(64));
}

// =========================================================
// ADMIN SDK
// =========================================================

function iniciarAdmin(entorno) {
  const admin = require("firebase-admin");

  admin.initializeApp({ projectId: entorno.proyecto });

  return admin;
}

// =========================================================
// HTTP
// =========================================================

async function peticionJson(url, { metodo = "POST", cuerpo, cabeceras = {}, timeoutMs = 60000 } = {}) {
  const respuesta = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...cabeceras },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const datos = await respuesta.json().catch(() => ({}));

  return { status: respuesta.status, ok: respuesta.ok, datos };
}

/**
 * ID token del administrador SIN usar su contraseña: la cuenta de servicio
 * emite un custom token para su uid y se intercambia en Identity Toolkit
 * (accounts:signInWithCustomToken). El ID token conserva el custom claim
 * "role" del usuario; se comprueba antes de usarlo.
 */
async function obtenerIdTokenAdmin(entorno, admin, uid, apiKey) {
  if (!apiKey) {
    abortar(
      "Falta la API key web de Firebase (la pública, la de VITE_FIREBASE_API_KEY): pasala con " +
        "--api-key o exportá VITE_FIREBASE_API_KEY. Hace falta para actuar como administrador."
    );
  }

  const tokenPersonalizado = await admin.auth().createCustomToken(uid);

  const { datos } = await peticionJson(
    `${entorno.identityBase}/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    { cuerpo: { token: tokenPersonalizado, returnSecureToken: true } }
  );

  if (!datos.idToken) {
    const motivo = datos.error && datos.error.message ? datos.error.message : "respuesta inesperada";
    throw new Error(`No se pudo obtener el ID token del administrador (${motivo}).`);
  }

  let carga;

  try {
    carga = JSON.parse(Buffer.from(datos.idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("El ID token del administrador no se pudo leer.");
  }

  if (carga.role !== "administrador") {
    throw new Error(
      "El ID token obtenido NO conserva el claim role=administrador; no se puede actuar como " +
        "administrador por esta vía."
    );
  }

  return datos.idToken;
}

async function llamarCallable(entorno, nombre, data, idToken) {
  const { status, ok, datos } = await peticionJson(`${entorno.functionsBase}/${nombre}`, {
    cuerpo: { data },
    cabeceras: { Authorization: `Bearer ${idToken}` },
  });

  if (datos.error) {
    const { status: codigo, message } = datos.error;

    throw new Error(`${nombre}: ${codigo}${message && message !== codigo ? ` - ${message}` : ""}`);
  }

  if (!ok) {
    throw new Error(`${nombre}: HTTP ${status}`);
  }

  return datos.result;
}

/**
 * POST a procesarMedicion con reintentos para errores transitorios (5xx,
 * 408, 429, red). Un 4xx permanente (401/403 = token incorrecto, 404 =
 * dispositivo inexistente...) corta de inmediato.
 */
async function enviarMedicion(entorno, token, medicion) {
  let ultimoError;

  for (let intento = 0; intento < 4; intento += 1) {
    try {
      const { status, ok, datos } = await peticionJson(entorno.procesarMedicionUrl, {
        cuerpo: medicion,
        cabeceras: { Authorization: `Bearer ${token}` },
        timeoutMs: 30000,
      });

      if (ok) {
        return datos;
      }

      const detalle = datos && datos.error ? `: ${datos.error}` : "";
      const error = new Error(`procesarMedicion respondió HTTP ${status}${detalle}`);

      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
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

    await esperar(500 * 2 ** intento);
  }

  throw ultimoError;
}

// =========================================================
// INCUBADORAS
// =========================================================

/**
 * Resuelve una incubadora a partir de un texto: id exacto, nombre exacto,
 * una letra ("A", "B", "C") o un fragmento único del nombre.
 */
async function resolverIncubadora(db, texto) {
  const buscado = String(texto || "").trim();

  if (!buscado) {
    abortar("Indicá una incubadora (id, nombre o letra A/B/C).");
  }

  if (!buscado.includes("/") && buscado !== "." && buscado !== "..") {
    const porId = await db.collection("incubadoras").doc(buscado).get();

    if (porId.exists) {
      return { id: porId.id, ...porId.data() };
    }
  }

  const todas = (await db.collection("incubadoras").get()).docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  const minuscula = buscado.toLowerCase();
  const exactas = todas.filter((i) => String(i.nombre).toLowerCase() === minuscula);

  if (exactas.length === 1) {
    return exactas[0];
  }

  let candidatas;

  if (/^[a-z]$/i.test(buscado)) {
    const patron = new RegExp(`^Incubadora\\s+${buscado}\\b`, "i");

    candidatas = todas.filter((i) => patron.test(String(i.nombre)));
  } else {
    candidatas = todas.filter((i) => String(i.nombre).toLowerCase().includes(minuscula));
  }

  if (candidatas.length === 1) {
    return candidatas[0];
  }

  if (candidatas.length === 0) {
    abortar(
      `No se encontró ninguna incubadora para "${buscado}". Disponibles:\n` +
        todas.map((i) => `   - ${i.nombre} (id ${i.id})`).join("\n")
    );
  }

  abortar(
    `"${buscado}" coincide con más de una incubadora; usá el id exacto:\n` +
      candidatas.map((i) => `   - ${i.nombre} (id ${i.id})`).join("\n")
  );

  return null;
}

/** Dispositivos de una incubadora, ordenados del más antiguo al más nuevo. */
async function dispositivosDe(db, incubadoraId) {
  const snap = await db.collection("dispositivos").where("incubadoraId", "==", incubadoraId).get();
  const marca = (d) => (d.creadoEn && d.creadoEn.toMillis ? d.creadoEn.toMillis() : 0);

  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => marca(a) - marca(b) || a.id.localeCompare(b.id));
}

/**
 * Ejecuta `tarea` (que envía lecturas a procesarMedicion como si fueran de
 * ciertos sensores) y después devuelve a esos sensores el estado de conexión
 * que tenían ANTES.
 *
 * Por qué: procesarMedicion marca "conectado" al dispositivo que envía una
 * lectura. Pero estas lecturas son de relleno o de escenario, no de un
 * equipo real emitiendo latidos. Si el sensor queda "conectado" sin latidos,
 * la próxima vez que arranque el Servicio de Integración lo carga como
 * conectado, no recibe ninguna señal y a los 30 s lo marca "desconectado" y
 * crea una alerta de desconexión (la incubadora pasa a "Crítico"). Se
 * respeta el estado previo; si el sensor ya estaba "conectado" (porque un
 * simulador o un equipo real lo está manteniendo vivo) no se toca nada.
 */
async function conservarConexion(db, dispositivoIds, tarea) {
  const antes = new Map();

  for (const id of dispositivoIds) {
    const snap = await db.collection("dispositivos").doc(id).get();

    if (snap.exists) {
      const d = snap.data();

      antes.set(id, {
        estadoConexion: d.estadoConexion || "desconocido",
        ultimaComunicacionEn: d.ultimaComunicacionEn || null,
      });
    }
  }

  try {
    return await tarea();
  } finally {
    for (const [id, previo] of antes) {
      if (previo.estadoConexion !== "conectado") {
        await db.collection("dispositivos").doc(id).update(previo);
      }
    }
  }
}

// =========================================================
// UTILIDADES NUMÉRICAS Y DE TEXTO
// =========================================================

const redondear1 = (n) => Math.round(n * 10) / 10;

function hora(valor) {
  const ms = valor && valor.toMillis ? valor.toMillis() : valor instanceof Date ? valor.getTime() : null;

  if (ms === null || ms === undefined) {
    return "-";
  }

  return new Date(ms).toLocaleTimeString("es-AR", { hour12: false });
}

function hace(valor) {
  const ms = valor && valor.toMillis ? valor.toMillis() : valor instanceof Date ? valor.getTime() : null;

  if (ms === null || ms === undefined) {
    return "";
  }

  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));

  if (s < 90) return `hace ${s} s`;
  if (s < 5400) return `hace ${Math.round(s / 60)} min`;

  return `hace ${(s / 3600).toFixed(1)} h`;
}

function idCorto(id) {
  return String(id).slice(0, 6);
}

module.exports = {
  INCUBADORAS_DEMO,
  UMBRALES_DEMO,
  REGLA_DEMO,
  UNIDAD_POR_VARIABLE,
  MARGEN_RESOLUCION,
  REGION_POR_DEFECTO,
  abortar,
  esperar,
  leerArgumentos,
  hostLocal,
  validarEntorno,
  imprimirEncabezado,
  iniciarAdmin,
  obtenerIdTokenAdmin,
  llamarCallable,
  enviarMedicion,
  resolverIncubadora,
  dispositivosDe,
  conservarConexion,
  redondear1,
  hora,
  hace,
  idCorto,
  crypto,
  path,
  fs,
};
