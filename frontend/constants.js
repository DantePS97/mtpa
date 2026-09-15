// =========================================================
// M.T.P.A. - CONSTANTES GLOBALES
// Mejora Técnica de Producción Avícola
// =========================================================


// =========================================================
// INFORMACIÓN DE LA APLICACIÓN
// =========================================================

export const APP = {
  NAME: "M.T.P.A.",
  FULL_NAME: "Mejora Técnica de Producción Avícola",
  VERSION: "1.0.0",
  DEFAULT_LANGUAGE: "es",
};


// =========================================================
// ROLES
// =========================================================

export const ROLES = {
  ADMIN: "administrador",
  OPERATOR: "operador",
  VIEWER: "consulta",
};


// =========================================================
// NOMBRES DE LOS ROLES
// =========================================================

export const ROLE_LABELS = {
  [ROLES.ADMIN]: "Administrador",
  [ROLES.OPERATOR]: "Operador",
  [ROLES.VIEWER]: "Usuario de consulta",
};


// =========================================================
// RUTAS
// =========================================================

export const ROUTES = {
  HOME: "/",

  LOGIN: "/login",
  FORGOT_PASSWORD: "/recuperar-contrasena",

  DASHBOARD: "/dashboard",

  INCUBATORS: "/incubadoras",
  INCUBATOR_DETAIL: "/incubadoras/:id",
  INCUBATOR_CREATE: "/incubadoras/nueva",
  INCUBATOR_EDIT: "/incubadoras/:id/editar",

  DEVICES: "/dispositivos",
  DEVICE_CREATE: "/dispositivos/nuevo",
  DEVICE_EDIT: "/dispositivos/:id/editar",

  HISTORY: "/historicos",
  STATISTICS: "/estadisticas",

  ALERTS: "/alertas",
  ALERT_DETAIL: "/alertas/:id",

  FANS: "/ventiladores",
  AUTOMATION: "/ventiladores/automatizacion",

  USERS: "/usuarios",
  USER_CREATE: "/usuarios/nuevo",
  USER_EDIT: "/usuarios/:id/editar",

  AUDIT: "/auditoria",

  SETTINGS: "/configuracion",
  THRESHOLDS: "/configuracion/limites",
  LANGUAGE: "/configuracion/idioma",

  PROFILE: "/perfil",

  UNAUTHORIZED: "/sin-autorizacion",
  NOT_FOUND: "*",
};


// =========================================================
// ESTADOS GENERALES
// =========================================================

export const STATUS = {
  ACTIVE: "activo",
  INACTIVE: "inactivo",

  NORMAL: "normal",
  WARNING: "advertencia",
  CRITICAL: "critico",

  CONNECTED: "conectado",
  DISCONNECTED: "desconectado",

  UNKNOWN: "desconocido",
};


// =========================================================
// ESTADOS DE INCUBADORAS
// =========================================================

export const INCUBATOR_STATUS = {
  ACTIVE: "activa",
  INACTIVE: "inactiva",
  WARNING: "advertencia",
  CRITICAL: "critica",
  MAINTENANCE: "mantenimiento",
};


// =========================================================
// ESTADOS DE DISPOSITIVOS
// =========================================================

export const DEVICE_STATUS = {
  CONNECTED: "conectado",
  DISCONNECTED: "desconectado",
  WARNING: "advertencia",
  UNKNOWN: "desconocido",
};


// =========================================================
// TIPOS DE DISPOSITIVOS
// =========================================================

export const DEVICE_TYPES = {
  TEMPERATURE_SENSOR: "sensor_temperatura",
  HUMIDITY_SENSOR: "sensor_humedad",
  TEMPERATURE_HUMIDITY_SENSOR: "sensor_temperatura_humedad",
  FAN: "ventilador",
  CONTROLLER: "controlador",
};


// =========================================================
// VARIABLES AMBIENTALES
// =========================================================

export const ENVIRONMENTAL_VARIABLES = {
  TEMPERATURE: "temperatura",
  HUMIDITY: "humedad",
};


// =========================================================
// UNIDADES
// =========================================================

export const UNITS = {
  TEMPERATURE: "°C",
  HUMIDITY: "%",
  FAN_SPEED: "%",
};


// =========================================================
// RANGOS AMBIENTALES DE REFERENCIA
// =========================================================

/*
 * Valores de referencia establecidos para el proyecto.
 *
 * Importante:
 * Los valores reales de operación deberían obtenerse
 * posteriormente desde la configuración/umbrales almacenados
 * en Firebase y no depender permanentemente de estas
 * constantes.
 */

export const REFERENCE_RANGES = {
  TEMPERATURE: {
    MIN: 37.2,
    MAX: 37.8,
    UNIT: UNITS.TEMPERATURE,
  },

  HUMIDITY: {
    MIN: 45,
    MAX: 65,
    UNIT: UNITS.HUMIDITY,
  },
};


// =========================================================
// TIPOS DE ALERTA
// =========================================================

export const ALERT_TYPES = {
  HIGH_TEMPERATURE: "temperatura_alta",
  LOW_TEMPERATURE: "temperatura_baja",

  HIGH_HUMIDITY: "humedad_alta",
  LOW_HUMIDITY: "humedad_baja",

  DEVICE_DISCONNECTED: "dispositivo_desconectado",

  COMMUNICATION_LOST: "perdida_comunicacion",

  SYSTEM: "sistema",
};


// =========================================================
// SEVERIDAD DE ALERTAS
// =========================================================

export const ALERT_SEVERITY = {
  INFO: "informativa",
  WARNING: "advertencia",
  CRITICAL: "critica",
};


// =========================================================
// ESTADO DE ALERTAS
// =========================================================

export const ALERT_STATUS = {
  ACTIVE: "activa",
  ACKNOWLEDGED: "reconocida",
  RESOLVED: "resuelta",
};


// =========================================================
// ETIQUETAS DE SEVERIDAD
// =========================================================

export const ALERT_SEVERITY_LABELS = {
  [ALERT_SEVERITY.INFO]: "Informativa",
  [ALERT_SEVERITY.WARNING]: "Advertencia",
  [ALERT_SEVERITY.CRITICAL]: "Crítica",
};


// =========================================================
// VENTILADORES
// =========================================================

export const FAN_STATUS = {
  ON: "encendido",
  OFF: "apagado",
};


// =========================================================
// MODOS DE CONTROL DEL VENTILADOR
// =========================================================

export const FAN_CONTROL_MODE = {
  MANUAL: "manual",
  AUTOMATIC: "automatico",
  MIXED: "mixto",
};


// =========================================================
// ETIQUETAS DE MODOS DE CONTROL
// =========================================================

export const FAN_CONTROL_MODE_LABELS = {
  [FAN_CONTROL_MODE.MANUAL]: "Manual",
  [FAN_CONTROL_MODE.AUTOMATIC]: "Automático",
  [FAN_CONTROL_MODE.MIXED]: "Mixto",
};


// =========================================================
// ACCIONES DEL VENTILADOR
// =========================================================

export const FAN_ACTIONS = {
  TURN_ON: "encender",
  TURN_OFF: "apagar",
  SET_SPEED: "establecer_velocidad",
};


// =========================================================
// VELOCIDAD DEL VENTILADOR
// =========================================================

export const FAN_SPEED = {
  MIN: 0,
  MAX: 100,
  STEP: 10,
};


// =========================================================
// ESTADOS DE ÓRDENES
// =========================================================

export const COMMAND_STATUS = {
  PENDING: "pendiente",
  SENT: "enviada",
  EXECUTED: "ejecutada",
  FAILED: "fallida",
};


// =========================================================
// IDIOMAS
// =========================================================

export const LANGUAGES = {
  ES: "es",
  EN: "en",
};


// =========================================================
// OPCIONES DE IDIOMA
// =========================================================

export const LANGUAGE_OPTIONS = [
  {
    value: LANGUAGES.ES,
    label: "Español",
  },
  {
    value: LANGUAGES.EN,
    label: "English",
  },
];


// =========================================================
// FORMATOS DE FECHA
// =========================================================

export const DATE_FORMATS = {
  DATE: "DD/MM/YYYY",
  TIME: "HH:mm",
  DATE_TIME: "DD/MM/YYYY HH:mm",
};


// =========================================================
// INTERVALOS DEL SISTEMA
// =========================================================

export const SYSTEM_INTERVALS = {
  /*
   * Intervalo máximo esperado para recibir
   * una nueva medición.
   */
  MEASUREMENT_MAX_SECONDS: 10,

  /*
   * Tiempo máximo sin comunicación antes
   * de considerar pérdida de conexión.
   */
  COMMUNICATION_TIMEOUT_SECONDS: 30,
};


// =========================================================
// HISTÓRICOS
// =========================================================

export const HISTORY_PERIODS = {
  TODAY: "hoy",
  LAST_24_HOURS: "24h",
  LAST_7_DAYS: "7d",
  LAST_30_DAYS: "30d",
  CUSTOM: "personalizado",
};


// =========================================================
// OPCIONES PARA HISTÓRICOS
// =========================================================

export const HISTORY_PERIOD_OPTIONS = [
  {
    value: HISTORY_PERIODS.TODAY,
    label: "Hoy",
  },
  {
    value: HISTORY_PERIODS.LAST_24_HOURS,
    label: "Últimas 24 horas",
  },
  {
    value: HISTORY_PERIODS.LAST_7_DAYS,
    label: "Últimos 7 días",
  },
  {
    value: HISTORY_PERIODS.LAST_30_DAYS,
    label: "Últimos 30 días",
  },
  {
    value: HISTORY_PERIODS.CUSTOM,
    label: "Personalizado",
  },
];


// =========================================================
// ESTADÍSTICAS
// =========================================================

export const STATISTIC_TYPES = {
  AVERAGE: "promedio",
  MINIMUM: "minimo",
  MAXIMUM: "maximo",
  DEVIATION: "desviacion",
};


// =========================================================
// EXPORTACIÓN
// =========================================================

export const EXPORT_FORMATS = {
  CSV: "csv",
  PDF: "pdf",
};


// =========================================================
// OPCIONES DE EXPORTACIÓN
// =========================================================

export const EXPORT_OPTIONS = [
  {
    value: EXPORT_FORMATS.CSV,
    label: "CSV",
  },
  {
    value: EXPORT_FORMATS.PDF,
    label: "PDF",
  },
];


// =========================================================
// PAGINACIÓN
// =========================================================

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 10,

  PAGE_SIZE_OPTIONS: [
    10,
    20,
    50,
    100,
  ],
};


// =========================================================
// FIRESTORE - COLECCIONES
// =========================================================

export const COLLECTIONS = {
  USERS: "usuarios",

  INCUBATORS: "incubadoras",

  DEVICES: "dispositivos",

  MEASUREMENTS: "mediciones",

  THRESHOLDS: "umbrales",

  ALERTS: "alertas",

  FANS: "ventiladores",

  AUTOMATION_RULES: "reglas_automatizacion",

  FAN_COMMANDS: "ordenes_ventilador",

  DAILY_STATISTICS: "estadisticas_diarias",

  AUDIT: "auditoria",

  SYSTEM_CONFIG: "config_sistema",
};


// =========================================================
// PERMISOS
// =========================================================

export const PERMISSIONS = {
  // Dashboard
  VIEW_DASHBOARD: "ver_dashboard",

  // Incubadoras
  VIEW_INCUBATORS: "ver_incubadoras",
  MANAGE_INCUBATORS: "gestionar_incubadoras",

  // Dispositivos
  VIEW_DEVICES: "ver_dispositivos",
  MANAGE_DEVICES: "gestionar_dispositivos",

  // Mediciones
  VIEW_MEASUREMENTS: "ver_mediciones",

  // Históricos
  VIEW_HISTORY: "ver_historicos",

  // Estadísticas
  VIEW_STATISTICS: "ver_estadisticas",

  // Alertas
  VIEW_ALERTS: "ver_alertas",
  MANAGE_ALERTS: "gestionar_alertas",

  // Ventiladores
  VIEW_FANS: "ver_ventiladores",
  CONTROL_FANS: "controlar_ventiladores",

  // Automatización
  MANAGE_AUTOMATION: "gestionar_automatizacion",

  // Usuarios
  MANAGE_USERS: "gestionar_usuarios",

  // Auditoría
  VIEW_AUDIT: "ver_auditoria",

  // Configuración
  MANAGE_SETTINGS: "gestionar_configuracion",

  // Umbrales
  MANAGE_THRESHOLDS: "gestionar_umbrales",
};


// =========================================================
// PERMISOS POR ROL
// =========================================================

export const ROLE_PERMISSIONS = {

  [ROLES.ADMIN]: [
    PERMISSIONS.VIEW_DASHBOARD,

    PERMISSIONS.VIEW_INCUBATORS,
    PERMISSIONS.MANAGE_INCUBATORS,

    PERMISSIONS.VIEW_DEVICES,
    PERMISSIONS.MANAGE_DEVICES,

    PERMISSIONS.VIEW_MEASUREMENTS,

    PERMISSIONS.VIEW_HISTORY,
    PERMISSIONS.VIEW_STATISTICS,

    PERMISSIONS.VIEW_ALERTS,
    PERMISSIONS.MANAGE_ALERTS,

    PERMISSIONS.VIEW_FANS,
    PERMISSIONS.CONTROL_FANS,

    PERMISSIONS.MANAGE_AUTOMATION,

    PERMISSIONS.MANAGE_USERS,

    PERMISSIONS.VIEW_AUDIT,

    PERMISSIONS.MANAGE_SETTINGS,
    PERMISSIONS.MANAGE_THRESHOLDS,
  ],


  [ROLES.OPERATOR]: [
    PERMISSIONS.VIEW_DASHBOARD,

    PERMISSIONS.VIEW_INCUBATORS,

    PERMISSIONS.VIEW_DEVICES,

    PERMISSIONS.VIEW_MEASUREMENTS,

    PERMISSIONS.VIEW_HISTORY,
    PERMISSIONS.VIEW_STATISTICS,

    PERMISSIONS.VIEW_ALERTS,

    PERMISSIONS.VIEW_FANS,
  ],


  [ROLES.VIEWER]: [
    PERMISSIONS.VIEW_DASHBOARD,

    PERMISSIONS.VIEW_INCUBATORS,

    PERMISSIONS.VIEW_MEASUREMENTS,

    PERMISSIONS.VIEW_HISTORY,
    PERMISSIONS.VIEW_STATISTICS,
  ],
};


// =========================================================
// CONFIGURACIÓN DE NAVEGACIÓN
// =========================================================

export const NAVIGATION_ITEMS = [

  {
    label: "Panel general",
    path: ROUTES.DASHBOARD,
    permission: PERMISSIONS.VIEW_DASHBOARD,
  },

  {
    label: "Incubadoras",
    path: ROUTES.INCUBATORS,
    permission: PERMISSIONS.VIEW_INCUBATORS,
  },

  {
    label: "Dispositivos",
    path: ROUTES.DEVICES,
    permission: PERMISSIONS.VIEW_DEVICES,
  },

  {
    label: "Históricos",
    path: ROUTES.HISTORY,
    permission: PERMISSIONS.VIEW_HISTORY,
  },

  {
    label: "Estadísticas",
    path: ROUTES.STATISTICS,
    permission: PERMISSIONS.VIEW_STATISTICS,
  },

  {
    label: "Alertas",
    path: ROUTES.ALERTS,
    permission: PERMISSIONS.VIEW_ALERTS,
  },

  {
    label: "Ventiladores",
    path: ROUTES.FANS,
    permission: PERMISSIONS.VIEW_FANS,
  },

  {
    label: "Usuarios",
    path: ROUTES.USERS,
    permission: PERMISSIONS.MANAGE_USERS,
  },

  {
    label: "Auditoría",
    path: ROUTES.AUDIT,
    permission: PERMISSIONS.VIEW_AUDIT,
  },

  {
    label: "Configuración",
    path: ROUTES.SETTINGS,
    permission: PERMISSIONS.MANAGE_SETTINGS,
  },
];


// =========================================================
// MENSAJES GENERALES
// =========================================================

export const MESSAGES = {
  LOADING: "Cargando...",

  SAVING: "Guardando...",

  NO_DATA: "No hay datos disponibles.",

  UNAUTHORIZED:
    "No tienes permisos para acceder a esta sección.",

  GENERIC_ERROR:
    "Ocurrió un error. Inténtalo nuevamente.",

  CONNECTION_ERROR:
    "No fue posible establecer conexión.",

  SAVE_SUCCESS:
    "La información se guardó correctamente.",

  DELETE_SUCCESS:
    "El registro se eliminó correctamente.",
};


// =========================================================
// VALIDACIONES
// =========================================================

export const VALIDATION = {
  PASSWORD_MIN_LENGTH: 8,

  NAME_MIN_LENGTH: 2,
  NAME_MAX_LENGTH: 100,

  DESCRIPTION_MAX_LENGTH: 500,
};


// =========================================================
// LOCAL STORAGE
// =========================================================

export const STORAGE_KEYS = {
  LANGUAGE: "mtpa_language",
  SELECTED_INCUBATOR: "mtpa_selected_incubator",
  SIDEBAR_COLLAPSED: "mtpa_sidebar_collapsed",
};


// =========================================================
// COLORES LÓGICOS PARA GRÁFICAS
// =========================================================

/*
 * Estos valores deben mantenerse sincronizados
 * conceptualmente con variables.css.
 *
 * Se necesitan en JavaScript porque librerías de gráficas
 * como Chart.js o Recharts pueden requerir el color como
 * propiedad JS y no siempre como clase CSS.
 */

export const CHART_COLORS = {
  TEMPERATURE: "#159447",
  HUMIDITY: "#2584d8",

  SUCCESS: "#0b8f43",
  WARNING: "#f4a51c",
  DANGER: "#e5484d",

  GRID: "#e8ecea",
};


// =========================================================
// CONFIGURACIÓN DE GRÁFICAS
// =========================================================

export const CHART_CONFIG = {
  TEMPERATURE_DECIMALS: 1,
  HUMIDITY_DECIMALS: 1,

  DEFAULT_HEIGHT: 300,

  MAX_POINTS: 100,
};


// =========================================================
// RETENCIÓN DE INFORMACIÓN
// =========================================================

export const DATA_RETENTION = {
  HISTORY_MONTHS: 12,
};


// =========================================================
// ORDENAMIENTO
// =========================================================

export const SORT_DIRECTION = {
  ASC: "asc",
  DESC: "desc",
};


// =========================================================
// CAMPOS COMUNES
// =========================================================

export const COMMON_FIELDS = {
  CREATED_AT: "creadoEn",
  UPDATED_AT: "actualizadoEn",
  CREATED_BY: "creadoPor",
  UPDATED_BY: "actualizadoPor",
};