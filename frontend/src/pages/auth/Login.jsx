import { useState } from "react";
import { useNavigate } from "react-router-dom";

import authRepository from "../../repositories/authRepository";
import usuariosRepository from "../../repositories/usuariosRepository";
import { ROUTES } from "../../utils/constants";
import { isValidRole } from "../../utils/permissions";

import "./Login.css";

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
      const credenciales = await authRepository.login(
        form.correo,
        form.contraseña
      );

      const uid = credenciales.user.uid;

      const usuario = await usuariosRepository.obtenerUsuarioActual(uid);

      if (!usuario || !isValidRole(usuario.rol)) {
        setError("El usuario no tiene un rol válido.");
        await authRepository.logout();
        return;
      }

      if (usuario.activo === false) {
        setError("El usuario está desactivado. Contacte a un administrador.");
        await authRepository.logout();
        return;
      }

      navigate(ROUTES.DASHBOARD);
    } catch (err) {
      setError(
        err?.code === "auth/invalid-credential" ||
          err?.code === "auth/wrong-password" ||
          err?.code === "auth/user-not-found"
          ? "Correo o contraseña incorrectos."
          : err?.message || "No fue posible iniciar sesión."
      );
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
