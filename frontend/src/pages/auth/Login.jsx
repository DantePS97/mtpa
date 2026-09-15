import { useState } from "react";
import { useNavigate } from "react-router-dom";
import authRepository from "../../repositories/authRepository";

const Login = () => {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await authRepository.login(
        form.email,
        form.password
      );

      // Ajusta esta línea si tu backend utiliza otra estructura.
      const user = response.user || response;
      const role = user.role;

      // Guardar sesión si tu aplicación utiliza localStorage.
      localStorage.setItem("user", JSON.stringify(user));

      if (response.token) {
        localStorage.setItem("token", response.token);
      }

      // Redirección según el rol.
      switch (role) {
        case "ADMIN":
          navigate("/admin");
          break;

        case "TECNICO":
          navigate("/tecnico");
          break;

        case "CLIENTE":
          navigate("/cliente");
          break;

        default:
          setError("El usuario no tiene un rol válido.");
      }
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          "Correo o contraseña incorrectos."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <h1>Iniciar sesión</h1>

        {error && (
          <div className="login-error">
            {error}
          </div>
        )}

        <div className="form-group">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="Ingrese su correo"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            name="password"
            type="password"
            value={form.password}
            onChange={handleChange}
            placeholder="Ingrese su contraseña"
            required
          />
        </div>

        <button type="submit" disabled={loading}>
          {loading ? "Iniciando sesión..." : "Iniciar sesión"}
        </button>
      </form>
    </div>
  );
};

export default Login;