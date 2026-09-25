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
 * Invoca la Cloud Function callable "gestionarIncubadora" con
 * la acción "crear_dispositivo".
 *
 * @param {Object} datos
 * @param {string} datos.incubadoraId Id de la incubadora dueña del dispositivo.
 * @param {string} datos.tipo "sensor_temperatura" | "sensor_humedad" | "ventilador".
 * @returns {Promise<Object>} `{ id, identificadorMqtt }`
 */
export const crearDispositivo = async (datos) => {
  const callable = httpsCallable(functions, "gestionarIncubadora");

  const resultado = await callable({
    accion: "crear_dispositivo",
    ...datos,
  });

  return resultado.data;
};


export default {
  listarDispositivosPorIncubadora,
  crearDispositivo,
};
