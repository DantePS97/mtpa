# Broker MQTT de referencia — M.T.P.A.

## Proveedor elegido

**HiveMQ Cloud** (nivel gratuito "Serverless").

Elegido según el ERS Anexo C, punto 7 (proveedor de referencia en su nivel gratuito/de pruebas, sujeto a validación posterior).

## Cluster de desarrollo (mtpa-dev)

| Campo | Valor |
|---|---|
| Host | `f425728adc6b44e395da4d038b263422.s1.eu.hivemq.cloud` |
| Puerto | `8883` (MQTT sobre TLS) |
| Usuario / contraseña | **No se documentan acá.** Viven solo como variables de entorno locales de quien los necesite (ver sección "Dónde viven las credenciales" más abajo). |

## Límites del nivel gratuito

| Límite | Valor (Serverless Free) |
|---|---|
| Conexiones simultáneas | 100 |
| Mensajes / mes | ~10 millones (según cuota publicada por HiveMQ al momento de creación de este documento — **verificar el valor vigente en la consola** antes de asumirlo) |
| Retención de sesión | Estándar del plan free |

> Antes de escalar a más de una instalación piloto, revisar si el consumo real se acerca a estos límites (ver riesgo 6.1 del Plan de Trabajo — "Costos no previstos por superar el nivel gratuito").

## Namespace de tópicos por entorno

Todos los entornos comparten el mismo cluster (para simplificar costos en esta primera versión, DDS sección 8.1), separados por prefijo:

- Desarrollo: `mtpa-dev/...`
- Staging: `mtpa-staging/...` (se configura en un sprint posterior)
- Producción: `mtpa-prod/...` (se configura en un sprint posterior)

Los tópicos completos siguen el contrato definido en `docs/contrato-mqtt.md`, por ejemplo:
`mtpa-dev/{incubadoraId}/sensores/{dispositivoId}/medicion`

## Dónde viven las credenciales

**Nunca se versionan en el repositorio.** Viven como variables de entorno:

- Local: archivo `.env` (gitignoreado) en `iot-integration-service/`, siguiendo `iot-integration-service/.env.example`.
- Quien necesite las credenciales de desarrollo las pide al responsable de esta tarea por un canal seguro (no por texto plano en el chat del equipo si se puede evitar — usar el gestor de contraseñas del equipo si existe).

Variables esperadas (ver `.env.example`):

```
MQTT_HOST=f425728adc6b44e395da4d038b263422.s1.eu.hivemq.cloud
MQTT_PORT=8883
MQTT_USERNAME=<usuario del cluster>
MQTT_PASSWORD=<contraseña del cluster>
MQTT_TOPIC_PREFIX=mtpa-dev
```

## Cómo pedir credenciales nuevas para otro entorno

1. Entrar a la consola de HiveMQ Cloud con la cuenta del equipo.
2. Cluster → Access Management → Manage Credentials.
3. Crear un usuario nuevo con permisos de publish/subscribe restringidos al prefijo de tópicos del entorno correspondiente (`mtpa-staging/#`, `mtpa-prod/#`).
4. Nunca reutilizar las credenciales de desarrollo en staging/producción.

## Prueba manual de conexión

Antes de dar esta tarea por terminada, confirmar que se puede publicar y suscribir al cluster:

```bash
# Requiere mosquitto-clients instalado (mosquitto_pub / mosquitto_sub)
mosquitto_sub -h f425728adc6b44e395da4d038b263422.s1.eu.hivemq.cloud -p 8883 --capath /etc/ssl/certs -u <usuario> -P <contraseña> -t "mtpa-dev/#" -v
mosquitto_pub -h f425728adc6b44e395da4d038b263422.s1.eu.hivemq.cloud -p 8883 --capath /etc/ssl/certs -u <usuario> -P <contraseña> -t "mtpa-dev/incubadora-test/dispositivos/sensor-test/latido" -m "ping"
```

Si no hay `mosquitto-clients` instalado, se puede usar el cliente web de prueba que ofrece la consola de HiveMQ Cloud.

---

**Estado de esta tarea:** ✅ completa. Cluster de desarrollo creado, usuario de servicio configurado en "Manage Credentials", y conexión confirmada con el Web Client de HiveMQ Cloud: se publicó un mensaje en `mtpa-dev/test/ping` y se recibió correctamente estando suscripto a `mtpa-dev/#`.
