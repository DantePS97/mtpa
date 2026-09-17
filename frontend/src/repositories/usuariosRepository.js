// =========================================================
// M.T.P.A. - REPOSITORY DE USUARIOS
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Única capa autorizada a hablar directamente con Firestore
// y con la Cloud Function "gestionarUsuario" para todo lo
// relacionado a la colección "usuarios".
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
// OBTENER USUARIO ACTUAL
// =========================================================

/**
 * Lee el documento usuarios/{uid} de Firestore.
 *
 * @param {string} uid
 * @returns {Promise<Object|null>}
 * El documento del usuario (incluyendo su id), o null si no existe.
 */
export const obtenerUsuarioActual = async (uid) => {
  const referencia = doc(db, COLLECTIONS.USERS, uid);
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
// LISTAR USUARIOS
// =========================================================

/**
 * Lee toda la colección "usuarios".
 *
 * Solo debería invocarse cuando el usuario autenticado tiene
 * rol "administrador": la restricción real la aplican las
 * reglas de Firestore (firestore.rules), no esta función.
 *
 * @returns {Promise<Object[]>}
 */
export const listarUsuarios = async () => {
  const referencia = collection(db, COLLECTIONS.USERS);
  const snapshot = await getDocs(referencia);

  return snapshot.docs.map((documento) => ({
    id: documento.id,
    ...documento.data(),
  }));
};


// =========================================================
// GESTIONAR USUARIO (crear / editar / desactivar)
// =========================================================

/**
 * Invoca la Cloud Function callable "gestionarUsuario".
 *
 * Admite dos formas de uso, para acomodar tanto la creación
 * como la edición/desactivación desde las páginas existentes
 * (UsuarioForm.jsx y Usuarios.jsx):
 *
 * - gestionarUsuario({ nombre, correo, rol })
 *   Crea un usuario nuevo.
 *
 * - gestionarUsuario(uid, { nombre, correo, rol })
 *   Edita los campos indicados del usuario "uid".
 *
 * - gestionarUsuario(uid, { activo: false })
 *   Desactiva al usuario "uid".
 *
 * @param {string|Object} idOrDatos
 * @param {Object} [datos]
 */
export const gestionarUsuario = async (idOrDatos, datos) => {
  const callable = httpsCallable(functions, "gestionarUsuario");

  let payload;

  if (datos === undefined) {
    // Creación: se recibió un único objeto con los datos del usuario.
    payload = { accion: "crear", ...idOrDatos };
  } else {
    // Edición o desactivación: se recibió el uid y los campos a cambiar.
    const esSoloDesactivacion =
      datos.activo === false && Object.keys(datos).length === 1;

    payload = {
      accion: esSoloDesactivacion ? "desactivar" : "editar",
      uid: idOrDatos,
      ...datos,
    };
  }

  const resultado = await callable(payload);

  return resultado.data;
};


// =========================================================
// ALIAS: OBTENER USUARIO POR ID
// =========================================================
//
// UsuarioForm.jsx (pantalla de edición) invoca
// "obtenerUsuario(id)" para precargar el formulario. Se
// expone como alias de obtenerUsuarioActual, ya que ambas
// operaciones son idénticas: leer usuarios/{uid}.
// =========================================================

export const obtenerUsuario = obtenerUsuarioActual;


export default {
  obtenerUsuarioActual,
  obtenerUsuario,
  listarUsuarios,
  gestionarUsuario,
};
