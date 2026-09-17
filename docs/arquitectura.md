# Arquitectura — M.T.P.A. (Mejora Técnica de Producción Avícola)

Este documento describe la arquitectura de software definida para el proyecto,
en línea con el DDS v1.0, y sirve de referencia para las decisiones tomadas
durante el Sprint 0/1 (inicialización de Firebase y autenticación).

## Visión general

M.T.P.A. es una aplicación web de monitoreo IoT de incubadoras avícolas
(temperatura, humedad, alertas y control de ventiladores). Está compuesta por
tres partes:

1. **Cliente web** (`frontend/`): React + Vite, consumido por los usuarios
   finales (administrador, operador, consulta).
2. **Backend como servicio** (Firebase): Authentication, Firestore y Cloud
   Functions. Concentra la lógica de negocio y el control de acceso.
3. **Servicio de Integración IoT** (Node.js, Sprint 2): puente entre el
   broker MQTT y Firebase. No forma parte del alcance de este sprint y no
   debe modificarse desde este cambio.

## Capas del cliente (patrón MVC + Repository)

El cliente sigue una variante del patrón MVC adaptada a React, con una capa
adicional de Repository para aislar el acceso a datos:

- **Vista** (`frontend/src/components/`, `frontend/src/pages/`): componentes
  y páginas de React. Son responsables únicamente de renderizar UI y capturar
  eventos del usuario. No contienen lógica de acceso a datos ni reglas de
  negocio.
- **Controlador** (`frontend/src/hooks/`, `frontend/src/router/`): hooks
  (por ejemplo `useAuth`) y el enrutador (`AppRoutes.jsx`,
  `ProtectedRoute.jsx`, `RoleRoute.jsx`) orquestan el flujo entre la Vista y
  el Repository: deciden qué datos pedir, a qué ruta redirigir y qué
  permisos evaluar.
- **Repository** (`frontend/src/repositories/*`): única capa autorizada a
  hablar con Firebase (Authentication, Firestore, Cloud Functions callables)
  desde el cliente. Cada repositorio expone funciones puras orientadas al
  dominio (`authRepository`, `usuariosRepository`, etc.), ocultando los
  detalles del SDK de Firebase al resto de la aplicación.

## Backend (Firebase)

- **Authentication**: gestiona identidad y sesión. El rol del usuario se
  distribuye como *custom claim* (`role`) en el token, para que tanto las
  reglas de Firestore como las Cloud Functions puedan validarlo sin una
  consulta adicional.
- **Firestore**: almacena el estado persistente del dominio (usuarios,
  incubadoras, dispositivos, mediciones, alertas, etc.). El acceso está
  gobernado por `firestore.rules`.
- **Cloud Functions** (`functions/`): concentran la lógica de negocio que no
  debe ejecutarse en el cliente (por ejemplo, `gestionarUsuario`, que valida
  el rol de quien invoca, escribe en Firestore y asigna custom claims). El
  cliente nunca escribe directamente en colecciones sensibles como
  `usuarios`; siempre lo hace invocando una Cloud Function callable.

## Bootstrap del primer administrador

`gestionarUsuario` exige rol `administrador` incluso para crear un
usuario nuevo, por lo que la aplicación no puede crear por sí sola al
primer administrador de un proyecto de Firebase. Ese caso puntual se
resuelve con un script standalone (`functions/scripts/crear-primer-admin.js`,
que no se despliega como Cloud Function) documentado en
`docs/bootstrap-admin.md`.

## Servicio de Integración IoT (Sprint 2 — fuera de alcance)

Es un servicio Node.js independiente que:

- Se suscribe a los tópicos MQTT publicados por los dispositivos (ver
  `docs/contrato-mqtt.md`).
- Traduce esas mediciones/eventos en escrituras a Firestore y, cuando
  corresponde, en la creación de alertas.
- Es el único componente autorizado a publicar comandos MQTT hacia los
  ventiladores, siempre a partir de una orden validada por una Cloud
  Function.

## Principio arquitectónico central

> El cliente (frontend) **nunca** habla directamente con el broker MQTT, y
> **nunca** escribe alertas, estados de dispositivos o cambios de rol de
> usuario directamente en Firestore. Toda escritura sensible pasa por una
> Cloud Function, que es quien valida permisos y aplica las reglas de
> negocio antes de persistir el cambio.

Esto mantiene una única fuente de verdad para las reglas de negocio (las
Cloud Functions), evita que un cliente comprometido o con un rol incorrecto
pueda alterar el estado del sistema, y permite que las reglas de Firestore
(`firestore.rules`) sean simples: solo necesitan validar identidad y rol,
no reglas de negocio complejas.

## Roles del sistema

| Rol             | Descripción                                                        |
| --------------- | ------------------------------------------------------------------- |
| `administrador` | Acceso completo, incluida la gestión de usuarios.                   |
| `operador`      | Opera incubadoras y ventiladores, sin gestionar usuarios.            |
| `consulta`      | Acceso de solo lectura a paneles, históricos y estadísticas.         |

Los valores exactos de estos roles están centralizados en
`frontend/src/utils/constants.js` (`ROLES`) y se validan en el cliente con
`frontend/src/utils/permissions.js`. Del lado del servidor, se validan a
través del custom claim `role` del token de Firebase Authentication.
