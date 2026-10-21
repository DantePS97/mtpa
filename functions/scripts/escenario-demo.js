#!/usr/bin/env node
"use strict";

/**
 * Control de ESCENARIOS EN VIVO para la presentación.
 *
 * Envía a la función HTTP procesarMedicion una lectura que fuerza una
 * situación (calor, humedad baja...) y vuelve a la normalidad. Pasa por la
 * lógica real: evaluarUmbrales (alertas y su resolución automática) y
 * evaluarAutomatizacion (órdenes automáticas del ventilador).
 *
 *   calor            temperatura por encima del máximo -> alerta; en una
 *                    incubadora con regla de ventilador, orden de ENCENDER.
 *   normal           la temperatura vuelve: resuelve la alerta y, cuando
 *                    sale de la banda de histéresis, orden de APAGAR.
 *   humedad-baja     humedad por debajo del mínimo -> alerta.
 *   humedad-normal   la humedad vuelve -> resuelve la alerta.
 *   estado           resumen legible (SOLO LECTURA).
 *
 * Es SEGURO POR DISEÑO: sin --confirmar muestra qué enviaría y no envía
 * nada. Imprime siempre el proyecto destino, exige --proyecto y, sin
 * emuladores, GOOGLE_APPLICATION_CREDENTIALS del mismo proyecto. Nunca
 * imprime tokens ni claves.
 *
 * TIEMPOS que conviene respetar entre escenarios (ver functions/index.js):
 *
 *  - Alertas: se crean con la PRIMERA lectura fuera de rango. Mientras haya
 *    una abierta del mismo tipo (activa O reconocida) no se crea otra. Se
 *    resuelven con la primera lectura que recupere el 5 % del rango hacia
 *    adentro (temperatura <= 38.4; humedad >= 50.75 con los límites de la
 *    demo). Una alerta "reconocida" sigue abierta: hay que bajar el valor
 *    igual para cerrarla.
 *  - Ventilador (regla mixta, activación 38.5, histéresis 1.5): enciende
 *    con >= 38.5 y apaga con <= 37.0; entre 37.0 y 38.5 no hace nada.
 *    Entre dos órdenes de la MISMA acción hay un enfriamiento de 120 s
 *    (COOLDOWN_ORDEN_AUTOMATICA_MS): repetir "calor" antes de 120 s desde
 *    la orden de encender anterior NO crea otra orden. Si la orden queda en
 *    curso, bloquea hasta 300 s.
 *  - Una orden sana recorre pendiente -> enviando -> enviada -> ejecutada
 *    en pocos segundos (medido en emuladores: ejecutada 3 a 6 s después de
 *    crearse; necesita el Servicio de Integración y el simulador del
 *    ventilador corriendo). Si nadie la confirma pasa a "fallida" a los 30 s.
 *  - Un SIMULADOR que publique el sensor REAL de la misma incubadora pisa
 *    estas lecturas cada 8 s y resuelve la alerta a los pocos segundos
 *    (medido: 3 s). Para escenarios estables, el simulador debe correr SIN
 *    SIMULADOR_SENSOR_ID (su sensor por defecto no existe en Firestore y
 *    procesarMedicion lo descarta con un 404). Ver docs/demo-avances.md.
 *  - Estos escenarios no alteran el estado de conexión de los sensores: al
 *    terminar se les devuelve el que tenían (ver lib/demo-comun.js).
 *
 * Ver el uso completo con:  node functions/scripts/escenario-demo.js --help
 */

const lib = require("./lib/demo-comun");

const AYUDA = `Uso:
  node functions/scripts/escenario-demo.js <escenario> [incubadora] --proyecto <id> [opciones]

Escenarios:
  calor [incubadora]            Temperatura sobre el máximo: alerta y (si hay regla) orden de encender.
  normal [incubadora]           Temperatura normal: resuelve la alerta y apaga el ventilador (histéresis).
  humedad-baja [incubadora]     Humedad bajo el mínimo: alerta.
  humedad-normal [incubadora]   Humedad normal: resuelve la alerta.
  estado [incubadora]           Resumen de lectura: últimas mediciones, alertas abiertas, ventilador y
                                últimas 3 órdenes. SOLO LECTURA (no usa --confirmar).

Elegir la incubadora [incubadora]: por id de documento, por nombre exacto o por letra.
  Ejemplos:  A    B    "Incubadora B - Lote 2 (demo)"    dIp65dPv1WVFiIzpYxeE
  También sirve un fragmento único del nombre ("Lote 2"). Sin indicarla, los escenarios que
  escriben usan la Incubadora A y "estado" muestra todas las incubadoras activas de la demo.

Sin --confirmar los escenarios que escriben son un SIMULACRO: muestran qué enviarían y no envían nada.

Opciones:
  --proyecto <id>      OBLIGATORIO. Proyecto destino (p. ej. mtpa-dev).
  --confirmar          Envía de verdad las lecturas a procesarMedicion.
  --region <region>    Región de las funciones (def.: us-central1).
  --pausa <seg>        Solo "normal": segundos entre el primer paso (enfriando, resuelve la alerta,
                       el ventilador sigue encendido) y el paso final (apaga). 0 = un solo paso.
                       Def.: 6.
  --valor <n>          Fuerza el valor del paso final del escenario.
  --sostener <seg>     Repite la última lectura cada --cada segundos durante <seg> segundos (o hasta
                       Ctrl+C), como un sensor real. Útil para que el panel muestre datos "vivos".
  --cada <seg>         Intervalo de --sostener (def.: 8).
  -h, --help           Esta ayuda.

Variables de entorno:
  GOOGLE_APPLICATION_CREDENTIALS   Clave de cuenta de servicio del proyecto (sin emuladores).
  PROCESAR_MEDICION_TOKEN          Token de procesarMedicion (escenarios que escriben).`;

const ESCENARIOS_ESCRITURA = ["calor", "normal", "humedad-baja", "humedad-normal"];
const ESCENARIOS = [...ESCENARIOS_ESCRITURA, "estado"];

// =========================================================
// CONTEXTO DE UNA INCUBADORA
// =========================================================

async function cargarContexto(db, incubadora) {
  const dispositivos = await lib.dispositivosDe(db, incubadora.id);
  const primero = (tipo) => dispositivos.find((d) => d.tipo === tipo) || null;

  const umbrales = {};

  for (const variable of Object.keys(lib.UMBRALES_DEMO)) {
    const snap = await db.collection("umbrales").doc(`${incubadora.id}_${variable}`).get();
    const d = snap.exists ? snap.data() : null;

    umbrales[variable] =
      d && typeof d.minimo === "number" && typeof d.maximo === "number"
        ? { minimo: d.minimo, maximo: d.maximo, configurado: true }
        : { ...lib.UMBRALES_DEMO[variable], configurado: false };
  }

  const ventilador = primero("ventilador");
  let ventiladorDoc = null;
  let regla = null;

  if (ventilador) {
    const [vSnap, rSnap] = await Promise.all([
      db.collection("ventiladores").doc(ventilador.id).get(),
      db.collection("reglas_automatizacion").doc(ventilador.id).get(),
    ]);

    ventiladorDoc = vSnap.exists ? vSnap.data() : null;
    regla = rSnap.exists ? rSnap.data() : null;
  }

  return {
    dispositivos,
    sensorTemperatura: primero("sensor_temperatura"),
    sensorHumedad: primero("sensor_humedad"),
    ventilador,
    ventiladorDoc,
    regla,
    umbrales,
  };
}

/** Regla utilizable: activa, sobre temperatura y con el ventilador en modo automático o mixto. */
function reglaDeTemperatura(c) {
  const r = c.regla;

  if (
    r &&
    r.activa === true &&
    r.variable === "temperatura" &&
    Number.isFinite(r.umbralActivacion) &&
    Number.isFinite(r.margenHisteresis) &&
    c.ventiladorDoc &&
    ["automatico", "mixto"].includes(c.ventiladorDoc.modoControl)
  ) {
    return r;
  }

  return null;
}

// =========================================================
// PLAN DE CADA ESCENARIO
// =========================================================

function planDe(escenario, c, { pausa, valor }) {
  const t = c.umbrales.temperatura;
  const h = c.umbrales.humedad;
  const regla = reglaDeTemperatura(c);
  const margenT = (t.maximo - t.minimo) * lib.MARGEN_RESOLUCION;
  const margenH = (h.maximo - h.minimo) * lib.MARGEN_RESOLUCION;
  const avisos = [];
  let pasos;

  if (escenario === "calor") {
    const base = Math.max(t.maximo, regla ? regla.umbralActivacion : -Infinity);

    pasos = [{ variable: "temperatura", valor: lib.redondear1(base + 0.7), nota: "sobre el máximo" }];
  } else if (escenario === "normal") {
    const limiteApagado = regla
      ? Number((regla.umbralActivacion - regla.margenHisteresis).toFixed(6))
      : null;
    const piso = lib.redondear1(t.minimo + margenT + 0.2);
    let final = regla ? lib.redondear1(limiteApagado - 0.1) : lib.redondear1((t.minimo + t.maximo) / 2);

    final = Math.max(final, piso);

    if (regla && final > limiteApagado) {
      avisos.push(
        `El valor final (${final}) no baja de ${limiteApagado}: con estos límites el ventilador no se apagará solo.`
      );
    }

    const enfriando = lib.redondear1(t.maximo - margenT - 0.4);

    pasos = [];

    if (pausa > 0 && regla && enfriando > limiteApagado && enfriando > final) {
      pasos.push({
        variable: "temperatura",
        valor: enfriando,
        nota: "enfriando: resuelve la alerta, el ventilador sigue encendido (banda de histéresis)",
        esperaDespuesS: pausa,
      });
    }

    pasos.push({
      variable: "temperatura",
      valor: final,
      nota: regla ? `temperatura normal, por debajo de ${limiteApagado}: apaga el ventilador` : "temperatura normal",
    });
  } else if (escenario === "humedad-baja") {
    pasos = [{ variable: "humedad", valor: lib.redondear1(Math.max(0, h.minimo - 5)), nota: "bajo el mínimo" }];
  } else {
    pasos = [
      {
        variable: "humedad",
        valor: lib.redondear1(Math.max((h.minimo + h.maximo) / 2, h.minimo + margenH + 0.5)),
        nota: "humedad normal: resuelve la alerta",
      },
    ];
  }

  if (valor !== undefined) {
    pasos[pasos.length - 1].valor = valor;
    pasos[pasos.length - 1].nota += " (valor forzado con --valor)";
  }

  return { pasos, avisos };
}

// =========================================================
// ENVÍO
// =========================================================

function sensorDe(c, variable) {
  return variable === "temperatura" ? c.sensorTemperatura : c.sensorHumedad;
}

async function enviarPaso(ctx, incubadora, c, paso, valor) {
  const sensor = sensorDe(c, paso.variable);

  const respuesta = await lib.enviarMedicion(ctx.entorno, ctx.tokenMedicion, {
    incubadoraId: incubadora.id,
    dispositivoId: sensor.id,
    variable: paso.variable,
    valor,
    unidad: lib.UNIDAD_POR_VARIABLE[paso.variable],
    medidoEn: new Date().toISOString(),
  });

  console.log(
    `   ${new Date().toLocaleTimeString("es-AR", { hour12: false })}  enviado ${paso.variable} = ${valor} ${lib.UNIDAD_POR_VARIABLE[paso.variable]}` +
      `  (medición ${lib.idCorto(respuesta.medicionId)})`
  );
}

function jitter(variable, valor, indice) {
  // Variación mínima y determinista para que las tarjetas "respiren" sin
  // cruzar ningún límite de alerta ni de histéresis.
  const amplitud = variable === "temperatura" ? 0.05 : 0.2;
  const patron = [0, 1, -1, 0.5, -0.5];

  return lib.redondear1(valor + amplitud * patron[indice % patron.length]);
}

async function ejecutarEscritura(ctx, escenario, incubadora, c, opciones) {
  const { pasos, avisos } = planDe(escenario, c, opciones);

  console.log(`\n Escenario «${escenario}» en «${incubadora.nombre}» (id ${incubadora.id})`);

  if (!c.umbrales.temperatura.configurado || !c.umbrales.humedad.configurado) {
    console.log(" AVISO: faltan umbrales configurados en esta incubadora; se usan los de la demo para elegir los valores.");
  }

  for (const aviso of avisos) {
    console.log(` AVISO: ${aviso}`);
  }

  if (escenario === "calor") {
    const regla = reglaDeTemperatura(c);

    console.log(
      regla
        ? ` Ventilador con regla: enciende con temperatura >= ${regla.umbralActivacion} (apaga a ${Number((regla.umbralActivacion - regla.margenHisteresis).toFixed(6))}).`
        : " Esta incubadora no tiene regla de ventilador activa: solo se generará la alerta."
    );
  }

  console.log(" Pasos:");
  pasos.forEach((p, i) => {
    const sensor = sensorDe(c, p.variable);

    console.log(
      `   ${i + 1}. ${p.variable} = ${p.valor} ${lib.UNIDAD_POR_VARIABLE[p.variable]}  -> ${sensor ? `sensor ${sensor.id}` : "(SIN SENSOR)"}  [${p.nota}]` +
        (p.esperaDespuesS ? `  (luego espera ${p.esperaDespuesS} s)` : "")
    );
  });

  for (const p of pasos) {
    if (!sensorDe(c, p.variable)) {
      lib.abortar(`La incubadora no tiene un sensor de ${p.variable}; corré cargar-datos-demo.js.`);
    }
  }

  if (opciones.sostener > 0) {
    console.log(` Luego repite la última lectura cada ${opciones.cada} s durante ${opciones.sostener} s (Ctrl+C para cortar).`);
  }

  if (!ctx.escribe) {
    console.log("\n SIMULACRO: no se envió nada. Repetí el comando con --confirmar para enviarlo.");

    return;
  }

  if (!ctx.tokenMedicion) {
    lib.abortar("Falta la variable PROCESAR_MEDICION_TOKEN (el token de la función procesarMedicion).");
  }

  console.log("\n Enviando...");

  // procesarMedicion marca "conectado" al sensor que envía; como estas
  // lecturas no son de un equipo real con latidos, al terminar se le devuelve
  // su estado de conexión previo (ver lib.conservarConexion).
  const idsSensores = [...new Set(pasos.map((p) => sensorDe(c, p.variable).id))];

  await lib.conservarConexion(ctx.db, idsSensores, async () => {
    for (const p of pasos) {
      await enviarPaso(ctx, incubadora, c, p, p.valor);

      if (p.esperaDespuesS) {
        console.log(`   ... esperando ${p.esperaDespuesS} s`);
        await lib.esperar(p.esperaDespuesS * 1000);
      }
    }

    const ultimo = pasos[pasos.length - 1];

    if (opciones.sostener > 0) {
      let cortar = false;
      const alCortar = () => {
        cortar = true;
      };

      process.once("SIGINT", alCortar);

      const fin = Date.now() + opciones.sostener * 1000;
      let n = 1;

      while (!cortar && Date.now() + opciones.cada * 1000 <= fin) {
        await lib.esperar(opciones.cada * 1000);

        if (cortar) break;

        await enviarPaso(ctx, incubadora, c, ultimo, jitter(ultimo.variable, ultimo.valor, n));
        n += 1;
      }

      process.removeListener("SIGINT", alCortar);
      console.log(" Fin de --sostener.");
    }
  });

  await lib.esperar(2500);
  console.log("\n Estado 2,5 s después (las órdenes del ventilador siguen su curso: volvé a pedir «estado»):");
  await imprimirEstado(ctx, incubadora, await leerMedicionesRecientes(ctx.db));
}

// =========================================================
// ESTADO (solo lectura)
// =========================================================

async function leerMedicionesRecientes(db) {
  // Misma consulta que el panel (medicionesRepository): las 300 últimas por
  // medidoEn; solo usa el índice de campo único.
  const snap = await db.collection("mediciones").orderBy("medidoEn", "desc").limit(300).get();

  return snap.docs.map((d) => d.data());
}

function ultima(mediciones, incubadoraId, variable) {
  return mediciones.find((m) => m.incubadoraId === incubadoraId && m.variable === variable) || null;
}

async function imprimirEstado(ctx, incubadora, mediciones) {
  const { db } = ctx;
  const c = await cargarContexto(db, incubadora);

  console.log(`\n ${"-".repeat(60)}`);
  console.log(` ${incubadora.nombre}  [${incubadora.estado}]  id=${incubadora.id}`);
  console.log(` ${"-".repeat(60)}`);

  for (const variable of ["temperatura", "humedad"]) {
    const m = ultima(mediciones, incubadora.id, variable);
    const u = c.umbrales[variable];
    const etiqueta = variable === "temperatura" ? "Temperatura" : "Humedad    ";
    const unidad = lib.UNIDAD_POR_VARIABLE[variable];

    if (!m) {
      console.log(`   ${etiqueta}: sin mediciones recientes`);
      continue;
    }

    const fuera = m.valor < u.minimo || m.valor > u.maximo;

    console.log(
      `   ${etiqueta}: ${m.valor} ${unidad}  (medida ${lib.hora(m.medidoEn)}, ${lib.hace(m.medidoEn)})  ` +
        `límites ${u.minimo}-${u.maximo}${u.configurado ? "" : " (por defecto de la demo)"}  ${fuera ? "<< FUERA DE RANGO" : "OK"}`
    );
  }

  const alertas = (await db.collection("alertas").where("incubadoraId", "==", incubadora.id).get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.creadaEn ? b.creadaEn.toMillis() : 0) - (a.creadaEn ? a.creadaEn.toMillis() : 0));
  const abiertas = alertas.filter((a) => a.estado !== "resuelta");

  console.log(`   Alertas abiertas: ${abiertas.length}   (resueltas: ${alertas.length - abiertas.length})`);
  abiertas.forEach((a) => {
    console.log(`      - [${a.estado}] ${a.tipo}  ${a.titulo || ""}  creada ${lib.hora(a.creadaEn)} (${lib.hace(a.creadaEn)})  id ${lib.idCorto(a.id)}`);
  });

  console.log("   Dispositivos:");
  c.dispositivos.forEach((d) => {
    console.log(
      `      - ${d.tipo.padEnd(19)} ${String(d.estadoConexion || "desconocido").padEnd(13)} última comunicación ${lib.hora(d.ultimaComunicacionEn)} ${lib.hace(d.ultimaComunicacionEn)}`
    );
  });

  if (!c.ventilador) {
    console.log("   Ventilador: esta incubadora no tiene.");

    return;
  }

  const modo = c.ventiladorDoc ? c.ventiladorDoc.modoControl : "(sin documento)";
  const estadoFan = c.ventiladorDoc && c.ventiladorDoc.estadoActual ? c.ventiladorDoc.estadoActual : "desconocido";

  console.log(`   Ventilador ${lib.idCorto(c.ventilador.id)}: modo ${modo}, estado ${estadoFan}`);

  if (c.regla) {
    console.log(
      `      regla ${c.regla.activa ? "activa" : "INACTIVA"}: ${c.regla.variable} >= ${c.regla.umbralActivacion} enciende, ` +
        `<= ${Number((c.regla.umbralActivacion - c.regla.margenHisteresis).toFixed(6))} apaga`
    );
  } else {
    console.log("      sin regla de automatización");
  }

  const ordenes = await db
    .collection("ordenes_ventilador")
    .where("ventiladorId", "==", c.ventilador.id)
    .orderBy("creadaEn", "desc")
    .limit(3)
    .get();

  if (ordenes.empty) {
    console.log("   Últimas órdenes: ninguna");
  } else {
    console.log("   Últimas 3 órdenes:");
    ordenes.docs.forEach((doc) => {
      const o = doc.data();

      console.log(
        `      - ${String(o.accionSolicitada).padEnd(8)} ${String(o.origen).padEnd(10)} ${String(o.estado).padEnd(10)} creada ${lib.hora(o.creadaEn)} (${lib.hace(o.creadaEn)})` +
          (o.error ? `  error: ${o.error}` : "")
      );
    });
  }
}

// =========================================================
// MAIN
// =========================================================

async function main() {
  const { values, positionals } = lib.leerArgumentos(
    process.argv.slice(2),
    {
      proyecto: { type: "string" },
      region: { type: "string", default: lib.REGION_POR_DEFECTO },
      confirmar: { type: "boolean" },
      pausa: { type: "string", default: "6" },
      valor: { type: "string" },
      sostener: { type: "string", default: "0" },
      cada: { type: "string", default: "8" },
    },
    AYUDA
  );

  const [escenario, textoIncubadora] = positionals;

  if (!escenario || !ESCENARIOS.includes(escenario) || positionals.length > 2) {
    console.error(`Indicá un escenario: ${ESCENARIOS.join(", ")}.\n`);
    console.error(AYUDA);
    process.exit(1);
  }

  const numero = (nombre, valor, minimo, maximo) => {
    const n = Number(valor);

    if (!Number.isFinite(n) || n < minimo || n > maximo) {
      lib.abortar(`${nombre} debe ser un número entre ${minimo} y ${maximo}.`);
    }

    return n;
  };

  const opciones = {
    pausa: numero("--pausa", values.pausa, 0, 120),
    sostener: numero("--sostener", values.sostener, 0, 7200),
    cada: numero("--cada", values.cada, 2, 120),
    valor: values.valor === undefined ? undefined : numero("--valor", values.valor, -50, 200),
  };

  const escribe = escenario !== "estado" && Boolean(values.confirmar);
  const entorno = lib.validarEntorno({ proyecto: values.proyecto, region: values.region });

  lib.imprimirEncabezado(`M.T.P.A. - Escenario de demo: ${escenario}`, entorno, {
    escribe,
    soloLectura: escenario === "estado",
  });

  const admin = lib.iniciarAdmin(entorno);
  const db = admin.firestore();
  const ctx = { db, entorno, escribe, tokenMedicion: process.env.PROCESAR_MEDICION_TOKEN };

  if (escenario === "estado") {
    let incubadoras;

    if (textoIncubadora) {
      incubadoras = [await lib.resolverIncubadora(db, textoIncubadora)];
    } else {
      const todas = (await db.collection("incubadoras").get()).docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((i) => i.estado === "activa");
      const demo = todas.filter((i) => String(i.nombre).includes("(demo)"));

      incubadoras = (demo.length > 0 ? demo : todas).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    }

    if (incubadoras.length === 0) {
      lib.abortar("No hay incubadoras activas para mostrar.");
    }

    const mediciones = await leerMedicionesRecientes(db);

    for (const incubadora of incubadoras) {
      await imprimirEstado(ctx, incubadora, mediciones);
    }

    return;
  }

  const incubadora = await lib.resolverIncubadora(db, textoIncubadora || "A");

  if (incubadora.estado !== "activa") {
    lib.abortar(`La incubadora «${incubadora.nombre}» está ${incubadora.estado}: no recibe escenarios.`);
  }

  const contexto = await cargarContexto(db, incubadora);

  await ejecutarEscritura(ctx, escenario, incubadora, contexto, opciones);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\nERROR: ${error.message}`);
    process.exit(1);
  });
