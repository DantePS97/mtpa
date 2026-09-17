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

## Notas generales

- Las colecciones `incubadoras`, `dispositivos`, `mediciones`, `umbrales`,
  `alertas`, `ventiladores`, `reglas_automatizacion`, `ordenes_ventilador`,
  `estadisticas_diarias`, `auditoria` y `config_sistema` están enumeradas en
  `COLLECTIONS` para uso futuro (Sprint 2 en adelante); este documento se irá
  completando a medida que se implementen.
- Ninguna de estas colecciones debe recibir escrituras directas desde el
  cliente para datos que representen el estado real del sistema (mediciones,
  alertas, estado de dispositivos): esas escrituras las realiza el Servicio
  de Integración IoT o una Cloud Function, nunca el cliente web.
