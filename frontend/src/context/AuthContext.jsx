import { createContext, useEffect, useState } from "react";
import { getIdTokenResult, onAuthStateChanged } from "firebase/auth";

import { auth } from "../services/firebase";
import authRepository from "../repositories/authRepository";
import usuariosRepository from "../repositories/usuariosRepository";

// =========================================================
// M.T.P.A. - CONTEXTO DE SESIÓN
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Expone { usuario, rol, cargando } a toda la aplicación.
//
// El ROL "oficial" (el que se usa para decisiones de acceso)
// se lee del custom claim del ID token (getIdTokenResult),
// que es exactamente lo que validan firestore.rules y las
// Cloud Functions (request.auth.token.role /
// context.auth.token.role). El documento usuarios/{uid} de
// Firestore se usa solo para datos de perfil (nombre, correo,
// activo); su campo "rol" NO se usa para decidir acceso, para
// evitar que quede desincronizado del custom claim real.
// =========================================================

// El contexto se exporta junto al provider a propósito, para que
// hooks/useAuth.js pueda usarlo con useContext() sin recrearlo.
// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext(undefined);

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(null);
  const [rol, setRol] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const desuscribirse = onAuthStateChanged(auth, async (firebaseUser) => {
      setCargando(true);

      if (!firebaseUser) {
        setUsuario(null);
        setRol(null);
        setCargando(false);
        return;
      }

      try {
        // Se fuerza el refresh (forceRefresh = true) para no quedarse
        // con un custom claim "role" desactualizado: Firebase cachea
        // el ID token hasta una hora, y un cambio de rol (o una
        // desactivación) hecho por un administrador vía
        // gestionarUsuario no debe tardar hasta una hora en reflejarse.
        const [tokenResult, documentoUsuario] = await Promise.all([
          getIdTokenResult(firebaseUser, true),
          usuariosRepository.obtenerUsuarioActual(firebaseUser.uid),
        ]);

        // Un usuario desactivado (activo: false en Firestore) no debe
        // quedar autenticado, aunque su token de Authentication
        // todavía sea técnicamente válido: se cierra la sesión acá
        // mismo, en la única fuente de verdad de la app.
        if (documentoUsuario?.activo === false) {
          await authRepository.logout();
          setUsuario(null);
          setRol(null);
          return;
        }

        const rolDelToken = tokenResult.claims.role ?? null;

        setUsuario({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          // Datos de perfil: nombre, correo, activo, etc.
          ...documentoUsuario,
          // El rol SIEMPRE se pisa con el del custom claim, nunca con
          // el que pueda traer el documento de Firestore.
          rol: rolDelToken,
        });

        setRol(rolDelToken);
      } catch (error) {
        console.error(
          "No fue posible obtener el usuario autenticado:",
          error
        );

        setUsuario(null);
        setRol(null);
      } finally {
        setCargando(false);
      }
    });

    return desuscribirse;
  }, []);

  return (
    <AuthContext.Provider value={{ usuario, rol, cargando }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
