import "./Table.css";

// =========================================================
// M.T.P.A. - COMPONENTE COMÚN: TABLE
// Mejora Técnica de Producción Avícola
// =========================================================
//
// Tabla genérica reutilizable. Ya la esperaba "Usuarios.jsx"
// (columns: [{ key, header, render? }], data: Object[]) desde
// Sprint 1, pero el archivo había quedado vacío; se implementa
// acá porque "Incubadoras.jsx" (Sprint 2) también la necesita.
//
// - columns: [{ key, header, render?(fila) }]
// - data: Object[] — cada fila debería tener "id"; si no lo
//   tiene, se usa el índice como key de React.
// =========================================================

const Table = ({ columns, data }) => {
  return (
    <table className="mtpa-table">
      <thead>
        <tr>
          {columns.map((columna) => (
            <th key={columna.key}>{columna.header}</th>
          ))}
        </tr>
      </thead>

      <tbody>
        {data.map((fila, indice) => (
          <tr key={fila.id ?? indice}>
            {columns.map((columna) => (
              <td key={columna.key}>
                {columna.render ? columna.render(fila) : fila[columna.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default Table;
