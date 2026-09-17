// =========================================================
// M.T.P.A. - REPOSITORY DE AUTENTICACIÓN
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Única capa autorizada a hablar directamente con Firebase
// Authentication. El resto de la aplicación (hooks, páginas)
// no debe importar "firebase/auth" directamente.
// =========================================================

import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import { auth } from "../services/firebase";


// =========================================================
// INICIAR SESIÓN
// =========================================================

/**
 * Inicia sesión con correo y contraseña.
 *
 * @param {string} correo
 * @param {string} contraseña
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
export const login = (correo, contraseña) => {
  return signInWithEmailAndPassword(auth, correo, contraseña);
};


// =========================================================
// CERRAR SESIÓN
// =========================================================

/**
 * Cierra la sesión actual.
 */
export const logout = () => {
  return signOut(auth);
};


// =========================================================
// USUARIO ACTUAL
// =========================================================

/**
 * Devuelve el usuario de Firebase Authentication actualmente
 * autenticado, o null si no hay sesión.
 */
export const getCurrentUser = () => {
  return auth.currentUser;
};


export default {
  login,
  logout,
  getCurrentUser,
};
