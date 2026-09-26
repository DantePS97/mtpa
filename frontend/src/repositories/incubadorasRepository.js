// =========================================================
// M.T.P.A. - REPOSITORY DE INCUBADORAS
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Única capa autorizada a hablar directamente con Firestore
// y con la Cloud Function "gestionarIncubadora" para todo lo
// relacionado a la colección "incubadoras".
// =========================================================

import {
  doc,
  getDoc,
  collection,
  getDocs,
} from "firebase/firestore";

import { httpsCallable } from "firebase/functions";

import { db, functions } from "../services/firebase";
import { COLLECTIONS } from "../utils/constants";


// =========================================================
// OBTENER INCUBADORA
// =========================================================

/**
 * Lee el documento incubadoras/{id} de Firestore.
 *
 * @param {string} id
 * @returns {Promise<Object|null>}
 * El documento de la incubadora (incluyendo su id), o null si no existe.
 */
export const obtenerIncubadora = async (id) => {
  const referencia = doc(db, COLLECTIONS.INCUBATORS, id);
  const snapshot = await getDoc(referencia);

  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...snapshot.data(),
  };
};


// =========================================================
// LISTAR INCUBADORAS
// =========================================================

/**
 * Lee toda la colección "incubadoras".
 *
 * @returns {Promise<Object[]>}
 */
export const listarIncubadoras = async () => {
  const referencia = collection(db, COLLECTIONS.INCUBATORS);
  const snapshot = await getDocs(referencia);

  return snapshot.docs.map((documento) => ({
    id: documento.id,
    ...documento.data(),
  }));
};


// =========================================================
// GESTIONAR INCUBADORA (crear / editar / desactivar / alta de dispositivo)
// =========================================================

/**
 * Invoca la Cloud Function callable "gestionarIncubadora".
 *
 * El "accion" viaja siempre dentro de "datos", ya que esta
 * función cubre tanto el CRUD de incubadoras
 * (accion: "crear" | "editar" | "desactivar") como el alta de
 * un dispositivo asociado (accion: "crear_dispositivo"), y cada
 * una necesita un conjunto de campos distinto.
 *
 * @param {Object} datos
 * @returns {Promise<Object>}
 */
export const gestionarIncubadora = async (datos) => {
  const callable = httpsCallable(functions, "gestionarIncubadora");
  const resultado = await callable(datos);

  return resultado.data;
};


export default {
  obtenerIncubadora,
  listarIncubadoras,
  gestionarIncubadora,
};
