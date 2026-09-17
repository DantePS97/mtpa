import { createContext, useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";

import { auth } from "../services/firebase";
import usuariosRepository from "../repositories/usuariosRepository";

// =========================================================
// M.T.P.A. - CONTEXTO DE SESIÓN
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Expone { usuario, rol, cargando } a toda la aplicación,
// derivado del estado de Firebase Authentication combinado
// con el documento usuarios/{uid} de Firestore (que es donde
// vive el rol real del usuario).
// =========================================================

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
        const documentoUsuario = await usuariosRepository.obtenerUsuarioActual(
          firebaseUser.uid
        );

        setUsuario({
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          ...documentoUsuario,
        });

        setRol(documentoUsuario?.rol ?? null);
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
