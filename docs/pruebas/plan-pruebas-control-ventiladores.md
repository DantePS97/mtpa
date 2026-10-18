# Plan de pruebas — Control manual de ventiladores (CU-03)

Casos de prueba de extremo a extremo para el **control manual de ventiladores**
del Sprint 4 (RF-012 y RF-013, caso de uso **CU-03** del ERS): encender y
apagar un ventilador desde el panel `/ventiladores`, ver el estado del
ventilador y el avance de cada orden sin recargar, y comprobar quién puede (y
quién no) enviar comandos. Se usa el simulador de dispositivo
(`iot-integration-service/simulator/simulador.js`) en lugar de hardware real.

El flujo cubierto es:

```
panel /ventiladores (administrador u operador)
  -> enviarComandoVentilador (Cloud Function callable)
  -> ordenes_ventilador/{id}: estado "pendiente", origen "manual", solicitadoPor <uid>
  -> Servicio de Integración IoT: pendiente -> enviando -> enviada (enviadaEn)
       -> comando MQTT <prefijo>/<incubadoraId>/ventiladores/<dispositivoId>/comando
          { accion, ordenId, solicitadoEn }
  -> simulador (o ventilador real) -> .../estado { encendido: true | false }
  -> Servicio: ventiladores/{id}.estadoActual + orden "ejecutada" (ejecutadaEn)
  -> panel: chip de estado y "Última orden", en tiempo real y sin recargar
Desenlaces alternativos de una orden:
  "fallida"  (el dispositivo no confirma en 30 s, o no se pudo publicar)
  "expirada" (seguía "pendiente" pasados 60 s cuando el servicio la reclamó)
Modo de control (manual / automático / mixto):
  /ventiladores/automatizacion (solo administrador) -> guardarReglaAutomatizacion
```

> **Estado de este plan: ejecutado en local el 2026-10-18 (53 casos: 52 Pasó,
> 1 Parcial, 0 Falló). Pendiente de repetir contra Firebase y HiveMQ Cloud
> reales.**
>
> Se ejecutó contra `origin/main` en el commit `0ec7866`, en un entorno
> **local**: emuladores de Firebase (Auth, Firestore y Functions, proyecto
> `demo-mtpa`), un broker MQTT local (aedes con TLS autofirmado), y el Servicio
> de Integración, el simulador y la interfaz (servidor de desarrollo de Vite,
> en un navegador) del repositorio. Cómo se montó el entorno:
> `docs/pruebas/ejecucion-local-emuladores.md`. Los resultados y la evidencia
> de cada caso están en la sección 11.
>
> Qué **no** cubre esta ejecución:
>
> - **Firebase real.** Auth, Firestore y Cloud Functions se probaron solo en
>   sus emuladores. Las reglas de Firestore (CV-51) son las del repositorio,
>   pero evaluadas por el emulador.
> - **HiveMQ Cloud y hardware real.** El broker fue uno local, y el ventilador
>   fue siempre el simulador o un cliente MQTT manual.
> - **Índices compuestos.** El emulador de Firestore no exige índices, así que
>   el despliegue de `firestore.indexes.json` (el índice de
>   `ordenes_ventilador` que usan el panel y el servicio) no quedó validado.
> - **Compilación de producción.** El frontend se ejecutó con el servidor de
>   desarrollo y un parche local no versionado para conectarlo a los
>   emuladores; no se hizo `build`.
> - **CV-32, parcial.** Se verificó la estructura y la variante de estilo de
>   cada estado de la orden, pero no se evaluó con rigor el contraste visual
>   de los colores.
>
> Los resultados de este plan valen entonces para el comportamiento del código
> en un entorno local, no como aceptación del despliegue real.

Los resultados esperados salen del código de las ramas listadas en 0.1, no de
las descripciones de las tarjetas de Notion. Los textos entre comillas son los
literales de la interfaz y de las Cloud Functions.

## 0. Prerrequisitos

### 0.1 Código bajo prueba

Todo el Sprint 4 de control de ventiladores, o `main` una vez integrado:

- Documento del ventilador y script de migración (PR #30, ya en `main`):
  `crearDispositivo` crea `ventiladores/{id}` junto con el dispositivo y
  `functions/scripts/crear-documentos-ventiladores.js` migra los ya
  registrados.
- Cloud Functions `enviarComandoVentilador` y `guardarReglaAutomatizacion`
  (rama `feat/sprint-4-iot-confirmar-estado`, que contiene los commits de
  `functions/` apilados).
- Servicio de Integración con la confirmación del estado del ventilador, el
  barrido de órdenes sin confirmar y la escritura de `enviada` antes de
  publicar (misma rama, `iot-integration-service/index.js`). Sin este cambio
  ninguna orden llega a `ejecutada`.
- Panel de ventiladores, formulario de reglas y rutas con sus permisos (rama
  `feat/sprint-4-rutas-permisos-ventiladores`).

### 0.2 Firebase

Orden de despliegue (el orden importa):

1. Desplegar las Cloud Functions, `firestore.rules` y `firestore.indexes.json`.
2. **Una vez por entorno**, crear los documentos de los ventiladores ya
   registrados (caso CV-04 a CV-08). Si el script se corriera antes de
   desplegar las funciones, un ventilador dado de alta entre ambos pasos
   quedaría sin documento.
3. Arrancar el Servicio de Integración y el simulador (0.4).
4. Levantar el frontend (0.5).

| Elemento | Qué debe estar listo |
| -------- | -------------------- |
| Cloud Functions | Desplegadas `crearDispositivo` (con la creación de `ventiladores/{id}`), `enviarComandoVentilador`, `guardarReglaAutomatizacion` y `procesarMedicion`. En este plan **ninguna regla de automatización puede generar órdenes**: las órdenes automáticas mezclarían su efecto con el de las manuales. Las reglas que se guardan aquí usan umbral 60 y margen 30 (banda de 30 a 60 °C): la temperatura simulada, entre 35 y 40 °C, queda dentro de la banda y nunca dispara nada. No debe haber otras reglas activas en `reglas_automatizacion`. |
| `INTEGRATION_SERVICE_TOKEN` | Configurado en las Cloud Functions y con el mismo valor que `PROCESAR_MEDICION_TOKEN` del Servicio de Integración. |
| Reglas | `firestore.rules` desplegadas: `ventiladores`, `reglas_automatizacion` y `ordenes_ventilador` son de lectura para cualquier usuario autenticado y **sin escritura** desde el cliente (`allow write: if false;`, y en órdenes `allow create, update, delete: if false;`). |
| Índices | `firestore.indexes.json` desplegado: el índice de `ordenes_ventilador` (`ventiladorId` ascendente + `creadaEn` descendente) lo usan el panel y el servicio. Sin él el panel muestra "No fue posible cargar las órdenes del ventilador.". |
| Usuarios | Un `administrador`, un `operador` y un usuario de `consulta`, activos y con su custom claim `role` correcto (ver `docs/pruebas/plan-pruebas-autenticacion.md` y `docs/bootstrap-admin.md`). |

### 0.3 Datos de prueba

1. Como `administrador`, crear una incubadora activa (`/incubadoras/nueva`,
   "+ Nueva incubadora") y, en su edición (`/incubadoras/<id>/editar`), dar de
   alta con "+ Agregar dispositivo": un `sensor_temperatura` y **dos**
   dispositivos `ventilador`. Anotar el **id del documento** de cada uno en
   `dispositivos/` (no el `identificadorMqtt`).
2. Los dos ventiladores cumplen papeles distintos:
   - **VS, ventilador simulado**: su id es el que se pasa al simulador como
     `SIMULADOR_VENTILADOR_ID`. Responde a los comandos.
   - **VN, ventilador sin respuesta**: nadie contesta a sus comandos, así que
     sus órdenes quedan `enviada` y terminan `fallida`. Nunca recibe estado
     (se mantiene "Desconocido").
3. Comprobar en Firestore que existen `ventiladores/<id de VS>` y
   `ventiladores/<id de VN>` (mismo id que el dispositivo): son los documentos
   que crea `crearDispositivo` (CV-01).
4. Para los casos de estado vacío y de ventilador sin documento (CV-04 a CV-09):
   una segunda incubadora activa **sin** ventiladores, y un tercer dispositivo
   `ventilador` descartable (VD) sobre el que se borra a mano el documento
   `ventiladores/<id de VD>` desde la consola de Firestore.

### 0.4 Servicio de Integración y simulador

Dentro de `iot-integration-service/` (una sola vez: `npm install`), con un
`.env` propio (no versionado) que define `MQTT_HOST`, `MQTT_PORT`,
`MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC_PREFIX` (por defecto `mtpa-dev`),
`PROCESAR_MEDICION_URL`, `PROCESAR_MEDICION_TOKEN` y
`GOOGLE_APPLICATION_CREDENTIALS` (ruta al JSON de la cuenta de servicio, fuera
del repositorio). Ver `docs/broker-mqtt.md`. Variables opcionales que afectan a
este plan, con los valores por defecto que suponen los casos:

| Variable | Defecto | Qué controla |
| -------- | ------- | ------------ |
| `ORDEN_MAX_ANTIGUEDAD_SEGUNDOS` | 60 | Una orden `pendiente` más vieja que esto se marca `expirada` al ser reclamada. |
| `ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS` | 30 | Una orden `enviada` sin confirmación pasa a `fallida`. El barrido corre cada 10 s, así que ocurre entre 30 y 40 s después de `enviadaEn`. |
| `LATIDO_*` | ver `plan-pruebas-monitoreo-alertas.md` | Detección de desconexión (genera alertas de desconexión al detener el simulador; no afecta a las órdenes). |

- Terminal 1, servicio: `npm start`. Esperado en el log:
  `[iot-integration-service] Conectado a <host>:<puerto>`, la suscripción a los
  tópicos de mediciones, estado de ventiladores y latidos, y
  `[iot-integration-service] Iniciando listener de ordenes_ventilador...`.
- Terminal 2, simulador, con los ids reales (PowerShell):

  ```powershell
  $env:SIMULADOR_INCUBADORA_ID = "<id de la incubadora>"
  $env:SIMULADOR_SENSOR_ID = "<id del dispositivo sensor>"
  $env:SIMULADOR_VENTILADOR_ID = "<id de VS>"
  npm run simulator
  ```

  (En bash: `SIMULADOR_INCUBADORA_ID=... SIMULADOR_SENSOR_ID=... SIMULADOR_VENTILADOR_ID=... npm run simulator`.)

Comportamiento del simulador a tener presente:

- Al conectarse publica el estado **apagado** de su ventilador, antes de que
  llegue ningún comando. Si `ventiladores/<id de VS>` existe, ese primer reporte
  lleva `estadoActual` de `null` a `"apagado"` sin ninguna orden de por medio.
  Por eso el estado "Desconocido" de un ventilador simulado solo se ve **antes**
  de arrancar el simulador (CV-02 y CV-03).
- No guarda su estado entre ejecuciones: cada vez que se reinicia vuelve a
  publicar "apagado", aunque Firestore dijera "encendido".
- Responde a cada comando `encender` o `apagar` publicando de inmediato su
  estado en `.../estado` (con `encendido` y `velocidad`); es idempotente: un
  comando repetido solo vuelve a publicar el mismo estado.
- Publica además una medición y los latidos cada 8 segundos.
- Detener el simulador (Ctrl+C) lo detiene entero: deja de responder a los
  comandos de VS **y** de publicar mediciones.

### 0.5 Frontend

En `frontend/` crear `.env` con `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` y
`VITE_FIREBASE_APP_ID`, y levantar la aplicación con `npm run dev`.

> **Navegación:** el layout de las páginas protegidas (`DashboardLayout`) monta
> el menú lateral (`Sidebar`), junto con el banner de alertas y el contenido de
> la ruta. Lo que ofrece cada rol: el `administrador`, Panel general,
> Incubadoras, Alertas, Límites de alerta, Ventiladores y Usuarios; el
> `operador`, Panel general, Incubadoras, Alertas y Ventiladores; la `consulta`,
> Panel general e Incubadoras. El panel es `/ventiladores`. **No hay ítem de
> menú para `/ventiladores/automatizacion`** (formulario de modo y reglas, solo
> administrador): se llega con el enlace "Configurar modo y automatización" de
> cada tarjeta del panel o escribiendo la URL.

### 0.6 Cómo provocar cada desenlace de una orden

| Se quiere ver | Cómo provocarlo | Tiempo de referencia |
| ------------- | --------------- | -------------------- |
| `ejecutada` | Servicio y simulador corriendo; enviar el comando a VS. | Pocos segundos. |
| `pendiente` prolongada | Detener el Servicio de Integración (Ctrl+C) y enviar el comando. La orden queda `pendiente` mientras el servicio no la reclame. | Hasta que se arranca el servicio. |
| `enviada` prolongada y luego `fallida` | Detener el simulador (Ctrl+C) y enviar el comando a VS, o enviarlo a VN con el simulador corriendo. | `enviada` unos 30 s; `fallida` entre 30 y 40 s después de `enviadaEn`. |
| `expirada` | Con el servicio detenido, enviar el comando, esperar **más de 60 s** y volver a arrancar el servicio: al reclamar la orden la ve vencida. | Más de 60 s con la orden `pendiente`. |
| "Atascada" (solo existe en el panel) | Orden `pendiente` o `enviada` que este navegador ve **sin cambios durante 120 s** (por ejemplo, servicio detenido). | 120 s, más hasta 5 s del reloj del panel. |
| `enviando` | Es transitoria (decenas de milisegundos): el panel la muestra, pero a simple vista no es fiable. Se observa con un observador de DOM o una grabación de pantalla; si no, se da por pasada cuando la orden termina en `enviada` con `enviadaEn` (CV-21). | ~25-50 ms. |

### 0.7 Cómo verificar en Firestore

| Qué | Dónde | Campos |
| --- | ----- | ------ |
| Ventilador | `ventiladores/<id>` | `incubadoraId`, `dispositivoId`, `modoControl` (`manual` / `automatico` / `mixto`), `estadoActual` (`null` / `encendido` / `apagado`), `actualizadoEn` (solo desde el primer reporte), `creadoEn`. |
| Órdenes | `ordenes_ventilador`, filtrando por `ventiladorId` y ordenando por `creadaEn` descendente | `ventiladorId`, `incubadoraId`, `dispositivoId`, `accionSolicitada` (`encender` / `apagar`), `origen` (`manual` / `automatico`), `estado`, `solicitadoPor` (uid, o `"sistema"`), `creadaEn`, `enviadaEn`, `ejecutadaEn`, `actualizadaEn`, `error`. |
| Regla | `reglas_automatizacion/<id del ventilador>` | `variable`, `umbralActivacion`, `margenHisteresis`, `activa`, `actualizadoEn`, `actualizadoPor`. |

### 0.8 Cómo invocar una Cloud Function callable directamente

Los casos de permisos y de datos inválidos (secciones 7 y 8) llaman a la
función sin pasar por la interfaz, porque la defensa real está en la función y
no en el botón. Dos formas:

- Contra el emulador de Functions (`firebase emulators:start`), con un cliente
  autenticado con el rol deseado.
- Contra el proyecto real, por HTTP: `POST
  https://<región>-<proyecto>.cloudfunctions.net/<nombre de la función>` con
  cabecera `Content-Type: application/json`, cuerpo `{"data": { ... }}` y, para
  simular una sesión, la cabecera `Authorization: Bearer <ID token>` del usuario
  de prueba (se obtiene con `getIdToken()` del SDK desde la consola del
  navegador con esa sesión abierta, o con el endpoint `accounts:signInWithPassword`
  de Identity Toolkit). Sin esa cabecera la llamada llega sin sesión. Un error se
  recibe como `{"error": {"message": "...", "status": "..."}}`; el `status`
  equivale al código del error (`PERMISSION_DENIED` es `permission-denied`,
  `UNAUTHENTICATED` es `unauthenticated`, etc.).

No pegar los ID tokens en la columna `Evidencia`: caducan, pero hay que
ocultarlos igual.

## 1. Estado inicial y documentos de ventilador

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-01 | `administrador` con la sesión iniciada; incubadora de 0.3. | En `/incubadoras/<id>/editar` pulsar "+ Agregar dispositivo" y crear un `ventilador` y un `sensor_temperatura`. Revisar `dispositivos/` y `ventiladores/` en Firestore. | Existe `ventiladores/<id>` con **el mismo id** que `dispositivos/<id>` del ventilador, con `incubadoraId` y `dispositivoId` correctos, `modoControl: "manual"`, `estadoActual: null` y `creadoEn`; **no** tiene `actualizadoEn`. El sensor no genera documento en `ventiladores`. |
| CV-02 | Ventilador recién creado, simulador **aún sin arrancar**. | Abrir `/ventiladores` como `administrador` y elegir la incubadora. | Aparece la tarjeta "Ventilador <8 primeros caracteres del id>..." con el chip **"Desconocido"** (nunca "Apagado"), "Modo de control: Manual", en "Última orden" el texto "Todavía no se envió ninguna orden." y los botones "Encender" y "Apagar" habilitados, sin texto de motivo debajo. |
| CV-03 | CV-02 hecho; `/ventiladores` abierto; VS y VN sin estado. | Arrancar el simulador (0.4) sin recargar la página. | El chip de VS pasa a **"Apagado"** sin recargar (el simulador publica su estado inicial). En Firestore `ventiladores/<id de VS>` tiene `estadoActual: "apagado"` y `actualizadoEn`. **No** se crea ninguna orden. En el log del servicio: `Ventilador <id de VS> actualizado a "apagado".`. VN sigue en "Desconocido". |
| CV-04 | VD con su documento `ventiladores/<id de VD>` borrado a mano (0.3, punto 4); credenciales de la cuenta de servicio configuradas como en `docs/bootstrap-admin.md`. | En `functions/`: `node scripts/crear-documentos-ventiladores.js --dry-run`. | Lo primero que imprime es `Proyecto de Firebase: <id>` (verificar que es el del entorno de prueba) y `Modo --dry-run: no se escribe nada en Firestore.`; después `[dry-run] Se crearía ventiladores/<id de VD> (incubadora <id>).` y el resumen (`Dispositivos ventilador encontrados`, `Se crearían: <n>` con VD entre ellos, `Ya existían`, `Omitidos`, `Errores: 0`). **No** se crea el documento en Firestore. |
| CV-05 | Igual que CV-04. | Ejecutar el script sin argumentos; con `--dryrun` (error de tipeo); y con `--dry-run --confirmar`. | En los tres casos termina con código de salida 2 y sin escribir nada: `Indicá exactamente uno: --dry-run (simula) o --confirmar (escribe).` en el primero y el tercero, y `Argumentos no reconocidos: --dryrun` más la línea de uso en el segundo. |
| CV-06 | VD sin documento (CV-04). Panel `/ventiladores` abierto como `administrador`. | (a) Mirar la incubadora de VD en el panel. (b) Invocar `enviarComandoVentilador` con `{ventiladorId: "<id de VD>", accionSolicitada: "encender"}` como `administrador` (0.8). | (a) VD **no aparece** en el panel (el panel lista los documentos de `ventiladores`): si era el único ventilador de la incubadora se ve "Sin ventiladores registrados". (b) La función responde `not-found`: "El ventilador solicitado no existe.". No se crea ninguna orden. |
| CV-07 | CV-04 hecho y su informe revisado. | Ejecutar `node scripts/crear-documentos-ventiladores.js --confirmar`. Recargar `/ventiladores`. | Imprime `Proyecto de Firebase: <id>` y el resumen con `Creados: <n>` (VD incluido) y `Errores: 0`; código de salida 0. Existe `ventiladores/<id de VD>` con `modoControl: "manual"`, `estadoActual: null`, `incubadoraId` y `dispositivoId` correctos. VD aparece en el panel con "Desconocido". |
| CV-08 | CV-07 hecho. | Repetir `--confirmar`. Luego repetir el comando de CV-06 (b). | El script es idempotente: `Creados: 0` y `Ya existían: <total>`; no sobrescribe documentos existentes (el `creadoEn` de VD no cambia). El comando de CV-06 (b) ahora **no** da `not-found`: responde `ok: true` y crea una orden (queda `fallida` a los ~35 s porque nadie contesta a VD). |
| CV-09 | Segunda incubadora activa sin ventiladores (0.3, punto 4). | En `/ventiladores`, elegir esa incubadora en el selector "Incubadora". | Aparece "Sin ventiladores registrados" con el texto "Esta incubadora no tiene ventiladores. Se crean al dar de alta un dispositivo de tipo ventilador.". No hay botones de control. |

## 2. Encender y apagar en modo manual

Todos los casos de esta sección parten de VS en modo `manual` (el modo con el
que nace), con el servicio y el simulador corriendo y `/ventiladores` abierto.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-10 | Sesión de `administrador`; VS en "Apagado". | Pulsar "Encender" en la tarjeta de VS. Observar sin recargar. | El botón muestra "Enviando..." mientras dura la llamada. La orden aparece en "Última orden" como "Encender · <fecha y hora>" y avanza hasta **"Ejecutada"** con el texto "El ventilador confirmó el cambio.". El chip de VS pasa a **"Encendido"**. En Firestore: `ventiladores/<id de VS>.estadoActual` es `"encendido"`; la orden tiene `origen: "manual"`, `accionSolicitada: "encender"`, `estado: "ejecutada"`, `solicitadoPor` igual al uid del administrador, `enviadaEn`, `ejecutadaEn`, `actualizadaEn` y sin `error`. En el log del servicio: `Orden <id> publicada en "<prefijo>/<incubadoraId>/ventiladores/<id de VS>/comando".`, `Ventilador <id de VS> actualizado a "encendido".` y `Orden <id> ejecutada (ventilador <id de VS> "encendido").`. En el simulador: `Estado de ventilador publicado en ...` con `"encendido":true`. |
| CV-11 | CV-10 hecho (VS "Encendido"). | Pulsar "Apagar". | Igual que CV-10 con `accionSolicitada: "apagar"`: la orden termina "Ejecutada", el chip pasa a **"Apagado"** y `estadoActual` es `"apagado"`. |
| CV-12 | Sesión de `operador`; VS en "Apagado". | Repetir CV-10 y CV-11 como `operador`. | Funciona igual que para el administrador. En las órdenes, `solicitadoPor` es el uid del **operador**, y `origen` sigue siendo `"manual"`. |
| CV-13 | VS en "Encendido". | Pulsar "Encender" otra vez. | No hay error: se crea una orden `encender` (el panel y la función no comparan con `estadoActual`), el simulador vuelve a publicar `encendido: true` y la orden termina "Ejecutada". El chip sigue "Encendido". |
| CV-14 | Cualquiera de las órdenes de CV-10 a CV-12. | Abrir el documento de la orden en `ordenes_ventilador`. | Tiene exactamente `ventiladorId` (el de VS), `incubadoraId` y `dispositivoId` copiados de `ventiladores/<id de VS>`, `accionSolicitada`, `origen: "manual"`, `estado`, `solicitadoPor`, `creadaEn`, y los que agrega el servicio (`enviadaEn`, `actualizadaEn` y, al ejecutarse, `ejecutadaEn`). La respuesta de la función incluye `ok: true`, `ordenId` y `mensaje: "Orden de ventilador creada correctamente."`. |

## 3. Modo mixto

El modo solo se cambia con `guardarReglaAutomatizacion`, desde el formulario de
`/ventiladores/automatizacion` (solo administrador). Para este plan la regla
usa siempre umbral 60 y margen 30 (ver 0.2), así que no se generan órdenes
automáticas; el comportamiento de la regla se prueba en
`docs/pruebas/plan-pruebas-automatizacion.md`.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-15 | `administrador`; VS en modo manual. | Desde la tarjeta de VS pulsar "Configurar modo y automatización" (llega con la incubadora y el ventilador ya elegidos). Elegir el modo "Mixto", variable "Temperatura", "Umbral de activación (°C)" 60, "Margen de histéresis (°C)" 30, **desmarcar** "Regla activa" y pulsar "Guardar". | Aparece "La configuración del ventilador se guardó correctamente." y el aviso "Con la regla inactiva, el ventilador solo responderá a los comandos manuales.". En Firestore: `ventiladores/<id de VS>.modoControl` es `"mixto"` y existe `reglas_automatizacion/<id de VS>` con `activa: false`, `variable: "temperatura"`, `umbralActivacion: 60`, `margenHisteresis: 30`, `actualizadoPor` igual al uid del administrador. En `/ventiladores` el modo cambia a "Mixto" sin recargar. |
| CV-16 | CV-15 hecho. | Como `administrador`, pulsar "Encender" y luego "Apagar" en VS. | Ambos comandos se aceptan y terminan "Ejecutada" (mismos resultados que CV-10 y CV-11). Con la regla inactiva no se crea ninguna orden con `origen: "automatico"`. |
| CV-17 | CV-15 hecho. | Repetir CV-16 como `operador`. | Igual que CV-16: el modo mixto admite comandos manuales de ambos roles. |

## 4. Modo automático

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-18 | `administrador`; VS en mixto (CV-15). | En el formulario cambiar el modo a "Automático" (el aviso "En modo automático los comandos manuales de este ventilador se rechazarán." aparece al elegirlo), dejar "Regla activa" **marcada** (con el umbral 60 y el margen 30 ya cargados, que no generan órdenes) y pulsar "Guardar". Volver a `/ventiladores`. | El modo se guarda (`modoControl: "automatico"`) y la regla queda `activa: true`. En la tarjeta de VS, los botones "Encender" y "Apagar" están **deshabilitados** y debajo aparece "El ventilador está en modo automático y no admite comandos manuales.". El cambio se ve sin recargar. |
| CV-19 | CV-18 hecho. | Invocar `enviarComandoVentilador` directamente (0.8) para VS con `accionSolicitada: "encender"`, como `administrador` y como `operador`. | En ambos casos la función responde `failed-precondition`: "El ventilador está configurado en modo automático y no admite comandos manuales.". No se crea ninguna orden en `ordenes_ventilador`. |
| CV-20 | CV-18 hecho; `/ventiladores` abierto en una pestaña. | Desde el formulario (otra pestaña) pasar VS a "Manual" y luego a "Mixto" (sin tocar la regla). | Los botones de la primera pestaña se habilitan **sin recargar** y el texto de motivo desaparece, en cada cambio. Con el modo "Manual", `reglas_automatizacion/<id de VS>` conserva la regla guardada (el formulario muestra "En modo manual la regla no se aplica y la guardada se conserva sin cambios."). |

## 5. Avance de la orden en el panel

Al terminar la sección 4, VS queda en modo mixto: las secciones 5 a 9 valen
igual en modo `manual` o `mixto`.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-21 | VS en modo manual o mixto, servicio y simulador corriendo. | Enviar "Encender" y mirar la tarjeta **sin recargar** ni tocar nada, sacando capturas rápidas (o grabando la pantalla). Revisar el documento de la orden y el log del servicio. | La orden recorre `pendiente` → `enviando` → `enviada` → `ejecutada`; en el panel se ve al menos el resultado final "Ejecutada" (las etapas intermedias duran decenas de milisegundos). `enviando` sí aparece en el panel (~25-50 ms, entre "Pendiente" y "Enviada"), pero solo se capta con un observador de DOM o una grabación de pantalla; si no se logra verla, se da por pasada porque la orden tiene `enviadaEn` y `actualizadaEn` y el log muestra la publicación y la ejecución. La pantalla no se recarga ni hay que pulsar nada para ver el cambio de la orden y del chip de estado. |
| CV-22 | Servicio **detenido** (Ctrl+C); simulador corriendo; VS en manual. | Enviar "Encender". Observar durante ~30 s sin recargar. | La orden queda en **"Pendiente"** con el texto "En cola, esperando su envío al ventilador." como distintivo de color informativo (no como bloque de error). Los botones "Encender" y "Apagar" quedan deshabilitados con el texto "Hay una orden en curso; espere a que termine para enviar otra.". En Firestore `estado: "pendiente"`, sin `enviadaEn`. Si se vuelve a arrancar el servicio antes de 60 s, la orden avanza sola a "Ejecutada" sin recargar. |
| CV-23 | Servicio corriendo; simulador **detenido**; VS en manual. | Enviar "Encender" a VS. Observar sin recargar durante ~30 s. | La orden pasa a **"Enviada"** ("Orden enviada; esperando la confirmación del ventilador."), también como distintivo informativo y no como error, con los botones deshabilitados ("Hay una orden en curso; espere a que termine para enviar otra."). En Firestore `estado: "enviada"` con `enviadaEn`; el log del servicio muestra `Orden <id> publicada en ...`. |
| CV-24 | VS en manual; servicio y simulador corriendo. | Pulsar "Encender" dos veces seguidas lo más rápido posible. | Se crea **una sola** orden en `ordenes_ventilador`: apenas se pulsa el primer clic los botones se deshabilitan (el pulsado muestra "Enviando..."). |
| CV-25 | Dos navegadores, uno con `administrador` y otro con `operador`, ambos en `/ventiladores`. | Enviar "Encender" a VN desde el primero (VN no responde, así que la orden queda en curso unos 30 s). Mirar el segundo. | En el segundo navegador la orden de VN aparece sola y sus botones se deshabilitan ("Hay una orden en curso; espere a que termine para enviar otra."), sin recargar. La orden en curso de un usuario bloquea a todos. |
| CV-26 | Orden de VN en curso (CV-25). | Esperar a que la orden termine y mirar ambos navegadores. | Al pasar a `fallida` (ver CV-28) los botones se rehabilitan en ambos sin recargar. La tarjeta de VS no se vio afectada: cada ventilador bloquea por separado. |

## 6. Orden fallida, expirada y atascada

Las órdenes terminadas con error se muestran en un **bloque aparte** (con la
etiqueta en negrita y el detalle), distinto del distintivo de color de las
órdenes en curso y de la "Ejecutada".

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-27 | Servicio corriendo; simulador **detenido** (o usar VN con el simulador corriendo); VS con un estado conocido. | Enviar "Encender" y esperar sin recargar. Anotar la hora de `enviadaEn`. | Pasa de "Enviada" a **"Fallida"** entre 30 y 40 s después de `enviadaEn`. El bloque muestra "Fallida" y "La orden no pudo completarse. Inténtalo nuevamente."; al dejar el puntero sobre él el `title` muestra el motivo "El dispositivo no confirmó el estado en 30 s.". En Firestore `estado: "fallida"` y `error: "El dispositivo no confirmó el estado en 30 s."`; el log del servicio muestra `Orden <id> fallida: El dispositivo no confirmó el estado en 30 s.`. `estadoActual` del ventilador **no cambia**. Los botones se rehabilitan. |
| CV-28 | Igual que CV-27, con el simulador corriendo. | Enviar "Encender" a VN. | VN termina "Fallida" como en CV-27, mientras que VS (si se le envía un comando) sigue llegando a "Ejecutada": una falla en un ventilador no afecta a los demás. |
| CV-29 | Servicio **detenido**; VS en manual. | Enviar "Encender" (queda "Pendiente"). Esperar **más de 60 s** y recién entonces arrancar el servicio (`npm start`). | El servicio la reclama al conectarse al broker y la encuentra vencida: pasa a **"Expirada"** con el bloque "Expirada" y el texto "La orden no se envió a tiempo y se descartó. Inténtalo nuevamente."; el `title` muestra "La orden venció: tiene <N> s y el máximo es 60 s." con N mayor que 60. En Firestore `estado: "expirada"` y ese mismo `error`. **No** se publica ningún comando (el simulador no loguea nada) y `estadoActual` no cambia. Los botones se rehabilitan. |
| CV-30 | Servicio detenido; simulador corriendo; VS en manual. | Enviar "Encender". Con el panel abierto y la orden sin cambios, mirar el estado a ~115 s y a ~125 s de la creación, sin recargar. | A ~115 s sigue "Pendiente" y los botones deshabilitados. A los 120 s sin cambios (el reloj del panel se evalúa cada 5 s, por lo que se ve entre 120 y 125 s) el bloque pasa a **"Atascada"** con "La orden sigue sin confirmarse. Verifique el ventilador antes de volver a intentarlo." y los botones **se rehabilitan**. En Firestore la orden sigue `pendiente`. |
| CV-31 | CV-30 hecho (orden atascada, servicio detenido). | Pulsar "Encender" de nuevo. Después arrancar el servicio. | La función crea una segunda orden (el bloqueo es solo del panel). Al arrancar el servicio, la primera (más de 60 s) pasa a `expirada` y la segunda, reciente, se publica y llega a `ejecutada`. El panel muestra la última orden: "Ejecutada". |
| CV-32 | Capturas de pantalla de CV-10, CV-22, CV-23, CV-27, CV-29 y CV-30. | Comparar visualmente "Pendiente", "Enviada", "Ejecutada", "Fallida", "Expirada" y "Atascada". | Las órdenes en curso se ven como distintivo de color informativo; "Ejecutada" como distintivo de éxito; "Fallida", "Expirada" y "Atascada" como bloque aparte (con variantes de peligro, advertencia y advertencia). Ninguna orden en curso se confunde con una fallida. |

## 7. Datos inválidos, ventilador inexistente y estados anómalos

Los casos CV-33 a CV-37 invocan las funciones directamente (0.8) como
`administrador`; CV-38 a CV-40 publican estados a mano en el broker (con el
cliente web de HiveMQ Cloud o `mosquitto_pub`, como en
`docs/pruebas/plan-pruebas-simulador.md`) y necesitan el servicio corriendo.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-33 | `administrador`. | `enviarComandoVentilador` con `{ventiladorId: "no-existe", accionSolicitada: "encender"}`. | `not-found`: "El ventilador solicitado no existe.". No se crea ninguna orden. |
| CV-34 | `administrador`. | `enviarComandoVentilador` sin `ventiladorId`, con `ventiladorId: ""` y con `ventiladorId: 123`. | En los tres casos `invalid-argument`: "El ventiladorId es obligatorio.". |
| CV-35 | `administrador`. | `enviarComandoVentilador` para VS con `accionSolicitada` igual a `"prender"`, a `""`, a `"establecer_velocidad"` y sin el campo. | En todos `invalid-argument`: 'accionSolicitada debe ser "encender" o "apagar".'. No se crea ninguna orden (la velocidad no se admite en esta etapa). |
| CV-36 | Editar a mano en la consola `ventiladores/<id de VS>.modoControl` a un valor inválido (por ejemplo `"turbo"`) o borrar el campo. Anotar el valor original para restaurarlo. | Mirar la tarjeta de VS y llamar a `enviarComandoVentilador`. | La función responde `failed-precondition`: "El modo de control del ventilador no permite comandos manuales.". El panel deshabilita los botones con el mismo texto. Restaurar `modoControl`. |
| CV-37 | Quitar a mano `incubadoraId` (o `dispositivoId`) de `ventiladores/<id de VN>`; anotar el valor para restaurarlo. | Llamar a `enviarComandoVentilador` para VN con `accionSolicitada: "encender"`. | `failed-precondition`: "El ventilador no tiene incubadora o dispositivo asociado, por lo que no se puede enviar el comando.". No se crea ninguna orden. Restaurar el campo. |
| CV-38 | VS en manual, servicio y simulador corriendo; un cliente MQTT a mano. | Publicar en `<prefijo>/<incubadoraId>/ventiladores/<id de VS>/estado` el JSON `{"encendido": "true"}` (usando el cliente web de HiveMQ Cloud o `mosquitto_pub`, como en `plan-pruebas-simulador.md`). | El servicio lo rechaza: en su log `Estado de ventilador rechazado (<incubadoraId>/<id de VS>): encendido debe ser booleano.`. `estadoActual` no cambia y no se cierra ninguna orden. |
| CV-39 | Servicio corriendo; simulador **detenido**; VS en manual. | Enviar "Encender" a VS (queda `enviada`). Antes de 30 s, publicar a mano en el tópico de estado de VS `{"encendido": true}`. | El servicio actualiza `estadoActual` a `"encendido"` y cierra la orden `enviada` como `ejecutada` (con `ejecutadaEn`), aunque la respuesta no venga del simulador: la correlación es por acción. El panel muestra "Ejecutada" y "Encendido". |
| CV-40 | Igual que CV-39 con una orden "Encender" `enviada`. | Publicar a mano `{"encendido": false}`. | El servicio actualiza `estadoActual` a `"apagado"`, pero la orden `encender` **sigue `enviada`** (el log dice `El ventilador <id> reportó "apagado", pero ninguna orden enviada lo pedía: siguen enviadas.`) y recién pasa a `fallida` por el timeout de 30 s. |

## 8. Permisos y roles

Las pruebas con la interfaz comprueban lo que ve cada rol; las llamadas
directas a las funciones (0.8) y las escrituras directas a Firestore
comprueban la defensa real, que está en el servidor y no en el botón.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-41 | Sesión de `administrador`. | Abrir `/ventiladores`. | Se muestra el panel completo. Cada tarjeta tiene el enlace "Configurar modo y automatización". |
| CV-42 | Sesión de `operador`. | Abrir `/ventiladores`. | Se muestra el panel y los botones funcionan (CV-12). Las tarjetas **no** tienen el enlace "Configurar modo y automatización". |
| CV-43 | Sesión de `consulta`. | Escribir `/ventiladores` en la barra de direcciones. | Se redirige a `/sin-autorizacion` ("Acceso no autorizado", "No tienes permisos para acceder a esta sección." y el enlace "Volver al panel general"). No se muestra el panel. |
| CV-44 | Sesión de `consulta`. | Revisar los permisos del rol y el menú lateral. | `ROLE_PERMISSIONS` de `consulta` (en `frontend/src/utils/constants.js`) incluye solo lectura de dashboard, incubadoras, mediciones, históricos y estadísticas, y **no** `ver_ventiladores` ni `controlar_ventiladores`; por lo tanto el ítem "Ventiladores" de `NAVIGATION_ITEMS` no se ofrece a ese rol. El `Sidebar` está montado (0.5): el menú de `consulta` muestra solo "Panel general" e "Incubadoras", sin "Ventiladores". |
| CV-45 | Sin sesión iniciada. | Abrir `/ventiladores`. | Redirige a `/login`. |
| CV-46 | Sesión de `operador`; luego de `consulta`; luego sin sesión. | Abrir `/ventiladores/automatizacion`. | `operador` y `consulta`: redirigen a `/sin-autorizacion`. Sin sesión: redirige a `/login`. El formulario de reglas es solo para el `administrador`. |
| CV-47 | Usuario de `consulta` con sesión. | Invocar `enviarComandoVentilador` directamente para VS con `accionSolicitada: "encender"`. | `permission-denied`: "Solo un administrador u operador puede enviar comandos a un ventilador.". No se crea ninguna orden. |
| CV-48 | Sin sesión (sin cabecera `Authorization`). | Invocar `enviarComandoVentilador` para VS. | `unauthenticated`: "Debes iniciar sesión para realizar esta acción.". No se crea ninguna orden. |
| CV-49 | `administrador` y `operador`, uno por vez. | Invocar `enviarComandoVentilador` directamente para VS con `accionSolicitada: "encender"` y con `"apagar"`. | La función responde `ok: true`, `ordenId` y "Orden de ventilador creada correctamente."; la orden llega a `ejecutada` (con VS en manual o mixto). |
| CV-50 | `operador`; luego `consulta`; luego sin sesión. | Invocar `guardarReglaAutomatizacion` directamente para VS con `{modoControl: "manual"}`. | `operador` y `consulta`: `permission-denied` con "Solo un administrador puede configurar la automatización de un ventilador."; sin sesión: `unauthenticated` ("Debes iniciar sesión para realizar esta acción."). `ventiladores/<id de VS>.modoControl` no cambia. |
| CV-51 | Simulador de reglas de la consola de Firebase o emulador de Firestore (como en 7.6 de `plan-pruebas-monitoreo-alertas.md`). | Como `administrador`, `operador` y `consulta`, intentar crear, modificar y borrar documentos de `ordenes_ventilador`, `ventiladores` y `reglas_automatizacion`; y leerlos. | Todas las escrituras se rechazan para los tres roles (`permission-denied`); la lectura está permitida a cualquier usuario autenticado, incluido `consulta` (la restricción de este rol está en la ruta y en las funciones, no en la lectura de datos). Sin sesión, la lectura también se rechaza. |

## 9. Varias incubadoras y varios ventiladores

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| CV-52 | Dos incubadoras activas, cada una con al menos un ventilador. | En `/ventiladores`, cambiar el selector "Incubadora". | Cada incubadora muestra solo sus ventiladores y sus órdenes; al cambiar aparece "Cargando ventiladores..." un instante. Una incubadora en estado "Inactiva" no aparece en el selector. |
| CV-53 | VS y VN en la misma incubadora. | Enviar "Encender" a VN (queda en curso unos 30 s) y, mientras, enviar "Encender" a VS. | La orden de VS se acepta y llega a "Ejecutada" aunque la de VN siga en curso: el bloqueo de botones es por ventilador. |

## 10. Trazabilidad

| Requisito | Qué se comprueba | Casos |
| --------- | ---------------- | ----- |
| RF-012 / RF-013 (CU-03) — encender y apagar manualmente | Orden manual creada, enviada y ejecutada con administrador y operador, en modo manual y mixto; rechazo en modo automático. | CV-10 a CV-20, CV-49 |
| RF-012 / RF-013 (CU-03) — estado del ventilador y feedback visual | Estado "Desconocido" hasta el primer reporte; avance de la orden sin recargar; fallida, expirada y atascada distintas de las que están en curso. | CV-02, CV-03, CV-21 a CV-32, CV-39, CV-40 |
| RF-012 / RF-013 (CU-03) — errores claros | Ventilador inexistente o sin documento, datos inválidos y estados anómalos con mensaje específico. | CV-04 a CV-09, CV-33 a CV-38 |
| CU-03 — permisos por rol | Administrador y operador controlan; consulta no accede; formulario de reglas solo del administrador; defensa en las Cloud Functions y en las reglas. | CV-41 a CV-51 |

Las tarjetas de Notion y el repositorio no detallan cuál de los dos requisitos
(RF-012 o RF-013) cubre cada caso; por eso se trazan juntos al CU-03.

## 11. Registro de resultados

Resultados de la ejecución local del 2026-10-18 (ver el recuadro de estado al
inicio: emuladores, broker local, commit `0ec7866`). `Resultado`: Pasó /
Parcial / Falló / Bloqueado. `Evidencia`: lo observado, con la ruta o el campo
donde se comprobó. Las siglas H-nn remiten a los hallazgos de abajo. Al
repetir el plan, reemplazar estas filas con el resultado de la nueva
ejecución e indicar el entorno.

Totales: **53 casos: 52 Pasó, 1 Parcial (CV-32), 0 Falló, 0 Bloqueado.**

| Caso | Descripción | Resultado | Evidencia |
| ---- | ----------- | --------- | --------- |
| CV-01 | Alta de ventilador crea `ventiladores/{id}` (manual, `estadoActual: null`) | Pasó | Al dar de alta un ventilador y un sensor con "+ Agregar dispositivo" se creó `ventiladores/<mismo id>` solo para el ventilador, con `incubadoraId` y `dispositivoId` correctos, `modoControl: "manual"`, `estadoActual: null` y `creadoEn`, sin `actualizadoEn`; el sensor no generó documento. La interfaz solo informa el `identificadorMqtt`, no el id del documento (H-05). |
| CV-02 | Ventilador nuevo se muestra "Desconocido" | Pasó | En `/ventiladores` (administrador) las dos tarjetas nuevas mostraron el chip "Desconocido", "Modo de control: Manual", "Todavía no se envió ninguna orden." y los botones Encender y Apagar habilitados, sin texto de motivo. |
| CV-03 | El primer reporte lleva a "Apagado" sin crear orden | Pasó | Al arrancar el simulador el chip de VS pasó a "Apagado" sin recargar. En Firestore `estadoActual: "apagado"` con `actualizadoEn` y 0 órdenes; el log del servicio mostró `Ventilador <id> actualizado a "apagado".`. VN siguió en "Desconocido". |
| CV-04 | Script con `--dry-run`: informa y no escribe | Pasó | `--dry-run` (con una cuenta de servicio falsa del proyecto `demo-mtpa` y las variables de los emuladores) imprimió el proyecto y "Modo --dry-run: no se escribe nada en Firestore.", listó `Se crearía ventiladores/<id de VD>` y el resumen (3 encontrados, 1 se crearía, 2 ya existían, 0 errores), con código 0 y sin crear el documento. |
| CV-05 | Script sin modo, con error de tipeo o con ambos: código 2 | Pasó | Sin argumentos, con `--dryrun` y con `--dry-run --confirmar` terminó con código 2 y los mensajes esperados ("Indicá exactamente uno..." en el primero y el tercero; "Argumentos no reconocidos: --dryrun" más la línea de uso en el segundo). El documento de VD siguió sin existir. |
| CV-06 | Ventilador sin documento: no aparece y el comando da `not-found` | Pasó | Con VD sin documento, la incubadora mostró "Sin ventiladores registrados" y `enviarComandoVentilador` respondió 404 `NOT_FOUND` "El ventilador solicitado no existe." sin crear ninguna orden. |
| CV-07 | Script con `--confirmar` crea el documento faltante | Pasó | `--confirmar` informó "Creados: 1", "Ya existían: 2" y "Errores: 0" (código 0). `ventiladores/<id de VD>` quedó con `modoControl: "manual"`, `estadoActual: null` y los ids correctos, y su tarjeta apareció en el panel con "Desconocido" en tiempo real. |
| CV-08 | Script idempotente; el comando deja de dar `not-found` | Pasó | La 2.ª ejecución informó "Creados: 0" y "Ya existían: 3" sin cambiar `creadoEn`. El comando a VD respondió 200 `ok: true`; la orden pasó a `enviada` y terminó `fallida` a los ~35 s ("El dispositivo no confirmó el estado en 30 s."). |
| CV-09 | Incubadora sin ventiladores: estado vacío | Pasó | Con la incubadora sin ventiladores el panel mostró "Sin ventiladores registrados" y "Esta incubadora no tiene ventiladores. Se crean al dar de alta un dispositivo de tipo ventilador.", sin botones de control. |
| CV-10 | Administrador enciende (flujo completo y logs) | Pasó | Como administrador el botón mostró "Enviando..." y la orden recorrió Pendiente, Enviando, Enviada y "Ejecutada" ("El ventilador confirmó el cambio.") en ~180 ms, con el chip en "Encendido". En Firestore: `origen: "manual"`, `estado: "ejecutada"`, `solicitadoPor` del administrador, `enviadaEn`, `ejecutadaEn` y sin `error`; los tres logs del servicio y el del simulador (`"encendido":true`) coinciden. |
| CV-11 | Administrador apaga | Pasó | Apagar como administrador creó una orden `apagar`/`manual` con `solicitadoPor` del administrador que llegó a `ejecutada`; el chip pasó a "Apagado" y `estadoActual` a `"apagado"`. |
| CV-12 | Operador enciende y apaga (`solicitadoPor` del operador) | Pasó | Como operador, Encender y Apagar terminaron en "Ejecutada" con `solicitadoPor` del operador y `origen: "manual"`. |
| CV-13 | Encender un ventilador ya encendido no da error | Pasó | Con VS ya en "Encendido", pulsar Encender otra vez no dio error: se creó otra orden `encender`/`manual` que terminó "Ejecutada" y el chip siguió en "Encendido". |
| CV-14 | Campos del documento de la orden manual | Pasó | La orden manual tiene exactamente `ventiladorId`, `incubadoraId`, `dispositivoId`, `accionSolicitada`, `origen`, `estado`, `solicitadoPor`, `creadaEn`, `enviadaEn`, `actualizadaEn` y `ejecutadaEn`. La función respondió `ok: true`, `ordenId` y "Orden de ventilador creada correctamente.". |
| CV-15 | Pasar a mixto con regla inactiva | Pasó | Desde "Configurar modo y automatización" (con incubadora y ventilador preseleccionados) se guardó Mixto, Temperatura, 60 y 30 con la regla inactiva: aparecieron el aviso y el mensaje de éxito. En Firestore `modoControl: "mixto"` y la regla con `activa: false`, 60, 30 y `actualizadoPor` del administrador. El panel mostró "Mixto" (el cambio en vivo se comprobó en CV-20). |
| CV-16 | Administrador controla en mixto | Pasó | En mixto con la regla inactiva, Encender y Apagar del administrador terminaron en "Ejecutada" (chip "Encendido" y luego "Apagado") y no hubo ninguna orden con `origen: "automatico"`. |
| CV-17 | Operador controla en mixto | Pasó | En mixto, Encender y Apagar con el token de un operador respondieron 200 `ok: true` y las dos órdenes terminaron `ejecutada` con `solicitadoPor` del operador. Se hizo por llamada directa a la función, no con clics en la interfaz (los clics del operador ya se cubrieron en CV-12). |
| CV-18 | Modo automático deshabilita los botones y explica el motivo | Pasó | Al elegir Automático apareció el aviso y, con la regla activa 60/30, se guardó `modoControl: "automatico"`. En el panel (otra pestaña, sin recargar) los botones quedaron deshabilitados con "El ventilador está en modo automático y no admite comandos manuales.". |
| CV-19 | Comando directo en automático rechazado (`failed-precondition`) | Pasó | En automático, `enviarComandoVentilador` como administrador y como operador respondió 400 `FAILED_PRECONDITION` "El ventilador está configurado en modo automático y no admite comandos manuales." y no se creó ninguna orden. |
| CV-20 | Cambio de modo habilita los botones sin recargar | Pasó | Con dos pestañas: al guardar Manual los botones de la pestaña del panel se habilitaron y desapareció el texto de motivo sin recargar; luego mostró "Mixto". En modo Manual la regla se conservó (60/30, mismo `actualizadoEn`) y el formulario mostró la nota de que la regla guardada no cambia. |
| CV-21 | Avance de la orden sin recargar | Pasó | Un observador de DOM registró sin recargar: botón "Enviando...", Pendiente, Enviando (~25-50 ms), Enviada, chip "Encendido" y "Ejecutada", todo en ~180 ms. La orden tiene `enviadaEn` y `actualizadaEn` y el log del servicio muestra la publicación y la ejecución. El estado `enviando` sí se pudo observar (H-07, plan corregido). |
| CV-22 | "Pendiente" visible con el servicio detenido | Pasó | Con el servicio detenido la orden quedó "Pendiente" ("En cola, esperando su envío al ventilador.") como distintivo informativo, con los botones deshabilitados y "Hay una orden en curso; espere a que termine para enviar otra."; en Firestore `pendiente` sin `enviadaEn`. Al arrancar el servicio (~47 s) pasó sola a "Ejecutada". |
| CV-23 | "Enviada" visible con el simulador detenido | Pasó | Con el simulador detenido la orden quedó "Enviada" ("Orden enviada; esperando la confirmación del ventilador.") como distintivo informativo y con los botones deshabilitados; en Firestore `enviada` con `enviadaEn`, y el log del servicio mostró la publicación. |
| CV-24 | Doble clic crea una sola orden | Pasó | Con un doble clic real sobre "Encender" se creó una sola orden, tanto en VS (con simulador) como en VN (orden en curso unos 30 s). |
| CV-25 | Orden en curso de otro usuario bloquea los botones | Pasó | Con dos navegadores reales (administrador y operador), al pulsar Encender en VN el segundo vio en ~0,1 s la orden "Enviada" y los botones de VN deshabilitados, sin recargar. |
| CV-26 | Los botones se rehabilitan al terminar; el bloqueo es por ventilador | Pasó | La orden de VN pasó a "Fallida" a los ~33 s de `enviadaEn` y los botones de VN se rehabilitaron en el otro navegador sin recargar; la tarjeta de VS no cambió en ningún momento. |
| CV-27 | Orden fallida (simulador detenido) y su presentación | Pasó | Con el simulador detenido, la orden pasó de "Enviada" a "Fallida" a los ~35 s de `enviadaEn`, con el bloque `message--danger` ("Fallida" y "La orden no pudo completarse. Inténtalo nuevamente.") y el motivo en el `title`. En Firestore `estado: "fallida"` y el `error` esperado; `estadoActual` no cambió y los botones se rehabilitaron. |
| CV-28 | Orden fallida en VN sin afectar a VS | Pasó | Encender sobre VN (simulador corriendo) terminó "Fallida" a los ~33 s con VN en "Desconocido"; en el mismo lapso VS recibió su comando y llegó a "Ejecutada". |
| CV-29 | Orden expirada (servicio detenido más de 60 s) | Pasó | Con el servicio detenido 72 s la orden pasó a "Expirada" al arrancarlo, con el bloque `message--warning`, el texto "La orden no se envió a tiempo y se descartó. Inténtalo nuevamente." y `error: "La orden venció: tiene 72 s y el máximo es 60 s."`. No hubo publicación en el log del servicio ni cambio en `estadoActual`. |
| CV-30 | Orden atascada a los 120 s | Pasó | Con el servicio detenido, a ~114 s la orden seguía "Pendiente" con los botones deshabilitados; a ~120,5 s apareció el bloque "Atascada" (`message--warning`) con el texto esperado y los botones se rehabilitaron. En Firestore la orden seguía `pendiente`. |
| CV-31 | Reenviar desde "Atascada": la vieja expira, la nueva se ejecuta | Pasó | Desde "Atascada" se pulsó Apagar de nuevo y se creó una 2.ª orden. Al arrancar el servicio la 1.ª pasó a `expirada` ("tiene 131 s y el máximo es 60 s") y la 2.ª se publicó y llegó a `ejecutada`; el panel mostró "Ejecutada" y el chip "Apagado". |
| CV-32 | Las órdenes con error se distinguen de las en curso | Parcial | Se verificó la estructura y las variantes de clase: Pendiente y Enviada con `status--info`, Ejecutada con `status--success`, Fallida con `message--danger` y Expirada y Atascada con `message--warning`; ninguna orden en curso se renderizó como bloque de error. No se evaluó con rigor la comparación visual subjetiva del color (contraste y legibilidad). |
| CV-33 | Ventilador inexistente: `not-found` | Pasó | `enviarComandoVentilador` con `ventiladorId: "no-existe"` respondió 404 `NOT_FOUND` "El ventilador solicitado no existe." sin crear órdenes. |
| CV-34 | `ventiladorId` ausente o inválido | Pasó | Sin `ventiladorId`, con `""` y con `123` la función respondió 400 `INVALID_ARGUMENT` "El ventiladorId es obligatorio.". Un id con formato inválido como `"a/b"` no está cubierto por el caso y da `INTERNAL` (H-01). |
| CV-35 | Acción inválida | Pasó | Con `prender`, `""`, `establecer_velocidad` y sin el campo, las cuatro llamadas respondieron 400 `INVALID_ARGUMENT` `accionSolicitada debe ser "encender" o "apagar".` sin crear órdenes. |
| CV-36 | Modo de control inválido en el documento | Pasó | Con `modoControl: "turbo"` y con el campo borrado, la función respondió 400 `FAILED_PRECONDITION` "El modo de control del ventilador no permite comandos manuales." y la tarjeta deshabilitó los botones con el mismo texto; la tarjeta muestra el valor crudo ("Turbo") o "-" (H-04). Se restauró `manual`. |
| CV-37 | Ventilador sin incubadora o dispositivo asociado | Pasó | Quitando `incubadoraId` y luego `dispositivoId` de VN, la función respondió 400 `FAILED_PRECONDITION` "El ventilador no tiene incubadora o dispositivo asociado, por lo que no se puede enviar el comando." en ambos casos y no creó órdenes. Se restauraron los campos. |
| CV-38 | Estado MQTT con payload inválido rechazado | Pasó | Con el payload `{"encendido": "true"}` el log del servicio mostró "Estado de ventilador rechazado (...): encendido debe ser booleano." y `estadoActual` y `actualizadoEn` no cambiaron. |
| CV-39 | Estado reportado a mano cierra la orden `enviada` coincidente | Pasó | Con el simulador detenido la orden quedó "Enviada". Al publicar a mano `{"encendido": true}` a los ~10 s, `estadoActual` pasó a `"encendido"` y la orden a `ejecutada` con `ejecutadaEn`; el panel mostró "Ejecutada" y "Encendido". |
| CV-40 | Estado que no coincide no cierra la orden | Pasó | Al publicar `{"encendido": false}` con una orden `encender` enviada, `estadoActual` pasó a `"apagado"` y la orden siguió `enviada` (el log dice que ninguna orden enviada lo pedía); a los 30-40 s pasó a `fallida`. |
| CV-41 | Administrador accede y ve el enlace de configuración | Pasó | Como administrador, `/ventiladores` mostró el panel completo y las dos tarjetas de la incubadora tenían el enlace "Configurar modo y automatización". |
| CV-42 | Operador accede sin el enlace de configuración | Pasó | Como operador, `/ventiladores` mostró el panel con los botones funcionales y 0 enlaces "Configurar modo y automatización" en las tarjetas. |
| CV-43 | Consulta redirigido a `/sin-autorizacion` | Pasó | Como consulta, `/ventiladores` redirigió a `/sin-autorizacion` ("Acceso no autorizado", "No tienes permisos para acceder a esta sección." y "Volver al panel general") sin mostrar el panel. |
| CV-44 | Consulta sin permiso de ventiladores (menú) | Pasó | `ROLE_PERMISSIONS` de consulta no incluye `ver_ventiladores` ni `controlar_ventiladores` (`frontend/src/utils/constants.js`, líneas 605-614). El `Sidebar` ya está montado, así que la parte visual se verificó: el menú de consulta muestra solo "Panel general" e "Incubadoras", sin "Ventiladores". |
| CV-45 | Sin sesión redirige a `/login` | Pasó | Sin sesión, `/ventiladores` redirigió a `/login`. |
| CV-46 | Formulario de reglas solo para el administrador | Pasó | En `/ventiladores/automatizacion`, operador y consulta redirigieron a `/sin-autorizacion` ("Acceso no autorizado") y sin sesión a `/login`. |
| CV-47 | `consulta` rechazado en `enviarComandoVentilador` | Pasó | Como consulta, `enviarComandoVentilador` respondió 403 `PERMISSION_DENIED` "Solo un administrador u operador puede enviar comandos a un ventilador." sin crear órdenes. |
| CV-48 | Sin sesión rechazado en `enviarComandoVentilador` | Pasó | Sin cabecera `Authorization`, la función respondió 401 `UNAUTHENTICATED` "Debes iniciar sesión para realizar esta acción." sin crear órdenes. |
| CV-49 | Administrador y operador llaman a la función directamente | Pasó | Administrador y operador, con `encender` y `apagar` por llamada directa: las cuatro respondieron 200 `ok: true` con `ordenId` y "Orden de ventilador creada correctamente.", y las órdenes terminaron `ejecutada` con `solicitadoPor` del rol correspondiente. |
| CV-50 | `guardarReglaAutomatizacion` rechaza a operador, consulta y sin sesión | Pasó | `guardarReglaAutomatizacion` con `{modoControl: "manual"}`: operador y consulta recibieron 403 `PERMISSION_DENIED` "Solo un administrador puede configurar la automatización de un ventilador." y sin sesión 401 `UNAUTHENTICATED`; el `modoControl` de VS no cambió. |
| CV-51 | Reglas de Firestore: sin escrituras del cliente | Pasó | Con el SDK cliente contra el emulador de Firestore y las reglas del repositorio, todas las escrituras (create, update y delete sobre `ordenes_ventilador`, `ventiladores` y `reglas_automatizacion`) de los tres roles fueron rechazadas con `permission-denied`; la lectura (get y list) fue permitida a los tres, incluido consulta. Sin sesión se rechazó todo. Con el Admin SDK se confirmó que no se escribió nada. |
| CV-52 | Selector de incubadora | Pasó | El selector listó las tres incubadoras activas y no la inactiva; cada una mostró solo sus ventiladores y sus órdenes. No se capturó el texto transitorio "Cargando ventiladores..." (dura milisegundos). |
| CV-53 | Bloqueo independiente por ventilador | Pasó | Con la orden de VN "Enviada" (botones de VN deshabilitados), Encender en VS se aceptó y llegó a "Ejecutada" en menos de 1 s: el bloqueo es por ventilador. |

### Hallazgos de la ejecución

Defectos y fricciones que dejó la ejecución local y que afectan a este plan.
Ninguno hizo fallar un caso. **Todos están pendientes de corrección** (esta
documentación no los arregla).

| ID | Qué se observó | Impacto | Estado |
| -- | -------------- | ------- | ------ |
| H-01 | `enviarComandoVentilador` responde `INTERNAL` (HTTP 500) cuando `ventiladorId` no es un id de documento válido (`"a/b"`, `"."`, `".."`, `"__x__"`); en el log aparece un error no controlado de Firestore sobre la ruta del documento. Con un id válido que no existe sí responde `not-found`. `guardarReglaAutomatizacion` ya valida esos ids y responde `invalid-argument` (AU-13). | Baja. No se crea ninguna orden, pero el cliente recibe un error genérico y se registra un error no controlado. Ni CV-33 ni CV-34 cubren estos ids. | Pendiente de corrección. Al corregirlo, agregar un caso (por ejemplo, CV-34 con `"a/b"`). |
| H-02 | `frontend/.env` y `functions/.secret.local` no están ignorados por git. El plan (0.5) indica crear `frontend/.env`. | Baja. Un commit accidental de esos archivos. En la ejecución se usó `frontend/.env.local`, que sí está ignorado. | Pendiente de corrección. |
| H-03 | Con `firebase-tools` 15.28.2 y `firebase-admin` 12.7.0, el emulador de Functions deja `admin.firestore.FieldValue` en `undefined` y toda función que escribe con `serverTimestamp()` falla con `INTERNAL`. En producción no ocurre. | Info. Hace falta un workaround local para ejecutar el plan en emuladores (ver `docs/pruebas/ejecucion-local-emuladores.md`). | Pendiente de corrección en el código (importar `FieldValue` y `Timestamp` desde `firebase-admin/firestore`). |
| H-04 | Un `modoControl` inválido o ausente se muestra tal cual en la tarjeta: "Modo de control: Turbo" con `"turbo"` y "-" con el campo borrado (CV-36). Los botones sí se deshabilitan con el texto correcto. | Menor. Podría mostrarse "Modo desconocido". | Pendiente de corrección. |
| H-05 | El alta de dispositivos (`/incubadoras/<id>/editar`) informa solo el `identificadorMqtt`, no el id del documento de `dispositivos/`. Ese id es el que piden el simulador (`SIMULADOR_VENTILADOR_ID`, `SIMULADOR_SENSOR_ID`), los tópicos MQTT y este plan (0.3, CV-01). | Menor. Hay que leerlo de Firestore, lo que es una fricción operativa. | Pendiente de corrección. |

Los identificadores H-nn son los de la ejecución y se mantienen iguales en
`docs/pruebas/plan-pruebas-automatizacion.md`. Además, la ejecución encontró
dos desviaciones del plan, que **ya se corrigieron en este documento**:

- **H-06.** El `Sidebar` sí está montado (`DashboardLayout.jsx` lo incluye):
  se actualizaron 0.5 y CV-44, cuya parte visual ya no queda "Bloqueada".
- **H-07.** El estado `enviando` sí es observable en el panel: se actualizaron
  0.6 y CV-21.

## Notas

- **Ejecución local, no real.** El plan se ejecutó el 2026-10-18 en un entorno
  local (ver el recuadro de estado al inicio): sus resultados no sustituyen una
  pasada contra Firebase y HiveMQ Cloud reales, que sigue pendiente.
- El caso CV-51 puede ejecutarse con el simulador de reglas de la consola de
  Firebase o con el emulador de Firestore (así se hizo). Los casos de las
  secciones 7 y 8 que solo llaman a las funciones y comprueban el rechazo
  pueden ejecutarse con el emulador de Functions; los que dependen del Servicio
  de Integración y del broker (todas las órdenes que deben llegar a `enviada`,
  `ejecutada`, `fallida` o `expirada`) necesitan un broker, que en la ejecución
  local fue uno propio y no HiveMQ Cloud.
- `docs/contrato-mqtt.md` describe los tópicos con el prefijo `mtpa/`, pero el
  valor efectivo es el de `MQTT_TOPIC_PREFIX` (`mtpa-dev` por defecto).
- **Qué mira el panel y qué no.** El panel no consulta la cantidad de
  ventiladores "sin documento": un dispositivo `ventilador` sin
  `ventiladores/{id}` simplemente no se lista, y si es el único de la
  incubadora se ve "Sin ventiladores registrados", sin pistas del script de
  migración. El mensaje claro ("El ventilador solicitado no existe.") sale de
  la Cloud Function (CV-06 y CV-33). Como el panel se actualiza en tiempo real,
  la tarjeta de un ventilador cuyo documento se borra desaparece de inmediato:
  el error `not-found` no se llega a ver en pantalla.
- **El bloqueo contra doble envío es del panel, no del servidor.**
  `enviarComandoVentilador` no comprueba `estadoActual` ni si ya hay una orden
  en curso, así que dos usuarios que pulsen a la vez (o una llamada directa)
  crean dos órdenes. Las dos se envían y se aplican en orden.
- **El bloqueo usa el reloj del navegador.** Una orden en curso se considera
  "Atascada" cuando ese navegador la ve 120 s sin cambios; si se recarga la
  página, la cuenta de esos 120 s empieza de nuevo. La edad calculada con la
  fecha del servidor solo cuenta pasados 120 s más 5 minutos de tolerancia (un
  reloj muy adelantado o muy atrasado desplaza el momento en que aparece
  "Atascada"). Es una limitación conocida del panel.
- **Límites conocidos del servicio** (ver `docs/contrato-mqtt.md`; son
  observaciones, no casos que deban pasar):
  - `enviada` significa que el servicio ya reclamó la orden y está por publicar
    el comando, o ya lo publicó; no garantiza que se haya entregado.
  - El comando viaja con QoS 1 (al menos una entrega): el dispositivo debe ser
    idempotente por `ordenId` y descartar comandos de más de ~60 s. El simulador
    lo es solo porque `encender` y `apagar` son idempotentes por naturaleza.
  - Con varias órdenes `enviada` de la misma acción para el mismo ventilador,
    un estado reportado puede cerrar una que no es la que lo provocó; la
    correlación mira solo las 10 órdenes más recientes.
  - Si el servicio muere entre el reclamo y la escritura de `enviada`, la orden
    queda `enviando` y nadie la cierra (requiere revisión manual).
  - Una orden `fallida` por timeout no se reabre si el dispositivo confirma
    después; solo se actualiza `estadoActual`.
  - Mientras el servicio o MQTT están caídos las órdenes `pendiente` no
    caducan: expiran recién al ser reclamadas (CV-29).
- Una vez ejecutado el plan, completar la sección 11 y, si algún caso falla,
  abrir una incidencia con el identificador del caso y la evidencia.
