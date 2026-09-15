// =========================================================
// M.T.P.A. - UTILIDADES DE PERMISOS
// Mejora Técnica de Producción Avícola
// =========================================================

import {
  ROLES,
  ROLE_PERMISSIONS,
  PERMISSIONS,
  NAVIGATION_ITEMS,
} from "./constants";


// =========================================================
// OBTENER ROL DEL USUARIO
// =========================================================

/**
 * Obtiene el rol de un usuario.
 *
 * Soporta diferentes nombres de propiedad por si
 * el objeto proviene directamente de Firestore.
 *
 * @param {Object|null} user
 * @returns {string|null}
 */
export const getUserRole = (user) => {
  if (!user) {
    return null;
  }

  return (
    user.rol ||
    user.role ||
    null
  );
};


// =========================================================
// VALIDAR ROL
// =========================================================

/**
 * Comprueba si un rol existe dentro de los
 * roles definidos para M.T.P.A.
 */
export const isValidRole = (role) => {
  if (!role) {
    return false;
  }

  return Object.values(
    ROLES
  ).includes(role);
};


// =========================================================
// OBTENER PERMISOS DE UN ROL
// =========================================================

/**
 * Devuelve todos los permisos asignados a un rol.
 *
 * Ejemplo:
 *
 * getPermissionsByRole("administrador");
 */
export const getPermissionsByRole = (
  role
) => {
  if (!isValidRole(role)) {
    return [];
  }

  return (
    ROLE_PERMISSIONS[role] ||
    []
  );
};


// =========================================================
// OBTENER PERMISOS DEL USUARIO
// =========================================================

export const getUserPermissions = (
  user
) => {
  const role =
    getUserRole(user);

  return getPermissionsByRole(
    role
  );
};


// =========================================================
// COMPROBAR UN PERMISO
// =========================================================

/**
 * Comprueba si un rol posee un permiso.
 *
 * Ejemplo:
 *
 * hasPermission(
 *   "administrador",
 *   PERMISSIONS.MANAGE_USERS
 * );
 */
export const hasPermission = (
  role,
  permission
) => {
  if (
    !role ||
    !permission
  ) {
    return false;
  }

  const permissions =
    getPermissionsByRole(role);

  return permissions.includes(
    permission
  );
};


// =========================================================
// COMPROBAR PERMISO DEL USUARIO
// =========================================================

/**
 * Variante que recibe directamente el usuario.
 */
export const userHasPermission = (
  user,
  permission
) => {
  const role =
    getUserRole(user);

  return hasPermission(
    role,
    permission
  );
};


// =========================================================
// COMPROBAR TODOS LOS PERMISOS
// =========================================================

/**
 * Devuelve true solamente cuando el rol posee
 * TODOS los permisos indicados.
 *
 * Ejemplo:
 *
 * hasAllPermissions(
 *   role,
 *   [
 *     PERMISSIONS.VIEW_FANS,
 *     PERMISSIONS.CONTROL_FANS
 *   ]
 * );
 */
export const hasAllPermissions = (
  role,
  permissions = []
) => {
  if (
    !role ||
    !Array.isArray(permissions)
  ) {
    return false;
  }

  if (permissions.length === 0) {
    return true;
  }

  const rolePermissions =
    getPermissionsByRole(role);

  return permissions.every(
    (permission) =>
      rolePermissions.includes(
        permission
      )
  );
};


// =========================================================
// COMPROBAR ALGÚN PERMISO
// =========================================================

/**
 * Devuelve true cuando el rol posee AL MENOS
 * uno de los permisos indicados.
 */
export const hasAnyPermission = (
  role,
  permissions = []
) => {
  if (
    !role ||
    !Array.isArray(permissions)
  ) {
    return false;
  }

  if (permissions.length === 0) {
    return false;
  }

  const rolePermissions =
    getPermissionsByRole(role);

  return permissions.some(
    (permission) =>
      rolePermissions.includes(
        permission
      )
  );
};


// =========================================================
// COMPROBAR ROL
// =========================================================

/**
 * Comprueba si el usuario tiene un rol específico.
 */
export const hasRole = (
  user,
  role
) => {
  if (
    !user ||
    !role
  ) {
    return false;
  }

  return (
    getUserRole(user) === role
  );
};


// =========================================================
// COMPROBAR VARIOS ROLES
// =========================================================

/**
 * Comprueba si el usuario pertenece a cualquiera
 * de los roles recibidos.
 */
export const hasAnyRole = (
  user,
  roles = []
) => {
  if (
    !user ||
    !Array.isArray(roles)
  ) {
    return false;
  }

  const userRole =
    getUserRole(user);

  return roles.includes(
    userRole
  );
};


// =========================================================
// ADMINISTRADOR
// =========================================================

export const isAdmin = (
  user
) => {
  return hasRole(
    user,
    ROLES.ADMIN
  );
};


// =========================================================
// OPERADOR
// =========================================================

export const isOperator = (
  user
) => {
  return hasRole(
    user,
    ROLES.OPERATOR
  );
};


// =========================================================
// USUARIO DE CONSULTA
// =========================================================

export const isViewer = (
  user
) => {
  return hasRole(
    user,
    ROLES.VIEWER
  );
};


// =========================================================
// ACCESO AL DASHBOARD
// =========================================================

export const canViewDashboard = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_DASHBOARD
  );
};


// =========================================================
// INCUBADORAS
// =========================================================

export const canViewIncubators = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_INCUBATORS
  );
};


export const canManageIncubators = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_INCUBATORS
  );
};


// =========================================================
// DISPOSITIVOS
// =========================================================

export const canViewDevices = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_DEVICES
  );
};


export const canManageDevices = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_DEVICES
  );
};


// =========================================================
// MEDICIONES
// =========================================================

export const canViewMeasurements = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_MEASUREMENTS
  );
};


// =========================================================
// HISTÓRICOS
// =========================================================

export const canViewHistory = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_HISTORY
  );
};


// =========================================================
// ESTADÍSTICAS
// =========================================================

export const canViewStatistics = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_STATISTICS
  );
};


// =========================================================
// ALERTAS
// =========================================================

export const canViewAlerts = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_ALERTS
  );
};


export const canManageAlerts = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_ALERTS
  );
};


// =========================================================
// VENTILADORES
// =========================================================

export const canViewFans = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_FANS
  );
};


export const canControlFans = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.CONTROL_FANS
  );
};


// =========================================================
// AUTOMATIZACIÓN
// =========================================================

export const canManageAutomation = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_AUTOMATION
  );
};


// =========================================================
// USUARIOS
// =========================================================

export const canManageUsers = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_USERS
  );
};


// =========================================================
// AUDITORÍA
// =========================================================

export const canViewAudit = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.VIEW_AUDIT
  );
};


// =========================================================
// CONFIGURACIÓN
// =========================================================

export const canManageSettings = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_SETTINGS
  );
};


// =========================================================
// UMBRALES
// =========================================================

export const canManageThresholds = (
  user
) => {
  return userHasPermission(
    user,
    PERMISSIONS.MANAGE_THRESHOLDS
  );
};


// =========================================================
// NAVEGACIÓN SEGÚN ROL
// =========================================================

/**
 * Filtra NAVIGATION_ITEMS utilizando los permisos
 * disponibles para el rol.
 *
 * Será utilizado principalmente por Sidebar.jsx y
 * MobileNavigation.jsx.
 */
export const getNavigationByRole = (
  role
) => {
  if (!isValidRole(role)) {
    return [];
  }

  return NAVIGATION_ITEMS.filter(
    (item) => {
      if (!item.permission) {
        return true;
      }

      return hasPermission(
        role,
        item.permission
      );
    }
  );
};


// =========================================================
// NAVEGACIÓN SEGÚN USUARIO
// =========================================================

export const getNavigationForUser = (
  user
) => {
  const role =
    getUserRole(user);

  return getNavigationByRole(
    role
  );
};


// =========================================================
// COMPROBAR ACCESO A UN ELEMENTO DE NAVEGACIÓN
// =========================================================

export const canAccessNavigationItem = (
  user,
  item
) => {
  if (
    !user ||
    !item
  ) {
    return false;
  }

  if (!item.permission) {
    return true;
  }

  return userHasPermission(
    user,
    item.permission
  );
};


// =========================================================
// COMPROBAR ACCESO A RUTA
// =========================================================

/**
 * Función genérica que puede utilizar RoleRoute.jsx.
 *
 * Si no se especifican restricciones, permite acceso
 * a cualquier usuario autenticado.
 */
export const canAccessRoute = (
  user,
  {
    roles = [],
    permissions = [],
    requireAllPermissions = false,
  } = {}
) => {
  if (!user) {
    return false;
  }

  const role =
    getUserRole(user);

  if (!isValidRole(role)) {
    return false;
  }

  // ---------------------------------------------
  // Validar roles
  // ---------------------------------------------

  if (
    Array.isArray(roles) &&
    roles.length > 0 &&
    !roles.includes(role)
  ) {
    return false;
  }

  // ---------------------------------------------
  // Sin permisos adicionales
  // ---------------------------------------------

  if (
    !Array.isArray(permissions) ||
    permissions.length === 0
  ) {
    return true;
  }

  // ---------------------------------------------
  // Todos los permisos
  // ---------------------------------------------

  if (requireAllPermissions) {
    return hasAllPermissions(
      role,
      permissions
    );
  }

  // ---------------------------------------------
  // Al menos un permiso
  // ---------------------------------------------

  return hasAnyPermission(
    role,
    permissions
  );
};


// =========================================================
// OBTENER INFORMACIÓN DE ACCESO
// =========================================================

/**
 * Puede utilizarse cuando necesitamos saber no solo
 * si existe acceso, sino el motivo del rechazo.
 */
export const getAccessResult = (
  user,
  options = {}
) => {
  if (!user) {
    return {
      allowed: false,
      reason: "unauthenticated",
    };
  }

  const role =
    getUserRole(user);

  if (!isValidRole(role)) {
    return {
      allowed: false,
      reason: "invalid-role",
    };
  }

  const allowed =
    canAccessRoute(
      user,
      options
    );

  if (!allowed) {
    return {
      allowed: false,
      reason: "unauthorized",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
};


// =========================================================
// ACCIONES DE USUARIO
// =========================================================

/**
 * Devuelve las acciones que puede realizar el usuario.
 *
 * Puede ser útil para ocultar botones en las tablas
 * o páginas.
 */
export const getUserCapabilities = (
  user
) => {
  return {
    viewDashboard:
      canViewDashboard(user),

    viewIncubators:
      canViewIncubators(user),

    manageIncubators:
      canManageIncubators(user),

    viewDevices:
      canViewDevices(user),

    manageDevices:
      canManageDevices(user),

    viewMeasurements:
      canViewMeasurements(user),

    viewHistory:
      canViewHistory(user),

    viewStatistics:
      canViewStatistics(user),

    viewAlerts:
      canViewAlerts(user),

    manageAlerts:
      canManageAlerts(user),

    viewFans:
      canViewFans(user),

    controlFans:
      canControlFans(user),

    manageAutomation:
      canManageAutomation(user),

    manageUsers:
      canManageUsers(user),

    viewAudit:
      canViewAudit(user),

    manageSettings:
      canManageSettings(user),

    manageThresholds:
      canManageThresholds(user),
  };
};