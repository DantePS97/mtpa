# Ejecución local con emuladores

Cómo se montó el entorno con el que se ejecutaron, el 2026-10-18, los planes
`plan-pruebas-control-ventiladores.md` y `plan-pruebas-automatizacion.md`
(commit `0ec7866`). Es un entorno **100 % local**: no toca Firebase real ni
HiveMQ Cloud, y sus resultados valen para el código, no para el despliegue real
(ver 9).

**Para repetirlo no hace falta rearmarlo a mano:** el kit
[`tools/qa-local/`](../../tools/qa-local/README.md) contiene la configuración de
los emuladores, la verificación de seguridad, la siembra y los pasos de
principio a fin. Este documento conserva el porqué de cada decisión y lo que no
cubre el kit.

## 1. Componentes

| Componente | Cómo | Puerto |
| ---------- | ---- | ------ |
| Emuladores de Auth, Firestore y Functions | `firebase emulators:start --config ../../firebase.emulators.json --project demo-mtpa`, ejecutado desde `tools/qa-local/` (ver su README), con las reglas, los índices y las funciones del repositorio | 9099, 8080, 5001 |
| Broker MQTT | `aedes` (npm) con TLS autofirmado, ver 4 | 8883 |
| Servicio de Integración | `npm start` en `iot-integration-service/` | — |
| Simulador | `npm run simulator` en `iot-integration-service/` | — |
| Frontend | `npx vite --host 127.0.0.1` (servidor de desarrollo, sin `build`) | 5173 |

Versiones: Node 24, Java 25, `firebase-tools` 15.28.2, `firebase-admin` 12.7.0.
Los datos del emulador viven en memoria: al reiniciarlo hay que volver a sembrar.

## 2. Por qué `demo-mtpa` y no `mtpa-dev`

El `.firebaserc` del repositorio apunta al proyecto real `mtpa-dev`. El prefijo
`demo-` es la convención de Firebase para proyectos que solo existen en los
emuladores: no se espera que exista un proyecto en la nube con ese id (no se
verificó), así que en principio no hay nada real a lo que apuntar por error. Por
eso se pasa siempre `--project demo-mtpa` y nunca se ejecuta `firebase deploy`.

Esa convención no sustituye las comprobaciones de la sección 3, que son la
protección real: durante la
ejecución se verificó, antes de arrancar cada proceso, que
`GOOGLE_APPLICATION_CREDENTIALS` no estuviera definida y que los hosts de los
emuladores sí lo estuvieran. No se contrastó con la documentación de Firebase
qué ocurre exactamente si el código intenta usar un servicio no emulado.

## 3. Variables de entorno

El kit las define con `source tools/qa-local/entorno.sh` y las comprueba con
`tools/qa-local/verificar-entorno.js`. Para el servicio, el simulador y
cualquier script de Node:

| Variable | Valor |
| -------- | ----- |
| `GCLOUD_PROJECT` | `demo-mtpa` |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` | `127.0.0.1:8080`, `127.0.0.1:9099` |
| `MQTT_HOST`, `MQTT_PORT`, `MQTT_TOPIC_PREFIX` | `localhost`, `8883`, `mtpa-dev` (el valor por defecto) |
| `MQTT_USERNAME`, `MQTT_PASSWORD` | las del broker local (inventadas) |
| `PROCESAR_MEDICION_URL` | `http://127.0.0.1:5001/demo-mtpa/us-central1/procesarMedicion` |
| `PROCESAR_MEDICION_TOKEN` | un valor inventado, igual al `INTEGRATION_SERVICE_TOKEN` de las funciones |
| `NODE_EXTRA_CA_CERTS` | ruta del certificado autofirmado del broker |

**No** debe estar definida `GOOGLE_APPLICATION_CREDENTIALS`: sin ella el Admin
SDK no tiene credenciales reales y solo puede hablar con los emuladores. La
verificación aborta si `GCLOUD_PROJECT` no empieza con `demo-`, si faltan los
hosts de los emuladores o si esa variable existe (su única excepción es el
script de migración, ver 9). En la ejecución original se quitaban los
`*_EMULATOR_HOST` al arrancar los emuladores porque los define el CLI; con el
kit no hace falta, arrancan igual con ellos definidos.

El token de las funciones va en un archivo que git ignora: `functions/.env.local`
en la ejecución original; el kit usa `functions/.env.demo-mtpa`, que las
funciones solo leen al emular `demo-mtpa`. No usar `functions/.secret.local` ni
`frontend/.env`: no están ignorados (hallazgo H-02 de los planes).

## 4. Broker MQTT local

`iot-integration-service/lib/mqtt-client.js` fuerza `mqtts://` con
`rejectUnauthorized: true`, así que el broker escucha en TLS con un certificado
autofirmado (`openssl req -x509`, CN y SAN `localhost` y `127.0.0.1`,
`CA:TRUE`) que los procesos de Node confían con `NODE_EXTRA_CA_CERTS`. Se usó
`aedes` porque no había un daemon de Docker para `eclipse-mosquitto`; sirve
cualquier broker con TLS y usuario y clave. Los tópicos usan el prefijo
`mtpa-dev`, no `mtpa` (ver `contrato-mqtt.md`). El kit no versiona el broker
(requiere una dependencia que el repositorio no tiene): su README da la receta.

## 5. Configuración de los emuladores

El `firebase.json` del repositorio no define emuladores y su proyecto por
defecto es el real (`mtpa-dev`). En la ejecución original se usó un
`firebase.json` propio, fuera del repositorio, y una junction `mklink /J` hacia
el código, porque el CLI exige que las reglas, los índices y `functions/` estén
dentro del directorio de la configuración. El kit lo resuelve con
`firebase.emulators.json` en la raíz del repositorio (junto al `firebase.json`,
que no se toca), pasado con `--config` y con `--project demo-mtpa` (sin esa
bandera el CLI usaría el proyecto real de `.firebaserc`): no hace falta ninguna
junction. No puede vivir dentro de `tools/qa-local/`: desde ahí el
CLI rechaza `../../firestore.rules` ("is outside of project directory").

## 6. Parche local del frontend

`frontend/src/services/firebase.js` no se conecta a emuladores. Se aplicó un
parche temporal, no versionado y revertido al terminar: importa
`connectAuthEmulator`, `connectFirestoreEmulator` y `connectFunctionsEmulator`
y los invoca (Auth 9099, Firestore 8080, Functions 5001) cuando
`import.meta.env.VITE_USE_EMULATORS === "true"`. Se acompaña de
`frontend/.env.local` (ignorado por `*.local`) con esa variable y valores
falsos de `VITE_FIREBASE_*`, con `demo-mtpa` como proyecto. El kit no incluye el
parche: su README describe el cambio (paso 8).

## 7. Siembra de datos

Con el Admin SDK apuntando a los emuladores se crearon tres usuarios en Auth
(`administrador`, `operador` y `consulta`), con el custom claim `role` y su
documento `usuarios/{uid}` con `activo: true`. Las claves son inventadas y no
se guardan en el repositorio. Las incubadoras, los dispositivos y los
ventiladores se crearon desde la interfaz y con las callables
`gestionarIncubadora` y `crearDispositivo`.

`tools/qa-local/seed.js` reproduce lo mínimo (los tres usuarios, una incubadora
activa, un sensor de temperatura y dos ventiladores) reutilizando
`crear-primer-admin.js` y las callables reales. **Siguen sin versionarse** los
scripts de apoyo de la ejecución: el cliente de llamadas por HTTP, los
observadores del panel y los datos específicos de cada caso (por ejemplo, las
incubadoras "QA CV" y "QA AU" de los planes).

## 8. Problema del emulador con `admin.firestore.FieldValue` (H-03)

Con `firebase-tools` 15.28.2 y `firebase-admin` 12.7.0 el emulador de Functions
devuelve `admin.firestore.FieldValue` como `undefined`: reemplaza `firebase-admin`
por un `Proxy` que aplica `bind` a toda propiedad función que no sea un
constructor, y el getter `firestore` es una función flecha con propiedades
estáticas (`FieldValue`, `Timestamp`) que `bind` pierde. Toda callable que
escribe con `serverTimestamp()` falla con `INTERNAL`. En producción no ocurre.

**Workaround, mientras no se corrija en el código** (el seed del kit necesita la
corrección: ver su README): en el `node_modules` local (no versionado), editar
`functions/node_modules/firebase-admin/lib/app/firebase-namespace.js` y cambiar
la función flecha que devuelve el getter `firestore` por una `function` común.
No afectó a ningún resultado del producto. La corrección definitiva (importar
`FieldValue` y `Timestamp` desde `firebase-admin/firestore`) va en otro cambio y
hará innecesario este paso.

## 9. Otras particularidades y limitaciones

- `functions/scripts/crear-documentos-ventiladores.js` exige
  `GOOGLE_APPLICATION_CREDENTIALS` por diseño. Solo para ese proceso se usó un
  JSON **falso** (`project_id: demo-mtpa`, clave generada al azar) junto con los
  `*_EMULATOR_HOST`, de modo que escribe únicamente en el emulador. El kit lo
  admite con `node tools/qa-local/verificar-entorno.js --migracion-ventiladores`.
- Las callables se llamaron por HTTP al emulador (ver 0.8 del plan de control);
  para dos sesiones a la vez (CV-25 y CV-26) se usó un segundo Chrome con
  perfil aislado.
- **No es Firebase real:** quedan sin validar los índices compuestos (el
  emulador no los exige), la latencia real y la atomicidad de AU-48.
- **No es HiveMQ Cloud ni hardware real:** el ventilador fue el simulador o un
  cliente MQTT manual.
- Las duraciones del emulador no representan a Cloud Functions y sus lecturas
  de Firestore no se pueden contar (AU-49 quedó parcial).
