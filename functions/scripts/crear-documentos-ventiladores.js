#!/usr/bin/env node
/**
 * Script standalone para crear los documentos "ventiladores/{id}" de
 * los dispositivos de tipo "ventilador" que ya existían antes de que
 * "crearDispositivo" los generara automáticamente.
 *
 * Por qué existe: la Cloud Function "enviarComandoVentilador" lee
 * "ventiladores/{ventiladorId}" y responde "not-found" si no existe.
 * Hasta ahora nada creaba esos documentos, y los clientes no pueden
 * escribirlos (ver firestore.rules). "crearDispositivo" ya los crea
 * para los ventiladores nuevos; este script cubre los que se dieron de
 * alta antes.
 *
 * IMPORTANTE:
 * - Este script NO se despliega como Cloud Function (ver
 *   "functions.ignore" en firebase.json, que excluye "scripts").
 *   Se ejecuta manualmente, una vez por entorno, DESPUÉS de desplegar
 *   las Cloud Functions.
 * - Requiere credenciales de una cuenta de servicio (Service Account)
 *   con permisos sobre el proyecto de Firebase (igual que
 *   crear-primer-admin.js, ver docs/bootstrap-admin.md).
 * - Es idempotente y seguro: solo crea los documentos que faltan y
 *   NUNCA sobrescribe uno existente (usa create()).
 * - Un dispositivo ventilador sin "incubadoraId" válido se omite y se
 *   informa: hay que corregirlo a mano.
 * - Exige indicar EXACTAMENTE un modo, para que un error de tipeo no
 *   escriba por accidente: "--dry-run" (simula, no escribe) o
 *   "--confirmar" (escribe). Sin argumentos, con un argumento
 *   desconocido o con ambos modos, no hace nada y termina con código 2.
 * - El proyecto de Firebase destino lo define la cuenta de servicio de
 *   GOOGLE_APPLICATION_CREDENTIALS. El script lee su "project_id", lo usa
 *   explícitamente e imprime "Proyecto de Firebase: <id>" antes de hacer
 *   nada: revisalo antes de confirmar.
 *
 * Uso (desde functions/). Primero en modo simulación, que no escribe:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS="./service-account.json" \
 *   node scripts/crear-documentos-ventiladores.js --dry-run
 *
 * Y luego, tras revisar el proyecto y el informe, en serio:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS="./service-account.json" \
 *   node scripts/crear-documentos-ventiladores.js --confirmar
 *
 * Códigos de salida: 0 = terminó bien; 1 = hubo errores al leer o
 * escribir en Firestore; 2 = uso incorrecto (argumentos) o no se pudo
 * leer "project_id" de las credenciales (no se escribió nada).
 */

const fs = require("fs");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { construirDocumentoVentilador } = require("../lib/ventilador");

const COLECCION_DISPOSITIVOS = "dispositivos";
const COLECCION_VENTILADORES = "ventiladores";
const TIPO_VENTILADOR = "ventilador";

// Límite de operaciones por batch de Firestore.
const TAMANIO_LOTE = 500;

const dividirEnLotes = (elementos) => {
  const lotes = [];

  for (let i = 0; i < elementos.length; i += TAMANIO_LOTE) {
    lotes.push(elementos.slice(i, i + TAMANIO_LOTE));
  }

  return lotes;
};

const ARGUMENTOS_VALIDOS = ["--dry-run", "--confirmar"];

// Devuelve true si es simulación (--dry-run) y false si debe escribir
// (--confirmar). Ante cualquier otra combinación termina con código 2.
const leerModo = () => {
  const args = process.argv.slice(2);
  const desconocidos = args.filter((a) => !ARGUMENTOS_VALIDOS.includes(a));

  if (desconocidos.length > 0) {
    console.error(`Argumentos no reconocidos: ${desconocidos.join(" ")}`);
    console.error(
      "Uso: node scripts/crear-documentos-ventiladores.js --dry-run | --confirmar"
    );
    process.exit(2);
  }

  const dryRun = args.includes("--dry-run");

  if (dryRun === args.includes("--confirmar")) {
    console.error(
      "Indicá exactamente uno: --dry-run (simula) o --confirmar (escribe)."
    );
    process.exit(2);
  }

  return dryRun;
};

// Lee el "project_id" de la cuenta de servicio apuntada por
// GOOGLE_APPLICATION_CREDENTIALS: es el proyecto donde se va a escribir.
const leerProyecto = () => {
  const ruta = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  try {
    const { project_id: id } = JSON.parse(fs.readFileSync(ruta, "utf8"));

    if (typeof id === "string" && id) return id;
  } catch (error) {
    // Se informa abajo.
  }

  console.error(
    "No se pudo leer project_id desde GOOGLE_APPLICATION_CREDENTIALS."
  );
  process.exit(2);
};

const main = async () => {
  const dryRun = leerModo();
  const projectId = leerProyecto();

  admin.initializeApp({ projectId });

  console.log(`Proyecto de Firebase: ${projectId}`);

  const db = admin.firestore();

  if (dryRun) {
    console.log("Modo --dry-run: no se escribe nada en Firestore.");
  }

  const dispositivos = await db
    .collection(COLECCION_DISPOSITIVOS)
    .where("tipo", "==", TIPO_VENTILADOR)
    .get();

  const total = dispositivos.docs.length;
  const omitidos = [];
  const candidatos = [];

  dispositivos.docs.forEach((doc) => {
    const { incubadoraId } = doc.data();

    if (typeof incubadoraId !== "string" || !incubadoraId.trim()) {
      omitidos.push(doc.id);
      return;
    }

    candidatos.push({ id: doc.id, incubadoraId });
  });

  // Se separan los que ya tienen su documento de los que faltan.
  const pendientes = [];
  let yaExistian = 0;

  for (const lote of dividirEnLotes(candidatos)) {
    const referencias = lote.map(({ id }) =>
      db.collection(COLECCION_VENTILADORES).doc(id)
    );
    const snapshots = await db.getAll(...referencias);

    snapshots.forEach((snapshot, indice) => {
      if (snapshot.exists) {
        yaExistian += 1;
      } else {
        pendientes.push(lote[indice]);
      }
    });
  }

  let creados = 0;
  let errores = 0;

  if (dryRun) {
    pendientes.forEach(({ id, incubadoraId }) => {
      console.log(`[dry-run] Se crearía ventiladores/${id} (incubadora ${incubadoraId}).`);
    });
  } else {
    for (const lote of dividirEnLotes(pendientes)) {
      const batch = db.batch();

      lote.forEach(({ id, incubadoraId }) => {
        batch.create(
          db.collection(COLECCION_VENTILADORES).doc(id),
          construirDocumentoVentilador({
            incubadoraId,
            dispositivoId: id,
            creadoEn: FieldValue.serverTimestamp(),
          })
        );
      });

      try {
        await batch.commit();
        creados += lote.length;
      } catch (error) {
        // Un batch es atómico: si falla, no se escribió ninguno de
        // este lote. Es seguro volver a correr el script.
        errores += lote.length;
        console.error(
          `Error al crear un lote de ${lote.length} documentos:`,
          error
        );
      }
    }
  }

  omitidos.forEach((id) => {
    console.warn(
      `Se omite dispositivos/${id}: no tiene un "incubadoraId" válido.`
    );
  });

  console.log("");
  console.log("Resumen:");
  console.log(`  Dispositivos ventilador encontrados: ${total}`);
  console.log(
    dryRun
      ? `  Se crearían: ${pendientes.length}`
      : `  Creados: ${creados}`
  );
  console.log(`  Ya existían: ${yaExistian}`);
  console.log(`  Omitidos (sin incubadoraId válido): ${omitidos.length}`);
  console.log(`  Errores: ${errores}`);

  return errores > 0 ? 1 : 0;
};

main()
  .then((codigo) => process.exit(codigo))
  .catch((error) => {
    console.error("Error al crear los documentos de ventiladores:", error);
    process.exit(1);
  });
