```jsx
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import usuariosRepository from "../../repositories/usuariosRepository";
import "./UsuarioForm.css";

const UsuarioForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();

  const isEditing = Boolean(id);

  const [formData, setFormData] = useState({
    nombre: "",
    correo: "",
    rol: "",
  });

  const [loading, setLoading] = useState(false);
  const [loadingUser, setLoadingUser] = useState(isEditing);
  const [error, setError] = useState("");

  const cargarUsuario = async () => {
    try {
      setLoadingUser(true);
      setError("");

      const response = await usuariosRepository.obtenerUsuario(id);

      const usuario = response?.usuario || response?.data || response;

      setFormData({
        nombre: usuario?.nombre || "",
        correo: usuario?.correo || usuario?.email || "",
        rol: usuario?.rol || usuario?.role || "",
      });
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "No fue posible cargar el usuario."
      );
    } finally {
      setLoadingUser(false);
    }
  };

  useEffect(() => {
    if (isEditing) {
      cargarUsuario();
    }
  }, [id]);

  const handleChange = (event) => {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));

    if (error) {
      setError("");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formData.nombre.trim()) {
      setError("El nombre es obligatorio.");
      return;
    }

    if (!formData.correo.trim()) {
      setError("El correo es obligatorio.");
      return;
    }

    if (!formData.rol) {
      setError("Debe seleccionar un rol.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      if (isEditing) {
        await usuariosRepository.gestionarUsuario(id, {
          nombre: formData.nombre.trim(),
          correo: formData.correo.trim(),
          rol: formData.rol,
        });
      } else {
        await usuariosRepository.gestionarUsuario({
          nombre: formData.nombre.trim(),
          correo: formData.correo.trim(),
          rol: formData.rol,
        });
      }

      navigate("/usuarios");
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.response?.data?.error ||
          err?.message ||
          "No fue posible guardar el usuario."
      );
    } finally {
      setLoading(false);
    }
  };

  if (loadingUser) {
    return (
      <section className="usuario-form-page">
        <div className="usuario-form-card">
          <p className="usuario-form-loading">
            Cargando usuario...
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="usuario-form-page">
      <div className="usuario-form-card">
        <div className="usuario-form-header">
          <button
            type="button"
            className="btn-back"
            onClick={() => navigate("/usuarios")}
          >
            ← Volver
          </button>

          <div>
            <h1>
              {isEditing
                ? "Editar usuario"
                : "Nuevo usuario"}
            </h1>

            <p>
              {isEditing
                ? "Modifique la información del usuario."
                : "Registre un nuevo usuario en el sistema."}
            </p>
          </div>
        </div>

        {error && (
          <div className="usuario-form-error" role="alert">
            {error}
          </div>
        )}

        <form
          className="usuario-form"
          onSubmit={handleSubmit}
        >
          <div className="form-group">
            <label htmlFor="nombre">
              Nombre completo
            </label>

            <input
              id="nombre"
              name="nombre"
              type="text"
              value={formData.nombre}
              onChange={handleChange}
              placeholder="Ingrese el nombre completo"
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="correo">
              Correo electrónico
            </label>

            <input
              id="correo"
              name="correo"
              type="email"
              value={formData.correo}
              onChange={handleChange}
              placeholder="correo@ejemplo.com"
              disabled={loading}
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="rol">
              Rol
            </label>

            <select
              id="rol"
              name="rol"
              value={formData.rol}
              onChange={handleChange}
              disabled={loading}
              required
            >
              <option value="">
                Seleccione un rol
              </option>

              <option value="ADMIN">
                Administrador
              </option>

              <option value="OPERADOR">
                Operador
              </option>

              <option value="CONSULTA">
                Usuario de consulta
              </option>
            </select>
          </div>

          <div className="usuario-form-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={() => navigate("/usuarios")}
              disabled={loading}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="btn-save"
              disabled={loading}
            >
              {loading
                ? "Guardando..."
                : isEditing
                ? "Guardar cambios"
                : "Crear usuario"}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

export default UsuarioForm;
```
