// =========================================================
// M.T.P.A. - REPOSITORY DE DISPOSITIVOS
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Única capa autorizada a hablar directamente con Firestore
// para leer la colección "dispositivos", y con la Cloud
// Function "gestionarIncubadora" para dar de alta un
// dispositivo nuevo (ver functions/index.js, acción
// "crear_dispositivo").
// =========================================================

import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { db, functions } from "../services/firebase";
import { COLLECTIONS } from "../utils/constants";


// =========================================================
// LISTAR DISPOSITIVOS DE UNA INCUBADORA
// =========================================================

/**
 * Lee los dispositivos de la colección "dispositivos" cuyo
 * campo "incubadoraId" coincide con el id indicado.
 *
 * @param {string} incubadoraId
 * @returns {Promise<Object[]>}
 */
export const listarDispositivosPorIncubadora = async (incubadoraId) => {
  const referencia = query(
    collection(db, COLLECTIONS.DEVICES),
    where("incubadoraId", "==", incubadoraId)
  );

  const snapshot = await getDocs(referencia);

  return snapshot.docs.map((documento) => ({
    id: documento.id,
    ...documento.data(),
  }));
};


// =========================================================
// DAR DE ALTA UN DISPOSITIVO
// =========================================================

/**
 * Invoca la Cloud Function callable "crearDispositivo".
 *
 * Nota: el alta de dispositivos vivía originalmente como una
 * acción más de "gestionarIncubadora" (accion: "crear_dispositivo"),
 * pero se separó en su propia Cloud Function para que cada una
 * resuelva una única operación (ver functions/index.js).
 *
 * @param {Object} datos
 * @param {string} datos.incubadoraId Id de la incubadora dueña del dispositivo.
 * @param {string} datos.tipo "sensor_temperatura" | "sensor_humedad" | "ventilador".
 * @returns {Promise<Object>} `{ id, identificadorMqtt }`
 */
export const crearDispositivo = async (datos) => {
  const callable = httpsCallable(functions, "crearDispositivo");

  const resultado = await callable(datos);

  return resultado.data;
};


export default {
  listarDispositivosPorIncubadora,
  crearDispositivo,
};
