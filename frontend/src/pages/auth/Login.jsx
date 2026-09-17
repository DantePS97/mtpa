import { useState } from "react";
import { useNavigate } from "react-router-dom";

import authRepository from "../../repositories/authRepository";
import { ROUTES } from "../../utils/constants";

import "./Login.css";

// =========================================================
// MENSAJES DE ERROR DE FIREBASE AUTHENTICATION
// =========================================================
//
// No se muestra nunca el err.message crudo del SDK: son
// mensajes en inglés, pensados para debugging, no para un
// usuario final.
// =========================================================

const MENSAJES_ERROR_AUTH = {
  "auth/invalid-credential": "Correo o contraseña incorrectos.",
  "auth/wrong-password": "Correo o contraseña incorrectos.",
  "auth/user-not-found": "Correo o contraseña incorrectos.",
  "auth/invalid-email": "El correo ingresado no es válido.",
  "auth/user-disabled":
    "Esta cuenta fue deshabilitada. Contacte a un administrador.",
  "auth/too-many-requests":
    "Demasiados intentos fallidos. Intente nuevamente más tarde.",
  "auth/network-request-failed":
    "No fue posible conectar con el servidor. Revise su conexión.",
};

const MENSAJE_ERROR_GENERICO =
  "No fue posible iniciar sesión. Intente nuevamente.";

const Login = () => {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    correo: "",
    contraseña: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));

    if (error) {
      setError("");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await authRepository.login(form.correo, form.contraseña);

      // No se valida acá ni el rol ni si el usuario está activo: esa
      // lectura ya la hace AuthContext (única fuente de verdad de la
      // sesión) cuando reacciona a este mismo login vía
      // onAuthStateChanged. Validarlo también acá generaba una
      // carrera entre dos lecturas independientes de
      // usuariosRepository.obtenerUsuarioActual. ProtectedRoute se
      // encarga de redirigir a /login o /sin-autorizacion si el
      // usuario terminara sin sesión válida o sin rol válido.
      navigate(ROUTES.DASHBOARD);
    } catch (err) {
      setError(MENSAJES_ERROR_AUTH[err?.code] || MENSAJE_ERROR_GENERICO);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1>Iniciar sesión</h1>
          <p>M.T.P.A. — Mejora Técnica de Producción Avícola</p>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <div className="form-group">
            <label htmlFor="correo">Correo electrónico</label>
            <input
              id="correo"
              name="correo"
              type="email"
              value={form.correo}
              onChange={handleChange}
              placeholder="Ingrese su correo"
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="contraseña">Contraseña</label>
            <input
              id="contraseña"
              name="contraseña"
              type="password"
              value={form.contraseña}
              onChange={handleChange}
              placeholder="Ingrese su contraseña"
              disabled={loading}
              required
            />
          </div>

          <button className="login-button" type="submit" disabled={loading}>
            {loading ? "Iniciando sesión..." : "Iniciar sesión"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
