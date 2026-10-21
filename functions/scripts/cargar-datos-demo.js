#!/usr/bin/env node
"use strict";

/**
 * Carga un conjunto coherente de DATOS DE DEMO para mostrar lo implementado
 * en los Sprints 1 a 4 (autenticación y roles, usuarios, incubadoras y
 * dispositivos, monitorización, umbrales y alertas, ventiladores manual y
 * automático).
 *
 * Es SEGURO POR DISEÑO:
 *   - Por defecto es un SIMULACRO: lee, compara y muestra qué haría, pero no
 *     escribe nada. Solo escribe con --confirmar.
 *   - Imprime SIEMPRE el proyecto destino.
 *   - --proyecto es obligatorio. Sin emuladores exige
 *     GOOGLE_APPLICATION_CREDENTIALS y que el project_id de esa clave sea el
 *     de --proyecto (ver functions/scripts/lib/demo-comun.js).
 *   - Nunca imprime contraseñas ni tokens.
 *
 * Es IDEMPOTENTE: lo que ya existe se reutiliza (usuarios por correo,
 * incubadoras por nombre, dispositivos por tipo, umbrales y regla por id,
 * mediciones históricas por instante, alertas por incubadora + tipo).
 *
 * Usa la LÓGICA REAL, no copia formas de documentos:
 *   - usuarios operador/consulta: callable gestionarUsuario
 *   - incubadoras: callable gestionarIncubadora
 *   - dispositivos (y el documento del ventilador): callable crearDispositivo
 *   - regla del ventilador: callable guardarReglaAutomatizacion
 *   - mediciones: HTTP procesarMedicion (pasan por evaluarUmbrales)
 *   Las callables se invocan como el administrador existente (--admin-email)
 *   sin conocer su contraseña: la cuenta de servicio emite un custom token y
 *   se cambia por un ID token (necesita la API key web pública).
 *   Los umbrales los escribe el Admin SDK con la misma forma que escribe el
 *   frontend (umbralesRepository.guardarUmbral).
 *
 * Ver el uso completo con:  node functions/scripts/cargar-datos-demo.js --help
 */

const { FieldValue } = require("firebase-admin/firestore");
const lib = require("./lib/demo-comun");

const { fs, path, crypto } = lib;

const ARCHIVO_CREDENCIALES = path.join(__dirname, "demo-credenciales.local.json");

const AYUDA = `Uso:
  node functions/scripts/cargar-datos-demo.js --proyecto <id> --admin-email <correo> [opciones]

Sin --confirmar es un SIMULACRO: no escribe nada y muestra qué haría.

Obligatorios:
  --proyecto <id>        Proyecto de Firebase destino (p. ej. mtpa-dev). Debe coincidir
                         con el project_id de GOOGLE_APPLICATION_CREDENTIALS, salvo que
                         uses emuladores (FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST).
  --admin-email <correo> Correo del administrador que YA existe (no se crea ni se toca).

Opciones:
  --confirmar            Escribe de verdad. Sin esto, simulacro.
  --operador-email <c>   Correo del usuario operador de demo   (def.: operador.demo@mtpa.test)
  --consulta-email <c>   Correo del usuario de consulta de demo (def.: consulta.demo@mtpa.test)
  --api-key <clave>      API key WEB pública de Firebase (la de VITE_FIREBASE_API_KEY).
                         También se lee de la variable VITE_FIREBASE_API_KEY.
  --region <region>      Región de las funciones (def.: us-central1).
  --horas <n>            Horas de histórico sano a cargar (def.: 12; una lectura cada 10 min).
  --sin-historico        No carga mediciones históricas.
  --sin-alertas          No genera las alertas de ciclo de vida.
  --restablecer-claves   Genera una clave nueva para operador/consulta ya existentes.
  --solo-claves          Hace ÚNICAMENTE lo de --restablecer-claves (usuarios operador/consulta que ya
                         existen) y nada más: no toca incubadoras, datos ni al administrador, y no exige
                         --admin-email. Para el Plan B de un login que falla.
  -h, --help             Esta ayuda.

PRE-VUELO: antes de escribir (y también en el simulacro) comprueba, sin escribir datos, el intercambio del
token del administrador con el claim de rol (y que la API key sea de este proyecto) y el token de
procesarMedicion. Si algo falla, con --confirmar aborta ANTES de escribir.

Variables de entorno:
  GOOGLE_APPLICATION_CREDENTIALS   Clave de cuenta de servicio del proyecto (sin emuladores).
  PROCESAR_MEDICION_TOKEN          Token de procesarMedicion (histórico y alertas).
  VITE_FIREBASE_API_KEY            API key web pública (alternativa a --api-key).

Las contraseñas de operador/consulta se generan al azar la primera vez y se guardan SOLO en
functions/scripts/demo-credenciales.local.json (ignorado por git; en Windows el archivo queda con los
permisos de la carpeta). No se imprimen.`;

// =========================================================
// UTILIDADES LOCALES
// =========================================================

const paso = (titulo) => console.log(`\n== ${titulo}`);
const linea = (texto) => console.log(`   ${texto}`);

function mulberry32(semilla) {
  let a = semilla >>> 0;

  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);

    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function semilla(texto) {
  let h = 2166136261;

  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}

/**
 * Valor sano y reproducible de una lectura histórica.
 *
 * Temperatura 37.45 ± 0.35 (entre 37.1 y 37.8): dentro de los límites
 * 36.5-38.5 y POR ENCIMA de 37.0, el punto en que la regla del ventilador
 * (activación 38.5, histéresis 1.5) ordenaría apagarlo; así un histórico
 * cargado con la regla ya guardada tampoco genera órdenes. Humedad 58 ± 3
 * (entre 55 y 61): dentro de 50-65.
 */
function valorHistorico(variable, sensorId, instanteMs) {
  const azar = mulberry32(semilla(`${sensorId}:${instanteMs}`))();
  const horas = instanteMs / 3600000;

  if (variable === "temperatura") {
    return lib.redondear1(37.45 + 0.25 * Math.sin(horas * 1.3) + (azar - 0.5) * 0.2);
  }

  return lib.redondear1(58 + 2 * Math.sin(horas * 0.9) + (azar - 0.5) * 2);
}

function generarClave() {
  return crypto.randomBytes(15).toString("base64url");
}

// =========================================================
// CREDENCIALES LOCALES (solo en un archivo ignorado por git)
// =========================================================

// Las claves se guardan bajo "<modo>:<proyecto>" (p. ej. "real:mtpa-dev" o
// "emulador:demo-mtpa") para que las de un emulador nunca queden bajo el
// nombre de un proyecto real.
function leerCredenciales(entorno) {
  const clave = `${entorno.modo}:${entorno.proyecto}`;

  try {
    const todo = JSON.parse(fs.readFileSync(ARCHIVO_CREDENCIALES, "utf8"));

    return { clave, todo, mios: (todo && todo[clave]) || {}, danado: false };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { clave, todo: {}, mios: {}, danado: false };
    }

    return { clave, todo: {}, mios: {}, danado: true, motivo: error.message };
  }
}

function guardarCredencial(estado, rol, correo, password) {
  estado.mios[rol] = { correo, password };
  estado.todo[estado.clave] = estado.mios;

  // En Windows el modo 0o600 no restringe nada: el archivo queda con los
  // permisos de la carpeta (functions/scripts/, ignorada por git).
  fs.writeFileSync(ARCHIVO_CREDENCIALES, JSON.stringify(estado.todo, null, 2), { mode: 0o600 });
}

// =========================================================
// 1. USUARIOS
// =========================================================

async function asegurarUsuario(ctx, { rol, nombre, correo }) {
  const { auth, db } = ctx;

  const existente = await auth.getUserByEmail(correo).catch((error) => {
    if (error.code === "auth/user-not-found") {
      return null;
    }

    throw error;
  });

  if (existente) {
    const claimRol = existente.customClaims && existente.customClaims.role;
    const docRef = db.collection("usuarios").doc(existente.uid);
    const doc = await docRef.get();
    const docRol = doc.exists ? doc.data().rol : null;

    if ((claimRol && claimRol !== rol) || (docRol && docRol !== rol)) {
      lib.abortar(
        `El correo ${correo} ya existe con el rol "${claimRol || docRol}", no con "${rol}". ` +
          `Elegí otro correo con --${rol}-email.`
      );
    }

    const completo =
      claimRol === rol && doc.exists && doc.data().activo === true && !existente.disabled;

    if (!completo) {
      if (!ctx.escribe) {
        linea(`[simulacro] ${rol}: ${correo} existe pero está incompleto; lo repararía (claim, documento, habilitado).`);
      } else {
        await auth.setCustomUserClaims(existente.uid, { role: rol });
        await auth.updateUser(existente.uid, { disabled: false });
        await docRef.set(
          {
            uid: existente.uid,
            nombre,
            correo,
            rol,
            activo: true,
            ...(doc.exists ? {} : { creadoEn: FieldValue.serverTimestamp() }),
          },
          { merge: true }
        );
        linea(`${rol}: ${correo} existía incompleto; reparado.`);
      }
    } else {
      linea(`${rol}: ${correo} ya existe; se reutiliza.`);
    }

    if (ctx.restablecerClaves && ctx.escribe) {
      const clave = generarClave();

      await auth.updateUser(existente.uid, { password: clave });
      guardarCredencial(ctx.credenciales, rol, correo, clave);
      linea(`${rol}: clave nueva generada (guardada en el archivo local).`);
    } else if (ctx.restablecerClaves) {
      linea(`[simulacro] ${rol}: generaría una clave nueva (--restablecer-claves).`);
    } else if (!ctx.credenciales.mios[rol] || ctx.credenciales.mios[rol].correo !== correo) {
      linea(
        `AVISO ${rol}: no hay clave guardada para ${correo} en ${path.basename(ARCHIVO_CREDENCIALES)} ` +
          "(se creó en otra máquina o antes). Usá --restablecer-claves para generar una nueva."
      );
    }

    return { uid: existente.uid, estado: "reutilizado" };
  }

  if (!ctx.escribe) {
    linea(`[simulacro] ${rol}: crearía ${correo} (callable gestionarUsuario) con una clave aleatoria.`);

    return { uid: null, estado: "se crearía" };
  }

  const tokenAdmin = await ctx.tokenAdmin();
  const { uid } = await lib.llamarCallable(
    ctx.entorno,
    "gestionarUsuario",
    { accion: "crear", nombre, correo, rol },
    tokenAdmin
  );

  // La callable crea al usuario sin clave: se le asigna una aleatoria.
  const clave = generarClave();

  await auth.updateUser(uid, { password: clave });
  guardarCredencial(ctx.credenciales, rol, correo, clave);
  linea(`${rol}: ${correo} creado (clave aleatoria guardada en el archivo local).`);

  return { uid, estado: "creado" };
}

// =========================================================
// 2. INCUBADORAS
// =========================================================

async function asegurarIncubadora(ctx, definicion) {
  const snap = await ctx.db.collection("incubadoras").where("nombre", "==", definicion.nombre).get();

  if (!snap.empty) {
    const docs = snap.docs.sort((a, b) => a.id.localeCompare(b.id));
    const doc = docs[0];

    linea(`${definicion.clave}: «${definicion.nombre}» ya existe (id ${doc.id}); se reutiliza.`);

    if (docs.length > 1) {
      linea(`AVISO ${definicion.clave}: hay ${docs.length} incubadoras con ese nombre; se usa la de id ${doc.id}.`);
    }

    if (doc.data().estado !== definicion.estado) {
      linea(
        `AVISO ${definicion.clave}: su estado es "${doc.data().estado}" y la demo la espera "${definicion.estado}"; no se modifica.`
      );
    }

    return { ...definicion, id: doc.id, estadoCarga: "reutilizada" };
  }

  if (!ctx.escribe) {
    linea(`[simulacro] ${definicion.clave}: crearía «${definicion.nombre}» (${definicion.estado}) con gestionarIncubadora.`);

    return { ...definicion, id: null, estadoCarga: "se crearía" };
  }

  const tokenAdmin = await ctx.tokenAdmin();
  const { id } = await lib.llamarCallable(
    ctx.entorno,
    "gestionarIncubadora",
    {
      accion: "crear",
      nombre: definicion.nombre,
      ubicacion: definicion.ubicacion,
      estado: definicion.estado,
    },
    tokenAdmin
  );

  linea(`${definicion.clave}: «${definicion.nombre}» creada (id ${id}, ${definicion.estado}).`);

  return { ...definicion, id, estadoCarga: "creada" };
}

// =========================================================
// 3. DISPOSITIVOS
// =========================================================

const TIPOS_POR_INCUBADORA_ACTIVA = ["sensor_temperatura", "sensor_humedad", "ventilador"];

async function asegurarDispositivos(ctx, incubadora) {
  const existentes = incubadora.id ? await lib.dispositivosDe(ctx.db, incubadora.id) : [];
  const resultado = {};

  for (const tipo of TIPOS_POR_INCUBADORA_ACTIVA) {
    const iguales = existentes.filter((d) => d.tipo === tipo);

    if (iguales.length > 0) {
      resultado[tipo] = iguales[0];
      linea(`${incubadora.clave}: ${tipo} ya existe (id ${iguales[0].id}); se reutiliza.`);
      continue;
    }

    if (!ctx.escribe) {
      resultado[tipo] = null;
      linea(`[simulacro] ${incubadora.clave}: crearía un ${tipo} con crearDispositivo.`);
      continue;
    }

    const tokenAdmin = await ctx.tokenAdmin();
    const { id, identificadorMqtt } = await lib.llamarCallable(
      ctx.entorno,
      "crearDispositivo",
      { incubadoraId: incubadora.id, tipo },
      tokenAdmin
    );

    resultado[tipo] = { id, tipo, incubadoraId: incubadora.id, identificadorMqtt };
    linea(`${incubadora.clave}: ${tipo} creado (id ${id}).`);
  }

  const ventilador = resultado.ventilador;

  if (ventilador && ventilador.id) {
    const doc = await ctx.db.collection("ventiladores").doc(ventilador.id).get();

    if (!doc.exists && ctx.escribe) {
      linea(
        `AVISO ${incubadora.clave}: el dispositivo ventilador ${ventilador.id} no tiene documento en ` +
          '"ventiladores" (ver functions/scripts/crear-documentos-ventiladores.js).'
      );
    }
  }

  return resultado;
}

// =========================================================
// 4. UMBRALES
// =========================================================

async function asegurarUmbrales(ctx, incubadora) {
  for (const [variable, limites] of Object.entries(lib.UMBRALES_DEMO)) {
    const ref = incubadora.id ? ctx.db.collection("umbrales").doc(`${incubadora.id}_${variable}`) : null;
    const snap = ref ? await ref.get() : null;

    if (snap && snap.exists) {
      const d = snap.data();
      const igual = d.minimo === limites.minimo && d.maximo === limites.maximo;

      linea(
        `${incubadora.clave}: umbral de ${variable} ya existe (${d.minimo}-${d.maximo} ${limites.unidad}); se deja tal cual` +
          (igual ? "." : ` (la demo usaría ${limites.minimo}-${limites.maximo}).`)
      );
      continue;
    }

    if (!ctx.escribe) {
      linea(`[simulacro] ${incubadora.clave}: escribiría el umbral de ${variable}: ${limites.minimo}-${limites.maximo} ${limites.unidad}.`);
      continue;
    }

    // Misma forma que umbralesRepository.guardarUmbral (frontend).
    await ref.set(
      {
        incubadoraId: incubadora.id,
        variable,
        minimo: limites.minimo,
        maximo: limites.maximo,
        actualizadoEn: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    linea(`${incubadora.clave}: umbral de ${variable} escrito (${limites.minimo}-${limites.maximo} ${limites.unidad}).`);
  }
}

// =========================================================
// 5. HISTÓRICO SANO
// =========================================================

const INTERVALO_HISTORICO_MS = 10 * 60 * 1000;
const PAUSA_ENTRE_RONDAS_MS = 250;

async function cargarHistorico(ctx, objetivos) {
  // objetivos: [{ incubadora, variable, sensor }]
  const cantidad = Math.max(1, Math.round((ctx.horas * 60) / 10));
  // Último instante: múltiplo de 10 min, al menos 2 min en el pasado.
  const fin = Math.floor((Date.now() - 2 * 60 * 1000) / INTERVALO_HISTORICO_MS) * INTERVALO_HISTORICO_MS;
  const instantes = Array.from({ length: cantidad }, (_, i) => fin - (cantidad - 1 - i) * INTERVALO_HISTORICO_MS);

  const pendientes = [];

  for (const objetivo of objetivos) {
    const { incubadora, variable, sensor } = objetivo;
    let existentes = new Set();

    if (sensor && sensor.id) {
      const snap = await ctx.db
        .collection("mediciones")
        .where("dispositivoId", "==", sensor.id)
        .select("medidoEn")
        .get();

      existentes = new Set(
        snap.docs.map((d) => d.data().medidoEn).filter(Boolean).map((t) => t.toMillis())
      );
    }

    let faltan = instantes.filter((ms) => !existentes.has(ms));
    let omitidas = 0;

    // Si la incubadora tiene alertas abiertas de esta variable NO se envía
    // nada: evaluarUmbrales usa el VALOR de la lectura (no su fecha), así que
    // cualquier lectura sana, aunque lleve una fecha vieja, las RESOLVERÍA y
    // rompería el estado de demo (B con alertas abiertas).
    if (incubadora.id) {
      const snapAlertas = await ctx.db.collection("alertas").where("incubadoraId", "==", incubadora.id).get();
      const hayAbiertas = snapAlertas.docs.some((d) => {
        const a = d.data();

        return a.variable === variable && a.estado !== "resuelta";
      });

      if (hayAbiertas) {
        omitidas = faltan.length;
        faltan = [];
      }
    }

    linea(
      `${incubadora.clave}: ${variable}: ${faltan.length} lectura(s) por enviar, ${existentes.size} ya existen ` +
        `(una cada 10 min durante ${ctx.horas} h).` +
        (omitidas > 0
          ? ` No se envía histórico: hay alertas abiertas de ${variable} y una lectura sana las resolvería.`
          : "")
    );

    objetivo.faltan = faltan;
    pendientes.push(objetivo);
  }

  if (!ctx.escribe) {
    linea("[simulacro] no se envía ninguna lectura.");

    return;
  }

  // Rondas cronológicas: en cada ronda, una lectura por sensor (4 sensores en
  // paralelo, ninguno repetido) y una pausa corta para no saturar.
  const rondas = new Map();

  for (const objetivo of pendientes) {
    for (const ms of objetivo.faltan) {
      if (!rondas.has(ms)) rondas.set(ms, []);
      rondas.get(ms).push(objetivo);
    }
  }

  const ordenadas = [...rondas.keys()].sort((a, b) => a - b);
  let enviadas = 0;
  const total = [...rondas.values()].reduce((suma, lista) => suma + lista.length, 0);

  for (const ms of ordenadas) {
    // allSettled: si una falla, las demás de la ronda terminan ANTES de que el
    // error suba (y de que se restaure el estado de conexión de los sensores).
    const resultados = await Promise.allSettled(
      rondas.get(ms).map(({ incubadora, variable, sensor }) =>
        lib.enviarMedicion(ctx.entorno, ctx.tokenMedicion, {
          incubadoraId: incubadora.id,
          dispositivoId: sensor.id,
          variable,
          valor: valorHistorico(variable, sensor.id, ms),
          unidad: lib.UNIDAD_POR_VARIABLE[variable],
          medidoEn: new Date(ms).toISOString(),
        })
      )
    );
    const fallo = resultados.find((r) => r.status === "rejected");

    if (fallo) {
      throw fallo.reason;
    }

    enviadas += rondas.get(ms).length;

    if (enviadas % 40 < rondas.get(ms).length) {
      linea(`   ... ${enviadas}/${total} lecturas enviadas`);
    }

    await lib.esperar(PAUSA_ENTRE_RONDAS_MS);
  }

  linea(`${enviadas} lectura(s) históricas enviadas a procesarMedicion.`);
}

// =========================================================
// 6. ALERTAS CON CICLO DE VIDA (Incubadora B)
// =========================================================

// Valores fuera de rango derivados de los límites de la demo.
const T = lib.UMBRALES_DEMO.temperatura;
const H = lib.UMBRALES_DEMO.humedad;

const ALERTAS_DEMO = [
  {
    tipo: "temperatura_alta",
    variable: "temperatura",
    valorFuera: lib.redondear1(T.maximo + 0.9), // 39.4
    valorNormal: 37.4, // resuelve la alerta (<= 38.4) y queda sobre 37.0
    final: "resuelta",
  },
  {
    tipo: "humedad_baja",
    variable: "humedad",
    valorFuera: lib.redondear1(H.minimo - 6), // 44
    final: "reconocida",
  },
  {
    tipo: "temperatura_baja",
    variable: "temperatura",
    valorFuera: lib.redondear1(T.minimo - 0.7), // 35.8
    final: "activa",
  },
];

async function alertasDe(ctx, incubadoraId, tipo) {
  const snap = await ctx.db
    .collection("alertas")
    .where("incubadoraId", "==", incubadoraId)
    .where("tipo", "==", tipo)
    .get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

const esAbierta = (a) => a.estado === "activa" || a.estado === "reconocida";
const creadaMs = (a) => (a.creadaEn && a.creadaEn.toMillis ? a.creadaEn.toMillis() : 0);

/**
 * Deja las alertas de B EXACTAMENTE en el estado declarado en ALERTAS_DEMO
 * (temperatura_alta resuelta, humedad_baja reconocida, temperatura_baja
 * activa), sin duplicar:
 *   - no existe la alerta: se genera con lecturas reales (procesarMedicion);
 *   - existe y está en otro estado (una corrida anterior murió a medias, o
 *     alguien la tocó en un ensayo): se reconcilia con el Admin SDK. Resolver
 *     escribe los mismos campos que evaluarUmbrales; reabrir una resuelta
 *     reutiliza la alerta más reciente (no crea una nueva) y reenvía una
 *     lectura coherente (fuera de rango) que, al haber una alerta abierta del
 *     mismo tipo, no genera otra;
 *   - alertas abiertas duplicadas del mismo tipo: se resuelven las sobrantes.
 */
async function asegurarAlertas(ctx, incubadora, sensores) {
  for (const plan of ALERTAS_DEMO) {
    const previas = incubadora.id
      ? (await alertasDe(ctx, incubadora.id, plan.tipo)).sort((a, b) => creadaMs(b) - creadaMs(a))
      : [];
    const etiqueta = `${incubadora.clave}: alerta ${plan.tipo}`;
    const sensor = sensores[plan.variable === "temperatura" ? "sensor_temperatura" : "sensor_humedad"];
    const enviar = (valor) =>
      lib.enviarMedicion(ctx.entorno, ctx.tokenMedicion, {
        incubadoraId: incubadora.id,
        dispositivoId: sensor.id,
        variable: plan.variable,
        valor,
        unidad: lib.UNIDAD_POR_VARIABLE[plan.variable],
        medidoEn: new Date().toISOString(),
      });
    const resolver = (a) =>
      ctx.db.collection("alertas").doc(a.id).update({
        estado: "resuelta",
        resueltaEn: FieldValue.serverTimestamp(),
        resueltaPor: "sistema",
        valorResolucion: plan.valorNormal !== undefined ? plan.valorNormal : plan.valorFuera,
      });

    if (previas.length === 0) {
      if (!ctx.escribe) {
        linea(
          `[simulacro] ${etiqueta}: enviaría ${plan.variable}=${plan.valorFuera} para generarla` +
            (plan.valorNormal ? `, luego ${plan.valorNormal} para resolverla` : "") +
            (plan.final === "reconocida" ? ", y la pasaría a «reconocida»" : "") +
            `. Queda: ${plan.final}.`
        );
        continue;
      }

      await enviar(plan.valorFuera);

      const creadas = await alertasDe(ctx, incubadora.id, plan.tipo);

      if (creadas.length === 0) {
        throw new Error(
          `La lectura ${plan.variable}=${plan.valorFuera} no generó la alerta ${plan.tipo}. ¿Existe el umbral de ${plan.variable}?`
        );
      }

      if (plan.final === "resuelta") {
        await lib.esperar(1500);
        await enviar(plan.valorNormal);
      }

      if (plan.final === "reconocida") {
        // La regla del cliente solo permite cambiar el campo "estado".
        await ctx.db.collection("alertas").doc(creadas[0].id).update({ estado: "reconocida" });
      }

      const finales = await alertasDe(ctx, incubadora.id, plan.tipo);

      linea(`${etiqueta} generada; estado final: ${finales.map((a) => a.estado).join(", ")}.`);
      await lib.esperar(1500);
      continue;
    }

    const abiertas = previas.filter(esAbierta);

    // Estado declarado: resuelta.
    if (plan.final === "resuelta") {
      if (abiertas.length === 0) {
        linea(`${etiqueta}: ya está resuelta; se deja tal cual.`);
      } else if (!ctx.escribe) {
        linea(`[simulacro] ${etiqueta}: hay ${abiertas.length} abierta(s) y debería estar resuelta; la(s) resolvería.`);
      } else {
        for (const a of abiertas) await resolver(a);
        linea(`${etiqueta}: estaba abierta; se resolvió (estado declarado: resuelta).`);
      }
      continue;
    }

    // Estado declarado: reconocida o activa (alerta ABIERTA).
    let objetivo = abiertas[0];
    let reabrir = false;

    if (!objetivo) {
      objetivo = previas[0];
      reabrir = true;
    }

    const sobrantes = abiertas.slice(1);

    if (!reabrir && objetivo.estado === plan.final && sobrantes.length === 0) {
      linea(`${etiqueta}: ya está ${plan.final}; se deja tal cual.`);
      continue;
    }

    if (!ctx.escribe) {
      linea(
        `[simulacro] ${etiqueta}: ${reabrir ? "está resuelta y la reabriría" : `está ${objetivo.estado}`} para dejarla ${plan.final}` +
          (sobrantes.length ? `; resolvería ${sobrantes.length} duplicada(s)` : "") +
          "."
      );
      continue;
    }

    await ctx.db.collection("alertas").doc(objetivo.id).update({
      estado: plan.final,
      ...(reabrir
        ? {
            resueltaEn: FieldValue.delete(),
            resueltaPor: FieldValue.delete(),
            valorResolucion: FieldValue.delete(),
          }
        : {}),
    });

    for (const a of sobrantes) await resolver(a);

    if (reabrir) {
      // Lectura coherente con la alerta abierta; no genera otra del mismo tipo.
      await enviar(plan.valorFuera);
    }

    linea(
      `${etiqueta}: ${reabrir ? "reabierta" : "corregida"} a «${plan.final}»` +
        (sobrantes.length ? `; ${sobrantes.length} duplicada(s) resuelta(s)` : "") +
        "."
    );
  }
}

// =========================================================
// 7. REGLA DE AUTOMATIZACIÓN (ventilador de A)
// =========================================================

async function asegurarRegla(ctx, incubadora, ventilador) {
  const r = lib.REGLA_DEMO;
  const descripcion = `${r.modoControl}, ${r.variable} >= ${r.umbralActivacion}, histéresis ${r.margenHisteresis} (apaga a ${r.umbralActivacion - r.margenHisteresis})`;

  if (!ventilador || !ventilador.id) {
    linea(`[simulacro] ${incubadora.clave}: configuraría el ventilador en modo ${descripcion} con guardarReglaAutomatizacion.`);

    return;
  }

  const [reglaSnap, ventSnap] = await Promise.all([
    ctx.db.collection("reglas_automatizacion").doc(ventilador.id).get(),
    ctx.db.collection("ventiladores").doc(ventilador.id).get(),
  ]);

  if (reglaSnap.exists) {
    const d = reglaSnap.data();
    const igual =
      d.variable === r.variable &&
      d.umbralActivacion === r.umbralActivacion &&
      d.margenHisteresis === r.margenHisteresis &&
      d.activa === r.activa &&
      ventSnap.exists &&
      ventSnap.data().modoControl === r.modoControl;

    linea(
      `${incubadora.clave}: el ventilador ${ventilador.id} ya tiene regla; ` +
        (igual ? "coincide con la demo, se reutiliza." : "difiere de la demo (modo, umbral o margen), no se toca.")
    );

    return;
  }

  if (!ctx.escribe) {
    linea(`[simulacro] ${incubadora.clave}: configuraría el ventilador ${ventilador.id} en modo ${descripcion}.`);

    return;
  }

  const tokenAdmin = await ctx.tokenAdmin();

  await lib.llamarCallable(
    ctx.entorno,
    "guardarReglaAutomatizacion",
    { ventiladorId: ventilador.id, ...r },
    tokenAdmin
  );

  linea(`${incubadora.clave}: ventilador ${ventilador.id} en modo ${descripcion}.`);
}

// =========================================================
// --solo-claves
// =========================================================

/**
 * Restablece ÚNICAMENTE la clave de usuarios que ya existen. No crea ni
 * repara nada, no toca al administrador ni ningún dato.
 */
async function restablecerSoloClaves(ctx, usuarios) {
  for (const { rol, correo } of usuarios) {
    const existente = await ctx.auth.getUserByEmail(correo).catch((error) => {
      if (error.code === "auth/user-not-found") {
        return null;
      }

      throw error;
    });

    if (!existente) {
      lib.abortar(`No existe el usuario ${rol} ${correo} en ${ctx.entorno.proyecto}: --solo-claves no crea usuarios (corré la carga completa).`);
    }

    const claimRol = existente.customClaims && existente.customClaims.role;

    if (claimRol !== rol) {
      lib.abortar(`${correo} tiene el rol "${claimRol}", no "${rol}": no se toca. Revisá --${rol}-email.`);
    }

    if (!ctx.escribe) {
      linea(`[simulacro] ${rol}: ${correo}: generaría una clave nueva.`);
      continue;
    }

    const clave = generarClave();

    await ctx.auth.updateUser(existente.uid, { password: clave });
    guardarCredencial(ctx.credenciales, rol, correo, clave);
    linea(`${rol}: ${correo}: clave nueva generada y guardada en el archivo local.`);
  }
}

// =========================================================
// RESUMEN FINAL
// =========================================================

async function imprimirResumen(ctx, datos) {
  console.log("\n" + "=".repeat(64));
  console.log(" RESUMEN");
  console.log("=".repeat(64));
  console.log(` Proyecto: ${ctx.entorno.proyecto} (${ctx.entorno.modo === "emulador" ? "emulador local" : "real"})`);

  if (!ctx.escribe) {
    console.log(" SIMULACRO: no se escribió nada. Para cargar de verdad, repetí el mismo comando con --confirmar.");
  }

  console.log("\n Usuarios de demo (el administrador existente no se tocó):");
  for (const u of datos.usuarios) {
    console.log(`   ${u.rol.padEnd(9)} ${u.correo}  [${u.estado}]`);
  }
  console.log(`   Claves (no se imprimen): ${ARCHIVO_CREDENCIALES}`);

  console.log("\n Incubadoras y dispositivos:");
  for (const { incubadora, dispositivos } of datos.incubadoras) {
    console.log(`   ${incubadora.clave}  ${incubadora.nombre}  [${incubadora.estado}]  id=${incubadora.id || "(se crearía)"}`);

    if (dispositivos) {
      for (const tipo of TIPOS_POR_INCUBADORA_ACTIVA) {
        console.log(`        ${tipo.padEnd(19)} id=${(dispositivos[tipo] && dispositivos[tipo].id) || "(se crearía)"}`);
      }
    }
  }

  if (ctx.escribe) {
    console.log("\n Alertas de las incubadoras de demo (estado en que quedaron):");
    for (const { incubadora } of datos.incubadoras) {
      if (!incubadora.id || incubadora.estado !== "activa") continue;

      const snap = await ctx.db.collection("alertas").where("incubadoraId", "==", incubadora.id).get();
      const filas = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (a.creadaEn ? a.creadaEn.toMillis() : 0) - (b.creadaEn ? b.creadaEn.toMillis() : 0));

      if (filas.length === 0) {
        console.log(`   ${incubadora.clave}: sin alertas`);
      }

      for (const a of filas) {
        console.log(`   ${incubadora.clave}: ${String(a.tipo).padEnd(18)} ${a.estado}`);
      }
    }
  }

  const A = datos.incubadoras.find((x) => x.incubadora.clave === "A");
  const B = datos.incubadoras.find((x) => x.incubadora.clave === "B");

  if (A && A.incubadora.id && A.dispositivos.sensor_temperatura && A.dispositivos.ventilador) {
    console.log(`
 Para el SIMULADOR (Incubadora A: es la que tiene el ventilador con automatización):
   export SIMULADOR_INCUBADORA_ID=${A.incubadora.id}
   export SIMULADOR_VENTILADOR_ID=${A.dispositivos.ventilador.id}
 NO se exporta SIMULADOR_SENSOR_ID A PROPÓSITO: con el sensor real el simulador pisaría las
 lecturas de escenario-demo.js (y generaría alertas de humedad espontáneas). Ver docs/demo-avances.md.`);
  }

  if (B && B.incubadora.id && B.dispositivos.ventilador) {
    console.log(`
 Ventilador de la Incubadora B (modo manual): ${B.dispositivos.ventilador.id}`);
  }

  const proyecto = ctx.entorno.proyecto;

  console.log(`
 Siguientes comandos:
   node functions/scripts/escenario-demo.js estado --proyecto ${proyecto}
   node functions/scripts/escenario-demo.js calor  --proyecto ${proyecto}            (simulacro)
   node functions/scripts/escenario-demo.js calor  --proyecto ${proyecto} --confirmar`);
}

// =========================================================
// MAIN
// =========================================================

async function main() {
  const { values } = lib.leerArgumentos(
    process.argv.slice(2),
    {
      proyecto: { type: "string" },
      "admin-email": { type: "string" },
      "operador-email": { type: "string", default: "operador.demo@mtpa.test" },
      "consulta-email": { type: "string", default: "consulta.demo@mtpa.test" },
      "api-key": { type: "string" },
      region: { type: "string", default: lib.REGION_POR_DEFECTO },
      horas: { type: "string", default: "12" },
      confirmar: { type: "boolean" },
      "sin-historico": { type: "boolean" },
      "sin-alertas": { type: "boolean" },
      "restablecer-claves": { type: "boolean" },
      "solo-claves": { type: "boolean" },
    },
    AYUDA
  );

  const escribe = Boolean(values.confirmar);
  const soloClaves = Boolean(values["solo-claves"]);
  const entorno = lib.validarEntorno({ proyecto: values.proyecto, region: values.region });

  const horas = Number(values.horas);

  if (!Number.isFinite(horas) || horas <= 0 || horas > 48) {
    lib.abortar("--horas debe ser un número entre 0 y 48.");
  }

  if (!soloClaves && !values["admin-email"]) {
    lib.abortar("Falta --admin-email <correo del administrador existente>.");
  }

  const correos = [values["admin-email"] || "", values["operador-email"], values["consulta-email"]].map((c) => c.toLowerCase());

  if (new Set(correos).size !== 3 && !(soloClaves && correos[0] === "" && correos[1] !== correos[2])) {
    lib.abortar("Los correos del administrador, del operador y de consulta deben ser distintos.");
  }

  lib.imprimirEncabezado(
    soloClaves ? "M.T.P.A. - Restablecer claves de los usuarios de demo" : "M.T.P.A. - Carga de datos de demo",
    entorno,
    {
      escribe,
      detalle: soloClaves ? ["Solo se restablecen las claves de operador y consulta."] : [`Administrador existente: ${values["admin-email"]}`],
    }
  );

  const apiKey =
    values["api-key"] || process.env.VITE_FIREBASE_API_KEY || (entorno.modo === "emulador" ? "emulador" : "");
  const tokenMedicion = process.env.PROCESAR_MEDICION_TOKEN;
  const necesitaMediciones = !values["sin-historico"] || !values["sin-alertas"];

  const admin = lib.iniciarAdmin(entorno);
  const db = admin.firestore();
  const auth = admin.auth();

  const credenciales = leerCredenciales(entorno);

  if (credenciales.danado) {
    const mensaje = `${ARCHIVO_CREDENCIALES} no es un JSON válido (${credenciales.motivo}). `;

    if (escribe) {
      lib.abortar(mensaje + "Revisalo o borralo antes de escribir (no se sobrescribe a ciegas).");
    }

    console.log(`\n AVISO: ${mensaje}Se ignora en el simulacro; con --confirmar habría que arreglarlo o borrarlo.`);
  }

  if (soloClaves) {
    paso("Restablecer claves");
    await restablecerSoloClaves(
      { escribe, auth, entorno, credenciales },
      [
        { rol: "operador", correo: values["operador-email"] },
        { rol: "consulta", correo: values["consulta-email"] },
      ]
    );
    console.log(
      escribe
        ? `\n Listo. Las claves nuevas están en ${ARCHIVO_CREDENCIALES} (no se imprimen).`
        : "\n SIMULACRO: no se cambió ninguna clave. Repetí con --confirmar."
    );

    return;
  }

  // ---- El administrador existente: se localiza, no se crea ni se modifica.
  const adminAuth = await auth.getUserByEmail(values["admin-email"]).catch((error) => {
    if (error.code === "auth/user-not-found") {
      return lib.abortar(`No existe ningún usuario con el correo ${values["admin-email"]} en ${entorno.proyecto}.`);
    }

    throw error;
  });

  if (!adminAuth.customClaims || adminAuth.customClaims.role !== "administrador") {
    lib.abortar(`${values["admin-email"]} existe pero no tiene el rol administrador.`);
  }

  console.log(`\n Administrador localizado (uid ${adminAuth.uid}); se actúa en su nombre sin conocer su contraseña.`);

  // ---- PRE-VUELO: lo que suele fallar en real, comprobado SIN escribir datos.
  const preVuelo = [await lib.preVueloIdToken(entorno, admin, adminAuth.uid, apiKey, adminAuth.customClaims.role)];

  if (necesitaMediciones) {
    preVuelo.push(await lib.preVueloTokenMedicion(entorno, tokenMedicion));
  }

  const preVueloOk = lib.imprimirPreVuelo(preVuelo);

  if (!preVueloOk && escribe) {
    lib.abortar("El pre-vuelo falló: no se escribió nada. Corregí lo indicado y volvé a correr.");
  }

  const ctx = {
    escribe,
    entorno,
    admin,
    db,
    auth,
    horas,
    tokenMedicion,
    restablecerClaves: Boolean(values["restablecer-claves"]),
    credenciales,
    _tokenAdmin: preVuelo[0].idToken || null,
    async tokenAdmin() {
      if (!this._tokenAdmin) {
        this._tokenAdmin = await lib.obtenerIdTokenAdmin(entorno, admin, adminAuth.uid, apiKey, adminAuth.customClaims.role);
      }

      return this._tokenAdmin;
    },
  };

  paso("1. Usuarios de demo");
  const usuarios = [];

  for (const definicion of [
    { rol: "operador", nombre: "Operador Demo", correo: values["operador-email"] },
    { rol: "consulta", nombre: "Consulta Demo", correo: values["consulta-email"] },
  ]) {
    const { estado } = await asegurarUsuario(ctx, definicion);

    usuarios.push({ ...definicion, estado });
  }

  paso("2. Incubadoras");
  const incubadoras = [];

  for (const definicion of lib.INCUBADORAS_DEMO) {
    incubadoras.push({ incubadora: await asegurarIncubadora(ctx, definicion), dispositivos: null });
  }

  paso("3. Dispositivos (sensor de temperatura, sensor de humedad y ventilador en cada incubadora activa)");
  for (const entrada of incubadoras) {
    if (entrada.incubadora.estado === "activa") {
      entrada.dispositivos = await asegurarDispositivos(ctx, entrada.incubadora);
    } else {
      linea(`${entrada.incubadora.clave}: incubadora inactiva (en mantenimiento), sin dispositivos.`);
    }
  }

  const activas = incubadoras.filter((e) => e.incubadora.estado === "activa");

  paso("4. Umbrales");
  for (const entrada of activas) {
    await asegurarUmbrales(ctx, entrada.incubadora);
  }

  const B = activas.find((e) => e.incubadora.clave === "B");

  // Las lecturas de relleno marcan "conectado" a los sensores; al terminar se
  // les devuelve el estado de conexión que tenían (ver lib.conservarConexion).
  const idsSensores = activas
    .flatMap((e) => [e.dispositivos.sensor_temperatura, e.dispositivos.sensor_humedad])
    .filter((d) => d && d.id)
    .map((d) => d.id);

  await lib.conservarConexion(db, ctx.escribe ? idsSensores : [], async () => {
    if (values["sin-historico"]) {
      paso("5. Histórico sano (omitido por --sin-historico)");
    } else {
      paso(`5. Histórico sano (${horas} h, una lectura cada 10 min)`);
      const objetivos = [];

      for (const entrada of activas) {
        for (const [variable, tipo] of [
          ["temperatura", "sensor_temperatura"],
          ["humedad", "sensor_humedad"],
        ]) {
          objetivos.push({ incubadora: entrada.incubadora, variable, sensor: entrada.dispositivos[tipo] });
        }
      }

      await cargarHistorico(ctx, objetivos);
    }

    if (values["sin-alertas"]) {
      paso("6. Alertas de ciclo de vida (omitidas por --sin-alertas)");
    } else if (B) {
      paso("6. Alertas con ciclo de vida (Incubadora B)");
      await asegurarAlertas(ctx, B.incubadora, B.dispositivos);
    }
  });

  if (ctx.escribe && idsSensores.length > 0) {
    linea(
      "Los sensores conservan su estado de conexión previo (los datos de relleno no son un equipo real emitiendo latidos)."
    );
  }

  paso("7. Automatización del ventilador");
  const A = activas.find((e) => e.incubadora.clave === "A");

  if (A) {
    await asegurarRegla(ctx, A.incubadora, A.dispositivos.ventilador);
  }

  if (B && B.dispositivos.ventilador && B.dispositivos.ventilador.id) {
    const vSnap = await db.collection("ventiladores").doc(B.dispositivos.ventilador.id).get();

    linea(`B: ventilador en modo "${vSnap.exists ? vSnap.data().modoControl : "?"}" (la demo lo deja en manual, sin regla).`);
  }

  await imprimirResumen(ctx, { usuarios, incubadoras });

  if (!preVueloOk) {
    console.error("\n PRE-VUELO FALLÓ (ver arriba): la carga real abortaría antes de escribir.");
    process.exitCode = 1;
  }
}

lib.ejecutar(main);
