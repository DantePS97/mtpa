import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Table from "../../components/common/Table";
import usuariosRepository from "../../repositories/usuariosRepository";
import { ROUTES } from "../../utils/constants";
import "./Usuarios.css";

const Usuarios = () => {
  const navigate = useNavigate();

  const [usuarios, setUsuarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const cargarUsuarios = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await usuariosRepository.listarUsuarios();

      const data = response?.usuarios || response?.data || response || [];

      setUsuarios(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "No fue posible cargar los usuarios."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const handleDesactivar = async (usuario) => {
    const confirmado = window.confirm(
      `¿Está seguro de que desea desactivar al usuario "${usuario.nombre}"?`
    );

    if (!confirmado) return;

    try {
      setError("");

      await usuariosRepository.gestionarUsuario(usuario.id, {
        activo: false,
      });

      await cargarUsuarios();
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          err?.message ||
          "No fue posible desactivar el usuario."
      );
    }
  };

  const columns = [
    {
      key: "nombre",
      header: "Nombre",
    },
    {
      key: "correo",
      header: "Correo",
    },
    {
      key: "rol",
      header: "Rol",
      render: (usuario) => usuario.rol || usuario.role || "Sin rol",
    },
    {
      key: "activo",
      header: "Estado",
      render: (usuario) => (
        <span
          className={`estado-badge ${
            usuario.activo ? "estado-activo" : "estado-inactivo"
          }`}
        >
          {usuario.activo ? "Activo" : "Inactivo"}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (usuario) => (
        <div className="usuario-actions">
          <button
            type="button"
            className="btn-edit"
            onClick={() =>
              navigate(ROUTES.USER_EDIT.replace(":id", usuario.id))
            }
          >
            Editar
          </button>

          {usuario.activo && (
            <button
              type="button"
              className="btn-disable"
              onClick={() => handleDesactivar(usuario)}
            >
              Desactivar
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="usuarios-page">
      <div className="usuarios-header">
        <div>
          <h1>Gestión de usuarios</h1>
          <p>Administre los usuarios y sus roles dentro del sistema.</p>
        </div>

        <button
          type="button"
          className="btn-new-user"
          onClick={() => navigate("/usuarios/nuevo")}
        >
          + Nuevo usuario
        </button>
      </div>

      {error && (
        <div className="usuarios-error" role="alert">
          {error}
        </div>
      )}

      <div className="usuarios-card">
        {loading ? (
          <div className="usuarios-loading">
            Cargando usuarios...
          </div>
        ) : usuarios.length === 0 ? (
          <div className="usuarios-empty">
            No hay usuarios registrados.
          </div>
        ) : (
          <Table columns={columns} data={usuarios} />
        )}
      </div>
    </section>
  );
};

export default Usuarios;
