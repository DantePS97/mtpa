# Modelo de datos — Firestore

Este documento describe las colecciones de Firestore usadas por M.T.P.A. Los
nombres de colección están centralizados en
`frontend/src/utils/constants.js` (`COLLECTIONS`).

## `usuarios/{uid}`

Representa a cada usuario del sistema. El identificador del documento (`uid`)
es el mismo `uid` asignado por Firebase Authentication.

| Campo      | Tipo                                             | Descripción                                                        |
| ---------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| `uid`      | `string`                                          | Identificador de Firebase Authentication (duplicado como campo para facilitar queries). |
| `nombre`   | `string`                                          | Nombre completo del usuario.                                       |
| `correo`   | `string`                                          | Correo electrónico (debe coincidir con el de Authentication).       |
| `rol`      | `string` (`"administrador"` \| `"operador"` \| `"consulta"`) | Rol del usuario. Se replica como custom claim `role` en el token.   |
| `activo`   | `boolean`                                         | Si es `false`, el usuario no debe poder operar el sistema aunque su cuenta de Authentication siga habilitada. |
| `creadoEn` | `timestamp`                                       | Fecha de creación del documento (server timestamp).                 |

Reglas de acceso (ver `firestore.rules`): lectura permitida al propio usuario
o a un administrador; escritura exclusiva de administradores, y siempre a
través de la Cloud Function `gestionarUsuario` (nunca por escritura directa
desde el cliente).

## `incubadoras/{incubadoraId}` (Sprint 2)

Representa una incubadora física monitoreada.

| Campo        | Tipo     | Descripción                                                  |
| ------------ | -------- | -------------------------------------------------------------- |
| `id`         | `string` | Identificador de la incubadora (igual al id del documento).     |
| `nombre`     | `string` | Nombre visible de la incubadora.                                |
| `ubicacion`  | `string` | Ubicación física (galpón, sector, etc.).                        |
| `estado`     | `string` | Uno de los valores de `INCUBATOR_STATUS` (`activa`, `inactiva`, `advertencia`, `critica`, `mantenimiento`). |

## `dispositivos/{dispositivoId}` (Sprint 2)

Representa un dispositivo físico (sensor o ventilador) asociado a una
incubadora.

| Campo                  | Tipo        | Descripción                                                                 |
| ---------------------- | ----------- | ------------------------------------------------------------------------------ |
| `incubadoraId`         | `string`    | Referencia a la incubadora dueña del dispositivo (`incubadoras/{id}`).          |
| `tipo`                 | `string`    | Uno de los valores de `DEVICE_TYPES` (`sensor_temperatura`, `sensor_humedad`, `sensor_temperatura_humedad`, `ventilador`, `controlador`). |
| `identificadorMqtt`    | `string`    | Identificador único del dispositivo usado en los tópicos MQTT (ver `docs/contrato-mqtt.md`). |
| `estadoConexion`       | `string`    | Uno de los valores de `DEVICE_STATUS` (`conectado`, `desconectado`, `advertencia`, `desconocido`). |
| `ultimaComunicacionEn` | `timestamp` | Última vez que el dispositivo envió un latido o una medición. Se usa para derivar `estadoConexion` (ver contrato MQTT: sin latido en más de 30s ⇒ `desconectado`). |

## `mediciones/{medicionId}` (Sprint 3)

Cada documento es una lectura de un sensor. La crea la Cloud Function
`procesarMedicion` (con Admin SDK) cuando el Servicio de Integración IoT le
reenvía una medición recibida por MQTT. Cualquier usuario autenticado puede
leerlas; ningún cliente puede escribirlas (ver `firestore.rules`).

| Campo          | Tipo        | Descripción                                                                 |
| -------------- | ----------- | ------------------------------------------------------------------------------ |
| `incubadoraId` | `string`    | Incubadora a la que pertenece la medición (`incubadoras/{id}`).                 |
| `dispositivoId`| `string`    | Dispositivo que reportó la medición (`dispositivos/{id}`).                      |
| `variable`     | `string`    | `temperatura` o `humedad`.                                                      |
| `valor`        | `number`    | Valor medido.                                                                   |
| `unidad`       | `string`    | Unidad del valor (por ejemplo `°C` o `%`).                                      |
| `medidoEn`     | `timestamp` | Momento en que el sensor tomó la medición.                                      |
| `creadoEn`     | `timestamp` | Momento en que `procesarMedicion` almacenó el documento.                        |

## `umbrales/{incubadoraId}_{variable}` (Sprint 3)

Rango aceptable de una variable ambiental en una incubadora. El id del
documento es `{incubadoraId}_{variable}` (por ejemplo `inc1_temperatura`), de
modo que hay como máximo un umbral por incubadora y variable. Lo lee
`procesarMedicion` (`evaluarUmbrales`) en cada medición; si no existe umbral,
no se generan ni se resuelven alertas.

| Campo           | Tipo        | Descripción                                                                |
| --------------- | ----------- | ----------------------------------------------------------------------------- |
| `incubadoraId`  | `string`    | Incubadora a la que aplica el umbral.                                          |
| `variable`      | `string`    | `temperatura` o `humedad`.                                                     |
| `minimo`        | `number`    | Límite inferior del rango aceptable.                                           |
| `maximo`        | `number`    | Límite superior del rango aceptable.                                           |
| `actualizadoEn` | `timestamp` | Última vez que se guardó el umbral (server timestamp).                         |

Reglas de acceso (ver `firestore.rules`): lectura para cualquier usuario
autenticado; escritura solo para administradores, directamente desde la
pantalla de configuración de límites (no pasa por una Cloud Function).

## `alertas/{alertaId}` (Sprint 3)

Una alerta registra que una variable salió del rango definido en su umbral.
La crea `evaluarUmbrales` (dentro de `procesarMedicion`, con Admin SDK); al
crearse, la Cloud Function `notificarAlerta` envía el correo de aviso.
Cualquier usuario autenticado puede leerlas. La colección también guarda las
alertas de desconexión de dispositivos (ver
[Alertas de desconexión](#alertas-de-desconexión-de-dispositivos)), que no
tienen `variable`, `valor`, `limite` ni `medidoEn`; la tabla describe las
alertas de umbral.

| Campo             | Tipo        | Descripción                                                              |
| ----------------- | ----------- | --------------------------------------------------------------------------- |
| `incubadoraId`    | `string`    | Incubadora afectada (`incubadoras/{id}`).                                    |
| `dispositivoId`   | `string`    | Dispositivo que reportó la medición que originó la alerta.                   |
| `variable`        | `string`    | `temperatura` o `humedad`.                                                   |
| `valor`           | `number`    | Valor medido que originó la alerta.                                          |
| `limite`          | `number`    | Límite superado: el `maximo` del umbral en las alertas `alta`, el `minimo` en las `baja`. |
| `tipo`            | `string`    | `{variable}_alta` o `{variable}_baja` (`temperatura_alta`, `temperatura_baja`, `humedad_alta`, `humedad_baja`; ver `ALERT_TYPES`). |
| `estado`          | `string`    | `activa`, `reconocida` o `resuelta` (ver `ALERT_STATUS` y el ciclo de vida de abajo). |
| `titulo`          | `string`    | Título legible, por ejemplo `Temperatura fuera de rango`.                    |
| `mensaje`         | `string`    | Descripción con el valor medido y el límite superado.                        |
| `medidoEn`        | `timestamp` | Momento de la medición que originó la alerta.                                |
| `creadaEn`        | `timestamp` | Fecha de creación de la alerta (server timestamp).                           |
| `resueltaEn`      | `timestamp` | Momento en que se resolvió (server timestamp). Solo existe si `estado` es `resuelta`. |
| `resueltaPor`     | `string`    | Quién la resolvió: `sistema` cuando la resuelve `evaluarUmbrales`. Solo existe si `estado` es `resuelta`. |
| `valorResolucion` | `number`    | Valor de la medición que provocó la resolución. Solo existe si `estado` es `resuelta`. |

### Ciclo de vida de una alerta

| Estado       | Significado                                                                  | Lo escribe |
| ------------ | ------------------------------------------------------------------------------ | ---------- |
| `activa`     | La condición fuera de rango se detectó y nadie la atendió todavía.             | `evaluarUmbrales` (al crearla) |
| `reconocida` | Un administrador u operador indicó desde la interfaz que la vio. La condición sigue sin resolverse. | Cliente (solo el campo `estado`, ver `firestore.rules`) |
| `resuelta`   | El valor volvió al rango aceptable (ver regla de histéresis).                  | `evaluarUmbrales` |

Flujo normal: `activa` → `reconocida` → `resuelta`. Reconocer es opcional: una
alerta `activa` también pasa directamente a `resuelta` si el valor se recupera.
Una alerta `reconocida` sigue considerándose abierta (el valor continúa fuera
de rango) hasta que el sistema la resuelve.

**Resolución automática e histéresis.** En cada medición, `evaluarUmbrales`
revisa las alertas abiertas (`activa` o `reconocida`) de la misma incubadora y
variable. Para evitar que un valor que oscila justo sobre el límite abra y
cierre alertas (y envíe un correo) en cada medición, la recuperación debe
superar un margen de seguridad:

- `margen = (maximo - minimo) * MARGEN_RESOLUCION`, con
  `MARGEN_RESOLUCION = 0.05` (5 % del rango). Si `maximo - minimo <= 0`, el
  margen es 0.
- Una alerta `*_alta` se resuelve cuando `valor <= maximo - margen`.
- Una alerta `*_baja` se resuelve cuando `valor >= minimo + margen`.
- Mientras el valor esté en la banda entre el límite y el límite menos el
  margen (por ejemplo, entre `maximo - margen` y `maximo`), la alerta sigue
  abierta y no se genera ninguna nueva.

Al resolverse, la alerta pasa a `estado: "resuelta"` y se escriben
`resueltaEn`, `resueltaPor: "sistema"` y `valorResolucion`. Todas las alertas
que se resuelven con una misma medición se actualizan en un único batch.

**Deduplicación.** Mientras exista una alerta abierta (`activa` o
`reconocida`) del mismo `tipo` para la misma incubadora y variable, no se crea
otra. Una alerta `resuelta` no bloquea: si la condición reaparece, se crea una
alerta nueva (y se envía un nuevo correo). Si el valor salta de un extremo al
otro del rango, la alerta `alta` se resuelve y se crea la `baja` (o al revés)
en la misma medición.

### Alertas de desconexión de dispositivos

Cuando un dispositivo deja de enviar señales, el Servicio de Integración IoT
(`iot-integration-service/lib/estado-conexion.js`, con Admin SDK) lo marca
`desconectado` y crea una alerta de `tipo: "dispositivo_desconectado"`
(`ALERT_TYPES.DEVICE_DISCONNECTED`). Al crearse, `notificarAlerta` envía el
correo, igual que con las alertas de umbral. Comparte colección y ciclo de vida
(`activa` → `reconocida` → `resuelta`) con ellas, pero sus campos son otros:

| Campo           | Tipo        | Descripción                                                                |
| --------------- | ----------- | ----------------------------------------------------------------------------- |
| `incubadoraId`  | `string`    | Incubadora del dispositivo (la toma del tópico MQTT o de `dispositivos/`).    |
| `dispositivoId` | `string`    | Dispositivo que dejó de comunicarse.                                          |
| `tipo`          | `string`    | `dispositivo_desconectado`.                                                   |
| `estado`        | `string`    | `activa` al crearse; luego `reconocida` o `resuelta`.                         |
| `titulo`        | `string`    | `Dispositivo desconectado`.                                                   |
| `mensaje`       | `string`    | `El dispositivo {dispositivoId} dejó de enviar señales hace más de {timeout} segundos.` |
| `ultimaSenalEn` | `timestamp` | Última señal (latido o medición) que vio el servicio antes de la caída. Si el dispositivo se recuperó al arrancar el servicio, es el momento del arranque. |
| `creadaEn`      | `timestamp` | Fecha de creación de la alerta (server timestamp).                            |
| `resueltaEn`    | `timestamp` | Solo existe si `estado` es `resuelta`.                                        |
| `resueltaPor`   | `string`    | `sistema`. Solo existe si `estado` es `resuelta`.                             |

No tiene `variable`, `valor`, `limite`, `medidoEn` ni `valorResolucion`. Sin
`variable`, la consulta de alertas abiertas de `evaluarUmbrales` (por
incubadora y variable) nunca la encuentra, así que la resolución por umbrales no
la afecta.

- **Deduplicación.** No se crea otra mientras el dispositivo tenga una de este
  tipo abierta (`activa` o `reconocida`).
- **Resolución.** La resuelve el propio Servicio de Integración IoT cuando el
  dispositivo lleva conectado de forma estable (60 segundos por defecto,
  `LATIDO_ESTABILIDAD_SEGUNDOS`), no en cuanto vuelve a dar señales: así un
  dispositivo con conexión intermitente no abre y cierra alertas (ni envía
  correos) en cada corte. Ver `docs/contrato-mqtt.md`.

## `ventiladores/{ventiladorId}` (Sprint 4)

Representa un ventilador de una incubadora. Es el documento que lee la Cloud
Function `enviarComandoVentilador` antes de crear una orden. Ningún cliente lo
escribe (ver `firestore.rules`): lo crea la Cloud Function `crearDispositivo`,
`guardarReglaAutomatizacion` cambia su `modoControl` y el Servicio de
Integración IoT actualiza el estado con Admin SDK cuando el ventilador lo
reporta (ver `docs/contrato-mqtt.md`).

| Campo          | Tipo     | Descripción                                                                 |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `incubadoraId` | `string` | Incubadora a la que pertenece (`incubadoras/{id}`). Se copia a cada orden.      |
| `dispositivoId`| `string` | Dispositivo físico asociado (`dispositivos/{id}`, tipo `ventilador`). Junto con `incubadoraId` arma el tópico MQTT del comando (ver `docs/contrato-mqtt.md`). Se copia a cada orden. |
| `modoControl`  | `string` | Uno de los valores de `FAN_CONTROL_MODE` (`manual`, `automatico`, `mixto`). `enviarComandoVentilador` solo acepta comandos manuales en `manual` y `mixto`. Nace en `manual`. Solo se cambia con `guardarReglaAutomatizacion` (ver `reglas_automatizacion`). |
| `estadoActual` | `string \| null` | Uno de los valores de `FAN_STATUS` (`encendido`, `apagado`). Nace en `null` (estado desconocido). El Servicio de Integración lo escribe cada vez que el ventilador publica su estado (`encendido: true` → `encendido`, `false` → `apagado`), haya o no una orden en curso. Una orden que vence sin confirmación no lo modifica. |
| `actualizadoEn`| `timestamp` | Último estado reportado por el ventilador (server timestamp, lo escribe el Servicio de Integración). No existe hasta el primer reporte. |
| `creadoEn`     | `timestamp` | Fecha de creación (server timestamp).                                       |

### Cómo se crean estos documentos

- **Ventiladores nuevos.** Al dar de alta un dispositivo de tipo `ventilador`,
  `crearDispositivo` crea `dispositivos/{id}` y `ventiladores/{id}` en un mismo
  batch: ambos documentos comparten el mismo id (relación 1 a 1) y nunca queda
  uno sin el otro. Valores iniciales: `modoControl: "manual"`,
  `estadoActual: null`, y `incubadoraId` / `dispositivoId` del dispositivo. Los
  sensores no generan documento en esta colección.
- **Ventiladores ya existentes.** Los dispositivos de tipo `ventilador` dados de
  alta antes de este cambio no tienen documento y `enviarComandoVentilador`
  responde `not-found` para ellos. Se corrigen una sola vez por entorno con
  `functions/scripts/crear-documentos-ventiladores.js` (idempotente: solo crea
  los que faltan y nunca sobrescribe uno existente).

  Orden obligatorio: **primero desplegar las Cloud Functions y después correr el
  script**. Si se corriera antes, un ventilador dado de alta entre ambos pasos
  quedaría sin documento hasta la próxima ejecución del script.

  ```bash
  cd functions

  # 1. Simulación: informa qué crearía, no escribe nada.
  GOOGLE_APPLICATION_CREDENTIALS="/ruta/a/service-account.json" \
  node scripts/crear-documentos-ventiladores.js --dry-run

  # 2. Revisar el proyecto impreso y el informe; recién entonces, ejecución real.
  GOOGLE_APPLICATION_CREDENTIALS="/ruta/a/service-account.json" \
  node scripts/crear-documentos-ventiladores.js --confirmar
  ```

  El script exige indicar exactamente uno de los dos modos (`--dry-run` o
  `--confirmar`): sin ninguno, con un argumento desconocido (por ejemplo un
  error de tipeo como `--dryrun`) o con ambos, se niega a correr y termina con
  código 2, sin escribir nada.

  Lo primero que imprime es `Proyecto de Firebase: <id>`: es el `project_id` de
  la cuenta de servicio apuntada por `GOOGLE_APPLICATION_CREDENTIALS`, es decir,
  el proyecto donde se va a escribir. Hay que verificar que sea el del entorno
  deseado antes de ejecutar con `--confirmar`. Si no se puede leer el
  `project_id` de esa clave, termina con código 2.

  Al final imprime un resumen (encontrados, creados, ya existían, omitidos y
  errores) y termina con código 1 si hubo errores. Un dispositivo ventilador
  sin `incubadoraId` válido se omite y se informa. Las credenciales se
  obtienen como en `docs/bootstrap-admin.md`.

## `reglas_automatizacion/{ventiladorId}` (Sprint 4)

Regla de histéresis que decide cuándo encender o apagar automáticamente un
ventilador según una variable ambiental de su incubadora. Hay **una regla por
ventilador**: el id del documento es el id del ventilador (`ventiladores/{id}`).
Ningún cliente la escribe (ver `firestore.rules`); solo se puede leer.

| Campo              | Tipo        | Descripción                                                                 |
| ------------------ | ----------- | ------------------------------------------------------------------------------ |
| `ventiladorId`     | `string`    | Ventilador al que aplica (igual al id del documento).                           |
| `incubadoraId`     | `string`    | Copiado de `ventiladores/{ventiladorId}`. La evaluación busca las reglas por incubadora y variable. |
| `variable`         | `string`    | Variable que se compara: `temperatura` o `humedad`.                             |
| `umbralActivacion` | `number`    | Valor desde el cual el ventilador debe estar encendido (`valor >= umbralActivacion`). |
| `margenHisteresis` | `number`    | Ancho de la banda de histéresis: el ventilador debe estar apagado desde `umbralActivacion - margenHisteresis` hacia abajo. Entre ambos límites no se hace nada. Siempre `>= 0.01` y `< umbralActivacion`. |
| `activa`           | `boolean`   | Si es `false`, la regla se conserva pero no se evalúa.                          |
| `actualizadoEn`    | `timestamp` | Última vez que se guardó la regla (server timestamp).                           |
| `actualizadoPor`   | `string`    | `uid` del administrador que la guardó.                                          |

### Cómo se escribe

Solo la Cloud Function callable `guardarReglaAutomatizacion` (únicamente
`administrador`). Recibe `{ ventiladorId, modoControl, variable,
umbralActivacion, margenHisteresis, activa }` y, **en un solo batch**, cambia
`ventiladores/{ventiladorId}.modoControl` y crea o reemplaza la regla. Es el
único camino para cambiar el modo de control de un ventilador: nadie más lo
escribe, por eso la función recibe el modo y no se separó en dos callables.
Como modo y regla se guardan juntos, un ventilador que pasa por esta función a
`automatico` o `mixto` queda con su regla guardada en la misma operación (la
regla podría borrarse después a mano con Admin SDK o desde la consola, y en
`mixto` puede estar inactiva).

- **`automatico` o `mixto`.** Se validan todos los campos de la regla: `variable`
  debe ser `temperatura` o `humedad`; `umbralActivacion` y `margenHisteresis`,
  números finitos con `margenHisteresis >= 0.01` y `margenHisteresis <
  umbralActivacion`; `activa`, booleano. El ventilador debe existir y tener
  `incubadoraId`. Si algo falla no se escribe nada.
  - *Margen mínimo de 0,01.* La evaluación redondea el límite de apagado a 6
    decimales; con márgenes ínfimos ese redondeo deshace la banda y el
    ventilador oscilaría como si no hubiera histéresis.
  - *Umbral positivo.* Como el margen es siempre positivo, `margenHisteresis <
    umbralActivacion` obliga a que el umbral también lo sea: no se pueden
    configurar reglas con umbrales negativos, cero o menores que el margen.
  - *Combinación prohibida: `automatico` con `activa: false`.* En modo
    `automatico` `enviarComandoVentilador` rechaza los comandos manuales, así que
    una regla inactiva dejaría al ventilador sin ninguna forma de control. Hay
    que usar `mixto` (acepta manuales y la regla puede estar inactiva) o
    `manual`.
  - El `ventiladorId` se usa como id de documento: se rechazan los que contienen
    `/`, son `.` o `..`, o tienen la forma `__...__`.
- **`manual`.** Solo cambia el modo. Los demás campos se ignoran y la regla
  guardada se conserva (sin evaluarse mientras el modo sea `manual`).

### Ciclo de vida

La regla se crea la primera vez que el ventilador pasa a `automatico` o
`mixto`. A partir de ahí solo se reemplaza con cada guardado; no se borra:
volver a `manual` la deja guardada para reutilizarla. En modo `automatico` el
ventilador solo acepta órdenes automáticas (`enviarComandoVentilador` rechaza las
manuales); en `mixto` acepta ambas.

## `ordenes_ventilador/{ordenId}` (Sprint 4)

Cada orden es una solicitud de encender o apagar un ventilador. La crean dos
caminos, ambos con estado `pendiente`: la Cloud Function `enviarComandoVentilador`
(órdenes manuales, pedidas por un usuario) y `evaluarAutomatizacion`, que corre
dentro de `procesarMedicion` (órdenes automáticas, ver más abajo). El Servicio
de Integración IoT la toma, publica el comando MQTT y actualiza su estado. El
cliente solo puede leerlas (ver `firestore.rules`).

| Campo              | Tipo        | Descripción                                                                 |
| ------------------ | ----------- | ------------------------------------------------------------------------------ |
| `ventiladorId`     | `string`    | Ventilador destino (`ventiladores/{id}`).                                       |
| `incubadoraId`     | `string`    | Copiado de `ventiladores/{ventiladorId}`; el Servicio de Integración lo usa para el tópico MQTT. |
| `dispositivoId`    | `string`    | Copiado de `ventiladores/{ventiladorId}`; el Servicio de Integración lo usa para el tópico MQTT. |
| `accionSolicitada` | `string`    | `encender` o `apagar` (`FAN_ACTIONS.TURN_ON` / `FAN_ACTIONS.TURN_OFF`).         |
| `origen`           | `string`    | Quién generó la orden: `manual` si la crea `enviarComandoVentilador`, `automatico` si la crea `evaluarAutomatizacion`. |
| `estado`           | `string`    | Estado de la orden (ver tabla de abajo).                                        |
| `solicitadoPor`    | `string`    | `uid` del usuario que envió el comando, o `"sistema"` en las órdenes automáticas. |
| `creadaEn`         | `timestamp` | Fecha de creación (server timestamp). El Servicio de Integración descarta las órdenes pendientes demasiado antiguas. |
| `enviadaEn`        | `timestamp` | Momento en que el Servicio de Integración pasó la orden a `enviada`, justo antes de publicar el comando en MQTT. El timeout de confirmación se cuenta desde aquí. |
| `ejecutadaEn`      | `timestamp` | Momento en que el servicio registró la confirmación del dispositivo (estado `ejecutada`). Solo existe en órdenes ejecutadas. |
| `actualizadaEn`    | `timestamp` | Último cambio de `estado` hecho por el Servicio de Integración.                 |
| `error`            | `string`    | Motivo, cuando el estado es `fallida` o `expirada`.                             |

### Estados de una orden

Vocabulario basado en `COMMAND_STATUS` (`frontend/src/utils/constants.js`),
ampliado con `enviando` y `expirada`, que usa el Servicio de Integración:

| Estado       | Significado                                                                  | Lo escribe |
| ------------ | ------------------------------------------------------------------------------ | ---------- |
| `pendiente`  | Orden creada, todavía no tomada por el Servicio de Integración.                | `enviarComandoVentilador` o `evaluarAutomatizacion` |
| `enviando`   | El Servicio de Integración reclamó la orden (transacción `pendiente` → `enviando`); todavía no se escribió `enviada`. Evita doble publicación. Si el proceso muere en este estado, la orden queda `enviando` (el barrido solo mira `enviada`; ver `docs/contrato-mqtt.md`). | Servicio de Integración |
| `enviada`    | El servicio ya reclamó la orden y está por publicar el comando, o ya lo publicó (`enviadaEn`). Se escribe antes de publicar; no garantiza la entrega. | Servicio de Integración |
| `ejecutada`  | El dispositivo confirmó el cambio por `.../estado` (`ejecutadaEn`).             | Servicio de Integración |
| `fallida`    | La orden es inválida, no pudo publicarse, o fue enviada y el dispositivo no la confirmó a tiempo (ver `error`; el timeout es `ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS`, 30 s por defecto). | Servicio de Integración |
| `expirada`   | Seguía `pendiente` pasado el tiempo máximo (`ORDEN_MAX_ANTIGUEDAD_SEGUNDOS`; se evalúa al reclamarla, no mientras el servicio o MQTT están caídos) y no se envió, para no accionar un ventilador con una orden vieja. | Servicio de Integración |

Flujo normal: `pendiente` → `enviando` → `enviada` → `ejecutada`; las
alternativas finales son `fallida` y `expirada`.

### Órdenes automáticas: `evaluarAutomatizacion`

Función auxiliar (no es una Cloud Function) que `procesarMedicion` ejecuta
después de guardar cada medición y de evaluar los umbrales. Aplica las reglas de
`reglas_automatizacion` y crea órdenes `automatico`.

- **Dónde corre y aislamiento.** Tiene su propio `try/catch`: si falla, se
  registra el error y la medición ya guardada no se ve afectada. Dentro, cada
  regla se evalúa por separado: el fallo de una (por ejemplo una escritura
  rechazada) se registra y no frena a las demás. Puede haber más de una regla
  activa para la misma incubadora y variable (distintos ventiladores).
- **Qué reglas evalúa.** Una consulta por `incubadoraId` y `variable`; las
  reglas con `activa` distinto de `true` se descartan en memoria. Se ignora el
  ventilador sin documento o en modo `manual` (se evalúa en `automatico` y
  `mixto`).
- **Histéresis.** Con `valor >= umbralActivacion` el estado deseado es
  `encendido`; con `valor <= umbralActivacion - margenHisteresis`, `apagado`;
  entre ambos límites no se hace nada. Ambos bordes son inclusivos. El límite de
  apagado se redondea a 6 decimales antes de comparar para absorber el error de
  punto flotante (`0.3 - 0.1` da `0.19999999999999998`): un valor medido
  exactamente en el límite cuenta como tal. Por eso el margen mínimo es 0,01.
- **`estadoActual`.** Si ya es el estado deseado no se crea orden. Si es `null`
  (desconocido, como nace) cuenta como distinto del deseado.
- **Cooldown y ventana de deduplicación.** Se miran las últimas 10 órdenes del
  ventilador (`ventiladorId` + `creadaEn` descendente, índice existente). Una
  orden de la **misma acción** impide crear otra si se creó hace menos de **120 s**
  (en cualquier estado, también `fallida`, `expirada` o `ejecutada`) o si sigue
  en curso (`pendiente`, `enviando` o `enviada`) y se creó hace menos de
  **300 s**. Así no se genera una orden por medición mientras `estadoActual`
  no se actualiza, los reintentos tras un fallo quedan espaciados y una orden
  varada deja de bloquear la acción pasados 5 minutos. Una orden sin `creadaEn`
  no aparece en la consulta ordenada (Firestore excluye los documentos sin el
  campo del `orderBy`), así que no se ve; solo se trata como reciente una
  `creadaEn` presente que no sea un timestamp. Una orden de la acción contraria
  nunca bloquea. Los 120 s superan lo que tarda una orden sana en resolverse (el
  Servicio de Integración expira las `pendiente` **al reclamarlas** a los 60 s
  y marca `fallida` las `enviada` que no se confirman en 30 s, más hasta 10 s
  del barrido: una orden sana termina en ~100 s como máximo; mientras el
  servicio o MQTT están caídos las `pendiente` no se expiran).
- **El cooldown es un tiempo mínimo entre ciclos de la misma acción.** Es una
  decisión de diseño que protege el motor del ventilador, no solo una
  deduplicación. Ejemplo: se pide apagar en t=0, encender en t=10 y la
  medición de t=30 vuelve a necesitar apagar: esa nueva orden `apagar` queda
  diferida hasta t=120 (la orden `apagar` de t=0 sigue dentro del cooldown). Se
  recupera sola con la primera medición posterior al cooldown que siga fuera de
  banda.
- **Atomicidad.** La lectura de las órdenes recientes y la creación de la nueva
  van en una transacción de Firestore: dos mediciones simultáneas no crean dos
  órdenes iguales (la segunda se reintenta y ve la orden de la primera).
- **Costo por medición.** Una consulta de reglas siempre. Solo si hay una regla
  activa y el valor queda fuera de la banda se leen el documento del ventilador
  y las 10 órdenes recientes, y solo si hace falta se escribe una orden.
- **Límites conocidos.**
  - Pueden coexistir órdenes de acciones contrarias (por ejemplo una `encender`
    en curso y una `apagar` nueva); el ventilador recibirá ambas en orden.
  - En modo `mixto` una orden manual puede ser revertida por la automática en la
    siguiente medición fuera de banda, si ya pasó el cooldown.
  - Una orden manual de la misma acción también cuenta para el cooldown y la
    ventana (la deduplicación no distingue el `origen`).
  - Si el ventilador no reporta su estado (dispositivo apagado o sin
    comunicación), `estadoActual` no se actualiza y la automatización pide a lo
    sumo una orden por acción cada 120 s si terminan, o cada 300 s si quedan
    varadas.
  - La atomicidad se apoya en que la consulta dentro de la transacción impide
    inserciones concurrentes; no se probó contra Firestore real.

## `estadisticas_diarias/{incubadoraId}_{variable}_{fecha}` (Sprint 5)

Resumen de las mediciones de **un día** de una variable de una incubadora. Las
pantallas de estadísticas (semana y mes incluidas) se arman a partir de estos
documentos, para no leer las ~10.800 mediciones diarias por variable. Los
escribe únicamente una Cloud Function programada con Admin SDK; el cliente solo
los lee. Las funciones puras que calculan y combinan estos valores están en
`functions/lib/estadisticas.js`.

| Campo          | Tipo     | Descripción                                                                 |
| -------------- | -------- | ---------------------------------------------------------------------------- |
| `incubadoraId` | `string` | Incubadora (`incubadoras/{id}`).                                             |
| `variable`     | `string` | `temperatura` o `humedad`.                                                   |
| `fecha`        | `string` | Día calculado, `YYYY-MM-DD`, en la zona horaria del proyecto.                |
| `cantidad`     | `number` | Cantidad de mediciones válidas del día. **Extensión del DDS** (ver abajo).   |
| `promedio`     | `number` | Promedio de los valores del día.                                             |
| `maximo`       | `number` | Valor máximo del día.                                                        |
| `minimo`       | `number` | Valor mínimo del día.                                                        |
| `desviacion`   | `number` | Desviación estándar **poblacional** (se divide por `cantidad`, no por n − 1). |
| `calculadoEn`  | `timestamp` | Cuándo se calculó (server timestamp); se actualiza si se recalcula el día. |

El id del documento es `{incubadoraId}_{variable}_{fecha}` (lo arma
`idEstadisticaDiaria`), así que volver a calcular un día **reemplaza** el mismo
documento y no crea duplicados. Un día sin mediciones no genera documento.

### Por qué existe `cantidad` (extensión del DDS)

El DDS define este documento sin `cantidad`. Sin ella no se puede obtener la
estadística de una semana o un mes a partir de los días: el promedio de los
promedios diarios es incorrecto cuando los días tienen distinta cantidad de
mediciones (por ejemplo, un día en que el dispositivo estuvo desconectado), y el
promedio de las desviaciones también. `combinarEstadisticas` usa `cantidad`
como peso:

- `cantidad` total `N` = suma de las `cantidad` de cada día.
- Promedio combinado `μ` = suma de `cantidad · promedio` / `N`.
- Varianza combinada = suma de `cantidad · (desviacion² + (promedio − μ)²)` / `N`;
  la desviación combinada es su raíz cuadrada (poblacional, igual que la diaria).
- Máximo y mínimo: el mayor y el menor de los días.

Los documentos que no tengan una `cantidad` entera positiva se descartan al
combinar, en silencio: conviene que quien los consuma sepa que un documento sin
ese campo no suma.

### Zona horaria del día

El corte de «día» usa la zona `America/Bogota` por defecto. Es un supuesto
todavía no confirmado con el equipo; puede cambiarse con la variable de entorno
`PROJECT_TIME_ZONE` (valor de la base de datos de zonas horarias de IANA).

## Notas generales

- Las colecciones `auditoria` y `config_sistema` están enumeradas en
  `COLLECTIONS` para uso futuro; este documento se irá completando a medida que
  se implementen.
- Ninguna de estas colecciones debe recibir escrituras directas desde el
  cliente para datos que representen el estado real del sistema (mediciones,
  alertas, estado de dispositivos): esas escrituras las realiza el Servicio
  de Integración IoT o una Cloud Function, nunca el cliente web.
