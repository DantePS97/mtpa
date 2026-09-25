# Plan de pruebas — Simulador de dispositivo MQTT

Casos de prueba para el Servicio de Integración IoT
(`iot-integration-service/index.js`) y el simulador de dispositivo
(`iot-integration-service/simulator/simulador.js`) implementados en el
Sprint 2.

Precondición general: existe un archivo `iot-integration-service/.env`
(no versionado, copiado de `.env.example`) completo con las credenciales
reales del cluster de desarrollo de HiveMQ Cloud (ver
`docs/broker-mqtt.md`), y se ejecutó `npm install` dentro de
`iot-integration-service/`.

> **Estado de esta tarea:** estos casos requieren las credenciales reales
> del broker MQTT (HiveMQ Cloud), que no están disponibles en este cambio
> (ver limitaciones al final de este documento). Quedan documentados como
> **pendientes de prueba manual** por quien sí tenga acceso al `.env` con
> las credenciales del cluster `mtpa-dev`.

## 1. El simulador se conecta sin errores

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 1.1 | Ejecutar `npm run simulator` (o `node simulator/simulador.js`) dentro de `iot-integration-service/` con un `.env` válido. | En consola se loguea `[simulador] Conectado a <host>:<puerto>` y `[simulador] Simulando incubadora "...", sensor "..." y ventilador "..."`. No se lanzan excepciones. |
| 1.2 | Ejecutar el simulador con `MQTT_HOST`, `MQTT_USERNAME` o `MQTT_PASSWORD` vacíos (por ejemplo, usando `.env.example` sin completar). | El proceso termina inmediatamente con el mensaje de error "Faltan variables de entorno obligatorias..." y código de salida distinto de 0, sin intentar conectarse. |
| 1.3 | Ejecutar el simulador con credenciales incorrectas (usuario/contraseña inválidos para el cluster). | El cliente MQTT emite el evento `error` (logueado como `[simulador] Error de conexión MQTT: ...`) y reintenta la conexión según `reconnectPeriod` (5s), sin crashear el proceso. |
| 1.4 | Con el simulador conectado, cortar la conexión a internet unos segundos y restablecerla. | Se loguea `[simulador] Reconectando al broker MQTT...` y, al restablecerse la red, el simulador vuelve a conectarse y a publicar sin necesidad de reiniciar el proceso manualmente. |

## 2. Publica mediciones y latidos en el tópico correcto

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 2.1 | Con el simulador corriendo, suscribirse (por ejemplo con `mosquitto_sub` o el Web Client de HiveMQ Cloud) a `mtpa-dev/+/sensores/+/medicion`. | Se recibe un mensaje JSON como máximo cada 10 segundos (actualmente cada 8s, ver `INTERVALO_PUBLICACION_MS`), con `incubadoraId`, `dispositivoId`, `temperatura` y `humedad`. |
| 2.2 | Observar varios mensajes de medición consecutivos. | Los valores de `temperatura` y `humedad` varían de un mensaje al siguiente (caminata aleatoria acotada), sin quedar fijos, y se mantienen dentro de rangos físicamente plausibles (35–40 °C, 40–70 % en esta implementación). |
| 2.3 | Suscribirse a `mtpa-dev/+/dispositivos/+/latido`. | Se reciben latidos del sensor y del ventilador simulados en cada ciclo de publicación, cada uno con `incubadoraId`, `dispositivoId` y `timestamp`. |
| 2.4 | Verificar el tópico exacto de los mensajes recibidos en 2.1/2.3 contra `docs/contrato-mqtt.md`. | Los tópicos siguen exactamente `mtpa-dev/{incubadoraId}/sensores/{dispositivoId}/medicion` y `mtpa-dev/{incubadoraId}/dispositivos/{dispositivoId}/latido`. |

## 3. El Servicio de Integración los recibe (logs)

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 3.1 | Ejecutar `npm start` (`index.js`) del Servicio de Integración IoT, y por separado el simulador, ambos apuntando al mismo `.env`/cluster. | El servicio loguea `[iot-integration-service] Conectado a <host>:<puerto>` y luego `[iot-integration-service] Suscripto a "mtpa-dev/+/sensores/+/medicion" y "mtpa-dev/+/ventiladores/+/estado"`. |
| 3.2 | Dejar ambos procesos corriendo unos minutos. | Por cada medición publicada por el simulador, el servicio loguea `[iot-integration-service] Mensaje en "mtpa-dev/.../sensores/.../medicion": { ...payload parseado... }`, con el JSON ya parseado (no el string crudo). |
| 3.3 | Publicar manualmente un mensaje no-JSON en un tópico de medición (por ejemplo con `mosquitto_pub -m "no-es-json"`). | El servicio loguea una advertencia ("no es JSON válido, se loguea en crudo") en vez de crashear. |

## 4. Responde a un comando de ventilador

| Caso | Pasos | Resultado esperado |
| ---- | ----- | -------------------- |
| 4.1 | Con el simulador corriendo, publicar en `mtpa-dev/{incubadoraId}/ventiladores/{dispositivoId}/comando` el payload `{"accion":"encender"}` (usando los ids configurados por defecto o por variables `SIMULADOR_INCUBADORA_ID`/`SIMULADOR_VENTILADOR_ID`). | El simulador loguea la publicación del nuevo estado en `.../estado` con `encendido: true` y `velocidad` mayor a 0. |
| 4.2 | Publicar `{"accion":"apagar"}` en el mismo tópico de comando. | El simulador responde en `.../estado` con `encendido: false` y `velocidad: 0`. |
| 4.3 | Publicar `{"accion":"establecer_velocidad","velocidad":75}`. | El simulador responde en `.../estado` con `velocidad: 75` y `encendido: true`. |
| 4.4 | Publicar `{"accion":"establecer_velocidad","velocidad":150}` (fuera de rango). | El simulador acota el valor a `velocidad: 100` (no publica un valor fuera de 0–100). |
| 4.5 | Publicar un comando con una acción desconocida (por ejemplo `{"accion":"bailar"}`). | El simulador loguea una advertencia ("Acción de comando desconocida") y no publica ningún cambio de estado. |
| 4.6 | El Servicio de Integración IoT (`index.js`), suscripto a `mtpa-dev/+/ventiladores/+/estado`, recibe los mensajes de 4.1 a 4.3. | Se loguean como `[iot-integration-service] Mensaje en "mtpa-dev/.../ventiladores/.../estado": { ...payload... }`. |

## Notas y limitaciones

- Ninguno de los casos anteriores pudo ejecutarse en este cambio: no se
  cuenta con las credenciales reales del cluster de HiveMQ Cloud
  (`mtpa-dev`), que según `docs/broker-mqtt.md` viven únicamente en el
  `.env` local de quien las necesite. Queda como **prueba manual
  pendiente** para quien sí las tenga.
- `iot-integration-service/` tampoco tiene sus dependencias (`mqtt`,
  `firebase-admin`) instaladas en este cambio (no se ejecutó `npm install`
  dentro de esa carpeta), por lo que ni siquiera se validó que el código
  levante localmente contra un mock; solo se verificó su sintaxis
  (`node --check`).
- Una vez que se ejecuten estos casos manualmente, se recomienda
  automatizar al menos 2.1–2.4 y 4.1–4.5 con un script de prueba que
  publique/verifique mensajes contra un broker MQTT de pruebas (por
  ejemplo, un broker Mosquitto local en Docker), sin depender del cluster
  real de HiveMQ Cloud para cada corrida de CI.
