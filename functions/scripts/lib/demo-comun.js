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

class Abortado extends Error {}

/**
 * Corta la ejecución con un mensaje claro. Lanza (no llama a process.exit):
 * en Windows, salir de golpe con conexiones del Admin SDK abiertas puede
 * dejar el proceso con código 127 y un "Assertion failed ... async.c".
 * `ejecutar` lo captura y sale ordenadamente.
 */
function abortar(mensaje) {
  throw new Abortado(mensaje);
}

function salir(codigo) {
  process.exitCode = codigo;
  // Pequeña demora para que se cierren los handles antes de salir.
  setTimeout(() => process.exit(codigo), 300);
}

/** Ejecuta `principal` (async), imprime los errores y sale con el código correcto. */
function ejecutar(principal) {
  principal()
    .then(() => salir(process.exitCode || 0))
    .catch((error) => {
      if (error instanceof Abortado) {
        console.error(`\nABORTADO: ${error.message}\n`);
      } else {
        console.error(`\nERROR: ${error.message}`);
      }

      salir(1);
    });
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
 * emite un custom token para su uid (con su rol como developer claim, así
 * el ID token lo trae seguro) y se intercambia en Identity Toolkit
 * (accounts:signInWithCustomToken). Se comprueba que el ID token resultante
 * traiga role=administrador antes de usarlo. Lanza Error (no aborta) para que
 * el pre-vuelo pueda informarlo.
 */
async function obtenerIdTokenAdmin(entorno, admin, uid, apiKey, role) {
  if (!apiKey) {
    throw new Error(
      "falta la API key web de Firebase (la pública, la de VITE_FIREBASE_API_KEY): pasala con " +
        "--api-key o exportá VITE_FIREBASE_API_KEY"
    );
  }

  const tokenPersonalizado = await admin.auth().createCustomToken(uid, role ? { role } : undefined);

  const { datos } = await peticionJson(
    `${entorno.identityBase}/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
    { cuerpo: { token: tokenPersonalizado, returnSecureToken: true } }
  );

  if (!datos.idToken) {
    const motivo = datos.error && datos.error.message ? datos.error.message : "respuesta inesperada";
    const pista = /INVALID_CUSTOM_TOKEN|CREDENTIAL_MISMATCH/.test(motivo)
      ? " (la API key no es de este proyecto, o la clave de servicio no corresponde al proyecto)"
      : /API key|API_KEY/i.test(motivo)
        ? " (la API key no es válida)"
        : "";

    throw new Error(`Identity Toolkit rechazó el intercambio: ${motivo}${pista}`);
  }

  let carga;

  try {
    carga = JSON.parse(Buffer.from(datos.idToken.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("El ID token del administrador no se pudo leer.");
  }

  if (carga.role !== "administrador") {
    throw new Error(
      "el ID token obtenido NO trae el claim role=administrador; no se puede actuar como administrador por esta vía"
    );
  }

  return datos.idToken;
}

/**
 * PRE-VUELO (i)+(iii): intercambia el custom token por un ID token y verifica
 * el claim role. Crea solo una sesión del administrador (no escribe datos).
 * Un fallo con INVALID_CUSTOM_TOKEN delata una API key de otro proyecto.
 */
async function preVueloIdToken(entorno, admin, uid, apiKey, role) {
  try {
    const idToken = await obtenerIdTokenAdmin(entorno, admin, uid, apiKey, role);

    return {
      nombre: "(i)+(iii) ID token del administrador con claim role, y API key del proyecto",
      ok: true,
      mensaje: "OK (se creó una sesión del administrador; no se escribió ningún dato)",
      idToken,
    };
  } catch (error) {
    return {
      nombre: "(i)+(iii) ID token del administrador con claim role, y API key del proyecto",
      ok: false,
      mensaje: error.message,
    };
  }
}

/**
 * PRE-VUELO (ii): POST {} con el Bearer a procesarMedicion. La función valida
 * el token ANTES de tocar Firestore: con un token válido responde 400 (payload
 * incompleto) y con uno inválido 403; en ningún caso escribe.
 */
async function preVueloTokenMedicion(entorno, token) {
  const nombre = "(ii) token de procesarMedicion";

  if (!token) {
    return { nombre, ok: false, mensaje: "falta la variable PROCESAR_MEDICION_TOKEN" };
  }

  try {
    const { status } = await peticionJson(entorno.procesarMedicionUrl, {
      cuerpo: {},
      cabeceras: { Authorization: `Bearer ${token}` },
      timeoutMs: 30000,
    });

    if (status === 400) {
      return { nombre, ok: true, mensaje: "OK (HTTP 400: token válido; la función rechazó el payload vacío sin escribir)" };
    }

    if (status === 403 || status === 401) {
      return { nombre, ok: false, mensaje: `HTTP ${status}: el token NO es el que acepta la función (INTEGRATION_SERVICE_TOKEN)` };
    }

    if (status === 404) {
      return { nombre, ok: false, mensaje: "HTTP 404: la función procesarMedicion no existe en ese proyecto/región" };
    }

    return { nombre, ok: false, mensaje: `respuesta inesperada HTTP ${status}` };
  } catch (error) {
    return { nombre, ok: false, mensaje: `no se pudo llamar a procesarMedicion (${error.message})` };
  }
}

/** Imprime el resumen del pre-vuelo y devuelve true si todo está OK. */
function imprimirPreVuelo(resultados) {
  console.log("\n== PRE-VUELO (comprobaciones sin escribir datos)");

  for (const r of resultados) {
    console.log(`   PRE-VUELO ${r.nombre}: ${r.ok ? "OK" : "FALLO"} - ${r.mensaje}`);
  }

  const ok = resultados.every((r) => r.ok);

  console.log(`   PRE-VUELO RESUMEN: ${ok ? "OK" : "FALLO"}`);

  return ok;
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

const esDemo = (incubadora) => /\(demo\)/i.test(String(incubadora.nombre));

/**
 * Resuelve una incubadora a partir de un texto: id exacto, nombre exacto,
 * una letra ("A", "B", "C") o un fragmento único del nombre. SIEMPRE prefiere
 * las incubadoras de la demo (nombre con «(demo)»): una incubadora real cuyo
 * nombre también empiece con "Incubadora A" no se confunde con la de la demo.
 * Si sigue habiendo más de una candidata, aborta.
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
  let candidatas = todas.filter((i) => String(i.nombre).toLowerCase() === minuscula);

  if (candidatas.length === 0) {
    if (/^[a-z]$/i.test(buscado)) {
      const patron = new RegExp(`^Incubadora\\s+${buscado}\\b`, "i");

      candidatas = todas.filter((i) => patron.test(String(i.nombre)));
    } else {
      candidatas = todas.filter((i) => String(i.nombre).toLowerCase().includes(minuscula));
    }
  }

  const demo = candidatas.filter(esDemo);

  if (demo.length > 0) {
    candidatas = demo;
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

// Una comunicación más vieja que esto no cuenta como "conectado legítimo".
const VENTANA_CONECTADO_RECIENTE_MS = 60 * 1000;

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
 * crea una alerta de desconexión (la incubadora pasa a "Crítico").
 *
 * Restauración:
 *   - estado previo "conectado" CON comunicación reciente (< 60 s): es un
 *     equipo vivo (simulador o real); no se toca;
 *   - estado previo "conectado" pero con comunicación vieja o sin fecha:
 *     estaba "colgado"; se restaura a "desconocido";
 *   - cualquier otro estado previo: se restaura tal cual.
 * Se ejecuta también si la tarea falla y si llega SIGINT/SIGTERM (Ctrl+C):
 * en ese caso se restaura y se sale con código 130. Un error al restaurar se
 * informa pero no tapa el error original de la tarea.
 */
async function conservarConexion(db, dispositivoIds, tarea) {
  const antes = new Map();

  for (const id of dispositivoIds) {
    const snap = await db.collection("dispositivos").doc(id).get();

    if (snap.exists) {
      const d = snap.data();
      const ultima = d.ultimaComunicacionEn && d.ultimaComunicacionEn.toMillis ? d.ultimaComunicacionEn.toMillis() : null;
      let estado = d.estadoConexion || "desconocido";

      if (estado === "conectado" && !(ultima !== null && Date.now() - ultima < VENTANA_CONECTADO_RECIENTE_MS)) {
        estado = "desconocido";
      }

      antes.set(id, {
        conservar: estado === "conectado",
        valores: { estadoConexion: estado, ultimaComunicacionEn: d.ultimaComunicacionEn || null },
      });
    }
  }

  let restaurado = false;
  const restaurar = async () => {
    if (restaurado) return;
    restaurado = true;

    for (const [id, previo] of antes) {
      if (previo.conservar) continue;

      try {
        await db.collection("dispositivos").doc(id).update(previo.valores);
      } catch (error) {
        console.error(`AVISO: no se pudo restaurar el estado de conexión de ${id}: ${error.message}`);
      }
    }
  };

  const alSenal = (senal) => {
    console.error(`\n ${senal || "Interrupción"}: restaurando el estado de conexión de los sensores y saliendo...`);
    restaurar().finally(() => process.exit(130));
  };

  process.once("SIGINT", alSenal);
  process.once("SIGTERM", alSenal);

  try {
    return await tarea();
  } finally {
    process.removeListener("SIGINT", alSenal);
    process.removeListener("SIGTERM", alSenal);
    await restaurar();
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
  ejecutar,
  esperar,
  leerArgumentos,
  hostLocal,
  validarEntorno,
  imprimirEncabezado,
  iniciarAdmin,
  obtenerIdTokenAdmin,
  preVueloIdToken,
  preVueloTokenMedicion,
  imprimirPreVuelo,
  esDemo,
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
