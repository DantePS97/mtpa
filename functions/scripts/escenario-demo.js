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
 *   refrescar        lecturas ahora para que el panel muestre datos frescos
 *                    (ver más abajo). Una sola incubadora.
 *   estado           resumen legible (SOLO LECTURA).
 *   preparar         lista TODOS los dispositivos de TODAS las incubadoras con
 *                    su estado de conexión; con --confirmar deja en
 *                    «desconocido» los que figuran «conectado» sin
 *                    comunicación reciente (ver más abajo).
 *
 * Es SEGURO POR DISEÑO: sin --confirmar muestra qué enviaría y no envía
 * nada. Imprime siempre el proyecto destino, exige --proyecto y, sin
 * emuladores, GOOGLE_APPLICATION_CREDENTIALS del mismo proyecto. Nunca
 * imprime tokens ni claves.
 *
 * REFRESCAR: el panel muestra "la última lectura" sin ningún aviso de dato
 * viejo, así que horas después de cargar los datos la tarjeta «Última
 * actualización» muestra la hora de la carga. "refrescar" envía lecturas
 * ahora a UNA incubadora (A por defecto; no hay opción «todas»):
 *   - variable SIN alertas abiertas: lecturas SANAS (temperatura ~37.4 ± 0.2,
 *     dentro de la banda muerta de la histéresis, entre 37.0 y 38.5; humedad
 *     ~58 ± 1.5): no crean alertas ni órdenes;
 *   - variable CON una alerta abierta (p. ej. la B: temperatura baja y
 *     humedad baja): lecturas COHERENTES con esa alerta (temperatura ~35.8,
 *     humedad ~45), que refrescan la hora sin resolverla ni duplicarla.
 * Un refresco largo (--sostener) agrega 2 lecturas por ciclo y el panel lee
 * solo las 200 más recientes de TODA la base (medicionesRepository) y filtra
 * por incubadora en el cliente: demasiadas lecturas de una incubadora sacan
 * de esa ventana a las otras ("Faltan mediciones ambientales"). Por eso
 * --sostener tiene un tope de 600 s (--sin-tope lo levanta). Después de
 * refrescar A, refrescá también B una vez. "estado" lee las 300 más
 * recientes.
 *
 * PREPARAR: el Servicio de Integración, al arrancar, carga como "conectado"
 * todo dispositivo que figure "conectado" en Firestore; si no recibe señales
 * en 30 s lo marca "desconectado" y crea una alerta «Dispositivo
 * desconectado» (la incubadora pasa a «Crítico»). "preparar --confirmar" pone
 * en «desconocido» (el valor de un dispositivo recién creado: el servicio no
 * lo carga y el frontend muestra «Desconocido») los «conectado» con
 * comunicación de más de 60 s. Correlo con el servicio DETENIDO.
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
  refrescar [incubadora]        Lecturas AHORA para que el panel muestre datos frescos. Una sola incubadora
                                (A por defecto). Sin alertas abiertas: lecturas sanas (temp ~37.4, hum ~58).
                                Con alertas abiertas (B): lecturas coherentes con ellas (no las resuelve ni
                                las duplica). Con --sostener repite cada 8 s. Cortalo (Ctrl+C) ANTES de "calor".
  preparar                      PREVIO a arrancar el Servicio de Integración: lista todos los dispositivos de
                                todas las incubadoras con su estado de conexión y, con --confirmar, pone en
                                «desconocido» los «conectado» sin comunicación reciente (> 60 s) para evitar
                                una alerta falsa «Dispositivo desconectado». Correlo con el servicio detenido.
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
                       Ctrl+C), como un sensor real. Tope: 600 s (el panel lee solo las 200 lecturas más
                       recientes de toda la base; un --sostener largo expulsa las de las otras
                       incubadoras). --sin-tope lo levanta.
  --sin-tope           Permite --sostener de más de 600 s.
  --incluir-no-demo    Permite que un escenario que ESCRIBE se aplique a una incubadora cuyo nombre no
                       lleva «(demo)» (por defecto se rechaza: protege las incubadoras reales).
  --todas              Solo "estado": muestra todas las incubadoras, con o sin «(demo)», activas o no.
  --cada <seg>         Intervalo de --sostener (def.: 8).
  -h, --help           Esta ayuda.

Variables de entorno:
  GOOGLE_APPLICATION_CREDENTIALS   Clave de cuenta de servicio del proyecto (sin emuladores).
  PROCESAR_MEDICION_TOKEN          Token de procesarMedicion (escenarios que escriben).`;

const ESCENARIOS_ESCRITURA = ["calor", "normal", "humedad-baja", "humedad-normal", "refrescar"];
const ESCENARIOS = [...ESCENARIOS_ESCRITURA, "estado", "preparar"];

// Tope por defecto de --sostener (s): ver la cabecera, sección REFRESCAR.
const TOPE_SOSTENER_S = 600;

const avisoVentana = (lecturasPorCiclo, opciones) =>
  ` AVISO: el panel lee solo las 200 lecturas más recientes de toda la base: ${lecturasPorCiclo} por ciclo cada ${opciones.cada} s ocupan esa ventana en ${Math.round((200 / lecturasPorCiclo) * opciones.cada)} s y sacan de ella a las otras incubadoras («Faltan mediciones ambientales»). Después de refrescar, refrescá también la otra incubadora una vez.`;

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
    console.log(avisoVentana(1, opciones));
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
// REFRESCAR (lecturas ahora)
// =========================================================

async function alertasAbiertasDe(db, incubadoraId) {
  const snap = await db.collection("alertas").where("incubadoraId", "==", incubadoraId).get();

  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((a) => a.estado !== "resuelta" && a.variable);
}

/**
 * Plan de refresco por variable:
 *   - sin alertas abiertas de esa variable: lecturas SANAS (temperatura dentro
 *     de la banda muerta de la histéresis y de los límites con margen;
 *     humedad dentro de los límites con margen);
 *   - con una alerta abierta: lecturas COHERENTES con ella (fuera de rango
 *     del mismo lado), que no la resuelven ni generan otra.
 */
function planRefresco(c, abiertas) {
  const t = c.umbrales.temperatura;
  const h = c.umbrales.humedad;
  const regla = reglaDeTemperatura(c);
  const margenT = (t.maximo - t.minimo) * lib.MARGEN_RESOLUCION;
  const margenH = (h.maximo - h.minimo) * lib.MARGEN_RESOLUCION;
  const limiteApagado = regla ? Number((regla.umbralActivacion - regla.margenHisteresis).toFixed(6)) : -Infinity;
  const bajoT = Math.max(t.minimo + margenT, limiteApagado);
  const altoT = Math.min(t.maximo - margenT, regla ? regla.umbralActivacion : Infinity);
  const plan = { bajoT, altoT };

  const sana = {
    temperatura: { modo: "sana", centro: lib.redondear1(regla ? bajoT + 0.4 : (t.minimo + t.maximo) / 2), amplitud: 0.2 },
    humedad: {
      modo: "sana",
      centro: lib.redondear1(Math.min(Math.max(58, h.minimo + margenH + 2), h.maximo - margenH - 2)),
      amplitud: 1.5,
    },
  };

  if (sana.temperatura.centro - 0.2 <= bajoT || sana.temperatura.centro + 0.2 >= altoT) {
    lib.abortar(
      `Con los límites y la regla actuales no hay una franja de temperatura sana de ±0.2 °C (entre ${bajoT} y ${altoT}).`
    );
  }

  for (const variable of ["temperatura", "humedad"]) {
    const deVariable = abiertas.filter((a) => a.variable === variable);
    const bajas = deVariable.filter((a) => String(a.tipo).endsWith("_baja"));
    const altas = deVariable.filter((a) => String(a.tipo).endsWith("_alta"));

    if (deVariable.length === 0) {
      plan[variable] = sana[variable];
      continue;
    }

    if (bajas.length > 0 && altas.length > 0) {
      lib.abortar(`Hay alertas abiertas de ${variable} por arriba y por abajo a la vez: no se puede refrescar de forma coherente.`);
    }

    if (altas.length > 0 && variable === "temperatura" && regla) {
      lib.abortar(
        "Hay una alerta de temperatura alta abierta y el ventilador tiene regla: refrescar enviaría temperatura alta y " +
          "podría crear órdenes del ventilador. Usá «normal» para cerrarla primero."
      );
    }

    const lim = variable === "temperatura" ? t : h;
    const centro =
      bajas.length > 0
        ? lib.redondear1(variable === "temperatura" ? lim.minimo - 0.7 : Math.max(0, lim.minimo - 5))
        : lib.redondear1(variable === "temperatura" ? lim.maximo + 0.9 : lim.maximo + 5);

    plan[variable] = {
      modo: "coherente",
      centro,
      amplitud: variable === "temperatura" ? 0.1 : 0.5,
      tipo: (bajas[0] || altas[0]).tipo,
    };
  }

  return plan;
}

const lecturaDe = ({ centro, amplitud }) => lib.redondear1(centro + (Math.random() * 2 - 1) * amplitud);

async function ejecutarRefresco(ctx, incubadora, c, opciones) {
  const abiertas = await alertasAbiertasDe(ctx.db, incubadora.id);
  const plan = planRefresco(c, abiertas);

  console.log(`\n Refrescar «${incubadora.nombre}» (id ${incubadora.id})`);
  console.log(" Cada ciclo envía:");
  for (const variable of ["temperatura", "humedad"]) {
    const p = plan[variable];
    const sensor = sensorDe(c, variable);

    console.log(
      `   - ${variable} = ${p.centro} ± ${p.amplitud} ${lib.UNIDAD_POR_VARIABLE[variable]}  -> sensor ${sensor ? sensor.id : "(SIN SENSOR)"}  [` +
        (p.modo === "sana"
          ? "sana: no crea alertas ni órdenes"
          : `coherente con la alerta abierta ${p.tipo}: no la resuelve ni la duplica`) +
        "]"
    );
  }

  if (plan.temperatura.modo === "sana") {
    console.log(`   (temperatura sana: entre ${plan.bajoT} y ${plan.altoT} exclusivos, banda muerta de la histéresis)`);
  }

  for (const variable of ["temperatura", "humedad"]) {
    if (!sensorDe(c, variable)) {
      lib.abortar(`La incubadora no tiene un sensor de ${variable}; corré cargar-datos-demo.js.`);
    }
  }

  if (opciones.sostener > 0) {
    console.log(` Repite cada ${opciones.cada} s durante ${opciones.sostener} s (Ctrl+C para cortar).`);
    console.log(avisoVentana(2, opciones));
  }

  if (!ctx.escribe) {
    console.log("\n SIMULACRO: no se envió nada. Repetí el comando con --confirmar para enviarlo.");

    return;
  }

  if (!ctx.tokenMedicion) {
    lib.abortar("Falta la variable PROCESAR_MEDICION_TOKEN (el token de la función procesarMedicion).");
  }

  console.log("\n Enviando...");

  const ids = [sensorDe(c, "temperatura").id, sensorDe(c, "humedad").id];

  // Ctrl+C: conservarConexion restaura el estado de conexión y sale (código 130).
  await lib.conservarConexion(ctx.db, ids, async () => {
    const fin = Date.now() + opciones.sostener * 1000;

    do {
      for (const variable of ["temperatura", "humedad"]) {
        await enviarPaso(ctx, incubadora, c, { variable }, lecturaDe(plan[variable]));
      }

      if (opciones.sostener <= 0 || Date.now() + opciones.cada * 1000 > fin) {
        break;
      }

      await lib.esperar(opciones.cada * 1000);
    } while (true);
  });

  await lib.esperar(2000);
  console.log("\n Estado:");
  await imprimirEstado(ctx, incubadora, await leerMedicionesRecientes(ctx.db));
}

// =========================================================
// PREPARAR (previo a arrancar el Servicio de Integración)
// =========================================================

const UMBRAL_COMUNICACION_RECIENTE_MS = 60 * 1000;

async function ejecutarPreparar(ctx) {
  const { db } = ctx;
  const incubadoras = (await db.collection("incubadoras").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const dispositivos = (await db.collection("dispositivos").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const ahora = Date.now();
  const ms = (t) => (t && t.toMillis ? t.toMillis() : null);

  console.log("\n IMPORTANTE: correlo con el Servicio de Integración DETENIDO (si no, un dispositivo vivo");
  console.log(" puede figurar con una comunicación de más de 60 s porque el servicio la refresca cada 60 s).");

  const porIncubadora = new Map();

  for (const d of dispositivos) {
    if (!porIncubadora.has(d.incubadoraId)) porIncubadora.set(d.incubadoraId, []);
    porIncubadora.get(d.incubadoraId).push(d);
  }

  const candidatos = [];
  const desconectados = [];

  for (const [incubadoraId, lista] of [...porIncubadora.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const inc = incubadoras.find((i) => i.id === incubadoraId);

    console.log(`\n ${inc ? inc.nombre : "(incubadora inexistente)"}  [${inc ? inc.estado : "?"}]  id=${incubadoraId}`);

    for (const d of lista) {
      const ultima = ms(d.ultimaComunicacionEn);
      const estado = d.estadoConexion || "desconocido";
      const vieja = ultima === null || ahora - ultima > UMBRAL_COMUNICACION_RECIENTE_MS;
      let marca = "";

      if (estado === "conectado" && vieja) {
        candidatos.push(d);
        marca = "  << «conectado» SIN comunicación reciente: el servicio lo marcaría desconectado";
      } else if (estado === "desconectado") {
        desconectados.push(d);
        marca = "  << desconectado: la incubadora figura «Crítico» hasta que vuelva a enviar latidos";
      }

      console.log(
        `    - ${String(d.tipo).padEnd(19)} ${estado.padEnd(13)} última comunicación ${lib.hora(d.ultimaComunicacionEn)} ${lib.hace(d.ultimaComunicacionEn)}  id ${lib.idCorto(d.id)}${marca}`
      );
    }
  }

  const alertasDesconexion = (await db.collection("alertas").where("tipo", "==", "dispositivo_desconectado").get()).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.estado !== "resuelta");

  if (alertasDesconexion.length > 0) {
    console.log(`\n Alertas «Dispositivo desconectado» abiertas: ${alertasDesconexion.length} (las resuelve el servicio cuando el equipo vuelva a comunicarse de forma estable; este comando no las toca).`);
  }

  console.log(`\n Dispositivos «conectado» sin comunicación reciente: ${candidatos.length}`);

  if (candidatos.length === 0) {
    console.log(" Nada que preparar.");

    return;
  }

  if (!ctx.escribe) {
    console.log(" SIMULACRO: con --confirmar se pondrían en «desconocido» (no se escribió nada).");

    return;
  }

  for (const d of candidatos) {
    await db.collection("dispositivos").doc(d.id).update({ estadoConexion: "desconocido" });
  }

  console.log(` Hecho: ${candidatos.length} dispositivo(s) puestos en «desconocido». Ahora podés arrancar el Servicio de Integración.`);
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
      "sin-tope": { type: "boolean" },
      "incluir-no-demo": { type: "boolean" },
      todas: { type: "boolean" },
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

  if (opciones.sostener > TOPE_SOSTENER_S && !values["sin-tope"]) {
    lib.abortar(
      `--sostener ${opciones.sostener} supera el tope de ${TOPE_SOSTENER_S} s: el panel lee solo las 200 lecturas más recientes ` +
        "de toda la base y un refresco largo expulsa de esa ventana a las otras incubadoras. Usá --sin-tope si de verdad lo querés."
    );
  }

  const soloLectura = escenario === "estado";
  const escribe = !soloLectura && escenario !== "preparar" && Boolean(values.confirmar);
  const entorno = lib.validarEntorno({ proyecto: values.proyecto, region: values.region });

  lib.imprimirEncabezado(`M.T.P.A. - Escenario de demo: ${escenario}`, entorno, {
    escribe: escenario === "preparar" ? Boolean(values.confirmar) : escribe,
    soloLectura,
  });

  const admin = lib.iniciarAdmin(entorno);
  const db = admin.firestore();
  const ctx = {
    db,
    entorno,
    escribe: escenario === "preparar" ? Boolean(values.confirmar) : escribe,
    tokenMedicion: process.env.PROCESAR_MEDICION_TOKEN,
  };

  if (escenario === "preparar") {
    await ejecutarPreparar(ctx);

    return;
  }

  if (escenario === "estado") {
    let incubadoras;

    if (textoIncubadora) {
      incubadoras = [await lib.resolverIncubadora(db, textoIncubadora)];
    } else if (values.todas) {
      incubadoras = (await db.collection("incubadoras").get()).docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
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

  if (!lib.esDemo(incubadora) && !values["incluir-no-demo"]) {
    lib.abortar(
      `La incubadora «${incubadora.nombre}» no lleva «(demo)» en el nombre: es una incubadora real y los escenarios ` +
        "que escriben no se aplican a ella. Si de verdad querés hacerlo, agregá --incluir-no-demo."
    );
  }

  if (incubadora.estado !== "activa") {
    lib.abortar(`La incubadora «${incubadora.nombre}» está ${incubadora.estado}: no recibe escenarios.`);
  }

  // PRE-VUELO (ii): el token de procesarMedicion se prueba sin escribir datos
  // (POST {}: 400 si es válido, 403 si no). Con --confirmar aborta antes de enviar.
  const preVuelo = lib.imprimirPreVuelo([await lib.preVueloTokenMedicion(entorno, ctx.tokenMedicion)]);

  if (!preVuelo) {
    if (escribe) {
      lib.abortar("El pre-vuelo falló: no se envió nada.");
    }

    process.exitCode = 1;
  }

  const contexto = await cargarContexto(db, incubadora);

  if (escenario === "refrescar") {
    await ejecutarRefresco(ctx, incubadora, contexto, opciones);

    return;
  }

  await ejecutarEscritura(ctx, escenario, incubadora, contexto, opciones);
}

lib.ejecutar(main);
