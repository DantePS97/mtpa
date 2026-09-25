# Plan de pruebas — Gestión de incubadoras

Casos de prueba para el CRUD de incubadoras y el alta de dispositivos
implementado en el Sprint 2 (Cloud Function `gestionarIncubadora`,
`incubadorasRepository`, `dispositivosRepository` y las pantallas
`Incubadoras.jsx` / `IncubadoraDetalle.jsx` / `IncubadoraForm.jsx`).

Precondición general: existe en Firebase Authentication y en
`usuarios/{uid}` (Firestore) al menos un usuario `administrador` activo, y
al menos un usuario `operador` (o `consulta`) activo, ambos con su custom
claim `role` asignado correctamente (ver
`docs/pruebas/plan-pruebas-autenticacion.md`).

## 1. Alta de incubadora

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 1.1 | Loguear como `administrador`, ir a `ROUTES.INCUBATOR_CREATE` (`/incubadoras/nueva`) y enviar el formulario con nombre, ubicación y estado `"activa"`. | Se invoca `gestionarIncubadora({ accion: "crear", ... })`. Se crea el documento en `incubadoras/{id}` con `creadoEn` (server timestamp) y se navega a `ROUTES.INCUBATORS`. La nueva incubadora aparece en el listado. |
| 1.2 | Enviar el formulario de alta sin completar "nombre" o "ubicación". | `IncubadoraForm.jsx` valida antes de enviar (no depende solo del error del servidor) y muestra "El nombre es obligatorio." / "La ubicación es obligatoria." sin invocar la Cloud Function. |
| 1.3 | Invocar `gestionarIncubadora({ accion: "crear", nombre, ubicacion, estado: "critica" })` directamente (por ejemplo desde la consola/emulador), con un estado fuera de `"activa"`/`"inactiva"`. | La Cloud Function responde `invalid-argument`: "El estado ... no es válido...". No se crea el documento. |

## 2. Edición de incubadora

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 2.1 | Loguear como `administrador`, entrar al detalle de una incubadora existente y presionar "Editar". Modificar nombre/ubicación/estado y guardar. | Se invoca `gestionarIncubadora({ accion: "editar", id, ... })`. El documento `incubadoras/{id}` se actualiza (`set` con `merge: true`) y se navega a `ROUTES.INCUBATORS` reflejando los cambios. |
| 2.2 | Invocar `gestionarIncubadora({ accion: "editar", id: "id-inexistente", nombre: "x" })`. | La Cloud Function responde `not-found`: "La incubadora no existe." (se valida existencia antes de escribir, igual que `gestionarUsuario`). |
| 2.3 | Invocar `gestionarIncubadora({ accion: "editar", id })` sin ningún campo adicional. | Responde `invalid-argument`: "No se recibió ningún campo para editar." |

## 3. Baja (desactivación) de incubadora

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 3.1 | Como `administrador`, invocar `gestionarIncubadora({ accion: "desactivar", id })` sobre una incubadora existente. | El documento `incubadoras/{id}` queda con `estado: "inactiva"`. La lista y el badge de estado en `Incubadoras.jsx`/`IncubadoraDetalle.jsx` reflejan "Inactiva". |
| 3.2 | Invocar `gestionarIncubadora({ accion: "desactivar", id: "id-inexistente" })`. | Responde `not-found`: "La incubadora no existe." |

## 4. Alta de dispositivo con credencial MQTT única

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 4.1 | Como `administrador`, en `IncubadoraForm.jsx` (modo edición) elegir un tipo (`sensor_temperatura`, `sensor_humedad` o `ventilador`) y presionar "+ Agregar dispositivo". | Se invoca `gestionarIncubadora({ accion: "crear_dispositivo", incubadoraId, tipo })`. Se crea un documento en `dispositivos/{id}` con `identificadorMqtt` generado por el servidor, `estadoConexion: "desconocido"` y `ultimaComunicacionEn: null`. El identificador se muestra en pantalla y el dispositivo aparece en la lista. |
| 4.2 | Repetir el alta varias veces (incluso para incubadoras distintas) y comparar los `identificadorMqtt` generados. | Todos los `identificadorMqtt` son distintos entre sí; ninguno se repite entre dispositivos de la misma incubadora ni de incubadoras distintas (requisito de seguridad del DDS: ver `generarIdentificadorMqttUnico` en `functions/index.js`, que además verifica unicidad contra Firestore antes de escribir). |
| 4.3 | Invocar `gestionarIncubadora({ accion: "crear_dispositivo", incubadoraId: "id-inexistente", tipo: "ventilador" })`. | Responde `not-found`: "La incubadora indicada no existe." No se crea el dispositivo (evita dispositivos huérfanos). |
| 4.4 | Invocar `gestionarIncubadora({ accion: "crear_dispositivo", incubadoraId, tipo: "controlador" })` (tipo no soportado por esta acción). | Responde `invalid-argument`: "El tipo ... no es válido...". |

## 5. Un usuario no administrador recibe `permission-denied`

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 5.1 | Loguear como `operador` (o `consulta`) e invocar `gestionarIncubadora({ accion: "crear", nombre, ubicacion })`. | La Cloud Function responde `permission-denied`: "Solo un administrador puede gestionar incubadoras." (helper `requireRole`, mismo patrón que `gestionarUsuario`). No se crea el documento. |
| 5.2 | Ídem con `accion: "editar"`, `"desactivar"` o `"crear_dispositivo"`. | Igual que 5.1 en los cuatro casos: `permission-denied` antes de validar cualquier otro campo. |
| 5.3 | Como `operador`/`consulta`, con un `setDoc`/`updateDoc` directo (sin pasar por la Cloud Function) sobre `incubadoras/{id}` o `dispositivos/{id}` contra el emulador de Firestore. | Rechazado por `firestore.rules` (`allow write: if isAdmin();`). |
| 5.4 | Como `operador`/`consulta`/`administrador`, leer directamente `incubadoras/{id}` o `dispositivos/{id}` (sin pasar por la Cloud Function). | Permitido: `allow read: if request.auth != null;` habilita lectura a cualquier usuario autenticado, cualquiera sea su rol. |
| 5.5 | Sin sesión iniciada (`request.auth == null`), intentar leer o escribir `incubadoras/{id}` o `dispositivos/{id}`. | Rechazado tanto en lectura como en escritura. |

## Notas

- Los casos de las secciones 4 y 5 (puntos 5.3 a 5.5) requieren el
  emulador de Firestore (`firebase emulators:start`); no se ejecutaron
  contra un proyecto real de Firebase en este cambio.
- El caso 4.2 (unicidad del `identificadorMqtt`) es puramente funcional en
  este plan: la garantía real la da el servidor (UUID v4 + verificación
  contra Firestore), no el cliente.
