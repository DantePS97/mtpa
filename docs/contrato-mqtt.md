# Contrato MQTT — M.T.P.A.

Este documento define la convención de tópicos MQTT que usará el Servicio de
Integración IoT (Node.js, Sprint 2) para comunicarse con los dispositivos
físicos de cada incubadora. El cliente web **no** se conecta nunca
directamente al broker MQTT: todo pasa por ese servicio, que traduce los
mensajes en escrituras a Firestore (y viceversa, para los comandos).

## Convención de tópicos

Todos los tópicos usan el prefijo `mtpa/` seguido del identificador de la
incubadora (`incubadoraId`) y del identificador del dispositivo
(`dispositivoId`), ambos coincidentes con los ids usados en Firestore
(`incubadoras/{incubadoraId}`, `dispositivos/{dispositivoId}`).

| Tópico                                                         | Dirección                | Descripción                                                                 |
| ---------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------ |
| `mtpa/{incubadoraId}/sensores/{dispositivoId}/medicion`           | Dispositivo → Servicio   | Publica una nueva medición (temperatura y/o humedad) del sensor.               |
| `mtpa/{incubadoraId}/ventiladores/{dispositivoId}/comando`        | Servicio → Dispositivo   | Envía un comando al ventilador (encender, apagar, establecer velocidad).       |
| `mtpa/{incubadoraId}/ventiladores/{dispositivoId}/estado`         | Dispositivo → Servicio   | El ventilador reporta su estado actual (encendido/apagado, velocidad).         |
| `mtpa/{incubadoraId}/dispositivos/{dispositivoId}/latido`         | Dispositivo → Servicio   | Señal de "estoy vivo" (*heartbeat*) enviada periódicamente por cualquier dispositivo. |

## Detección de desconexión

Cada dispositivo debe publicar un mensaje en
`mtpa/{incubadoraId}/dispositivos/{dispositivoId}/latido` de forma periódica.
El Servicio de Integración IoT debe marcar el campo `estadoConexion` del
documento `dispositivos/{dispositivoId}` en Firestore como `"desconectado"`
(ver `DEVICE_STATUS.DISCONNECTED` en `frontend/src/utils/constants.js`) si no
se recibe un latido en más de **30 segundos**
(`SYSTEM_INTERVALS.COMMUNICATION_TIMEOUT_SECONDS`).

Esa misma constante (`ultimaComunicacionEn` en el modelo de datos, ver
`docs/modelo-datos.md`) se actualiza con cada latido o medición recibida, y
es la que el servicio usa para calcular si el umbral de 30 segundos fue
superado.

## Notas

- El payload exacto de cada mensaje (formato JSON, campos) se especificará
  junto con la implementación del Servicio de Integración IoT en el Sprint 2.
  Este documento fija únicamente la convención de nombres de tópicos y la
  regla de desconexión, que ya forman parte del contrato entre dispositivos
  y backend.
- Ningún cliente del frontend web publica ni se suscribe a estos tópicos
  directamente; el frontend solo lee el estado ya reflejado en Firestore.
