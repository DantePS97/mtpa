# Plan de pruebas — Módulo de autenticación

Casos de prueba para el flujo de login, sesión y control de acceso por rol
implementado en el Sprint 0/1 (Firebase Authentication + Firestore).

Precondición general: existen en Firebase Authentication y en
`usuarios/{uid}` (Firestore) al menos un usuario por cada rol
(`administrador`, `operador`, `consulta`), cada uno con `activo: true` y su
custom claim `role` asignado correctamente.

## 1. Login exitoso por cada rol

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 1.1 | Ingresar a `/login` con correo/contraseña de un usuario `administrador` activo. | Redirige a `ROUTES.DASHBOARD` (`/dashboard`). `useAuth()` expone `rol: "administrador"`. |
| 1.2 | Ídem con un usuario `operador` activo. | Redirige a `/dashboard`. `useAuth()` expone `rol: "operador"`. |
| 1.3 | Ídem con un usuario `consulta` activo. | Redirige a `/dashboard`. `useAuth()` expone `rol: "consulta"`. |

## 2. Login con credenciales inválidas

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 2.1 | Ingresar un correo no registrado en Firebase Authentication. | Se muestra "Correo o contraseña incorrectos.". No navega. |
| 2.2 | Ingresar un correo válido con contraseña incorrecta. | Se muestra "Correo o contraseña incorrectos.". No navega. |
| 2.3 | Enviar el formulario con campos vacíos. | El navegador bloquea el envío por los atributos `required` de los inputs; no se invoca `authRepository.login`. |

## 3. Usuario desactivado no puede entrar

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 3.1 | Loguear con credenciales válidas de un usuario cuyo documento `usuarios/{uid}` tiene `activo: false`. | El login de Firebase Authentication es exitoso, pero `Login.jsx` detecta `activo === false`, muestra "El usuario está desactivado..." y cierra la sesión (`authRepository.logout()`) sin redirigir al dashboard. |

## 4. Usuario sin rol válido

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 4.1 | Loguear con un usuario autenticado en Firebase pero sin documento en `usuarios/{uid}` (o con `rol` vacío/desconocido). | `Login.jsx` detecta que `isValidRole(usuario?.rol)` es `false`, muestra "El usuario no tiene un rol válido." y cierra la sesión sin redirigir. |

## 5. Acceso a `/usuarios` bloqueado para operador/consulta

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 5.1 | Loguear como `operador` y navegar manualmente a `/usuarios`. | `RoleRoute` (roles: `["administrador"]`) evalúa `canAccessRoute` y redirige a `ROUTES.UNAUTHORIZED` (`/sin-autorizacion`). |
| 5.2 | Loguear como `consulta` y navegar manualmente a `/usuarios`. | Igual que 5.1: redirige a `/sin-autorizacion`. |
| 5.3 | Loguear como `administrador` y navegar a `/usuarios`. | Se renderiza `Usuarios.jsx` normalmente (acceso permitido). |
| 5.4 | Sin sesión iniciada, navegar directamente a `/usuarios`. | `ProtectedRoute` redirige primero a `ROUTES.LOGIN` (`/login`), antes de evaluar el rol. |

## 6. Las reglas de Firestore rechazan escritura directa a `usuarios`

Estos casos se ejecutan preferentemente con el emulador de Firestore
(`firebase emulators:start`) y `@firebase/rules-unit-testing`, sin pasar por
la Cloud Function.

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 6.1 | Con un usuario autenticado de rol `operador`, intentar `setDoc`/`updateDoc` directo sobre `usuarios/{cualquierUid}` (incluyendo su propio documento). | La operación es rechazada por `firestore.rules` (`allow write` exige `role == "administrador"`). |
| 6.2 | Con un usuario autenticado de rol `administrador`, intentar `setDoc` directo (sin pasar por la Cloud Function) sobre `usuarios/{uid}`. | La regla de Firestore permite la escritura (porque valida solo el rol, no el canal), pero esto confirma que la única forma *soportada* de escribir usuarios en la aplicación real es `usuariosRepository.gestionarUsuario`, ya que el cliente nunca invoca `setDoc` sobre esta colección directamente (ver `docs/arquitectura.md`). |
| 6.3 | Sin autenticación (`request.auth == null`), intentar leer o escribir cualquier documento de `usuarios`. | Rechazado tanto en lectura como en escritura. |
| 6.4 | Un usuario autenticado intenta leer el documento `usuarios/{uid}` de **otro** usuario, sin ser administrador. | Rechazado en lectura (`request.auth.uid == uid` es falso y el rol no es `administrador`). |
| 6.5 | Intentar leer/escribir un documento de una colección no contemplada (por ejemplo, `configuracion/global`). | Rechazado por la regla de fallback (`match /{document=**} { allow read, write: if false; }`). |

## Notas

- Los casos de la sección 6 requieren el emulador de Firestore; no se
  ejecutaron contra un proyecto real de Firebase en este cambio (ver
  limitaciones documentadas en el resumen de la memoria del proyecto).
- Los casos 1 a 5 pueden automatizarse a futuro con un framework de
  pruebas end-to-end (por ejemplo Playwright o Cypress) una vez que el
  proyecto cuente con un entorno de Firebase de pruebas ("mtpa-dev").
