// =========================================================
// M.T.P.A. - REPOSITORY DE DISPOSITIVOS
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Única capa autorizada a hablar directamente con Firestore
// para leer la colección "dispositivos", y con la Cloud
// Function "crearDispositivo" para dar de alta un dispositivo
// nuevo (ver functions/index.js).
// =========================================================

import {
  collection,
  getDocs,
  onSnapshot,
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
// SUSCRIBIRSE A LOS DISPOSITIVOS DE UNA INCUBADORA (TIEMPO REAL)
// =========================================================

/**
 * Se suscribe (onSnapshot) a los dispositivos de la colección
 * "dispositivos" cuyo campo "incubadoraId" coincide con el id
 * indicado, para reflejar en tiempo real cambios de
 * "estadoConexion" (por ejemplo, cuando el Servicio de
 * Integración IoT marque un dispositivo como "desconectado" en
 * Sprint 3), en vez de depender de una lectura única.
 *
 * @param {string} incubadoraId
 * @param {(dispositivos: Object[]) => void} onCambio Se invoca con la
 * lista actualizada de dispositivos cada vez que cambia algo en Firestore.
 * @param {(error: Error) => void} [onError]
 * @returns {() => void} Función "unsubscribe": hay que invocarla en el
 * cleanup del efecto que la usa para no dejar el listener colgado.
 */
export const suscribirseADispositivosPorIncubadora = (
  incubadoraId,
  onCambio,
  onError
) => {
  const referencia = query(
    collection(db, COLLECTIONS.DEVICES),
    where("incubadoraId", "==", incubadoraId)
  );

  return onSnapshot(
    referencia,
    (snapshot) => {
      const dispositivos = snapshot.docs.map((documento) => ({
        id: documento.id,
        ...documento.data(),
      }));

      onCambio(dispositivos);
    },
    onError
  );
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
  suscribirseADispositivosPorIncubadora,
  crearDispositivo,
};
