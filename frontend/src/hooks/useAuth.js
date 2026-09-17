import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

// =========================================================
// M.T.P.A. - HOOK useAuth
// Mejora Técnica de Producción Avícola
// =========================================================

/**
 * Da acceso a { usuario, rol, cargando } desde cualquier
 * componente envuelto por <AuthContext.Provider>.
 */
export const useAuth = () => {
  const context = useContext(AuthContext);

  if (context === undefined) {
    throw new Error(
      "useAuth debe usarse dentro de un <AuthContext.Provider>."
    );
  }

  return context;
};

export default useAuth;
