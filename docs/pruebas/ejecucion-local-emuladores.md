# Ejecución local con emuladores

Cómo se montó el entorno con el que se ejecutaron, el 2026-10-18, los planes
`plan-pruebas-control-ventiladores.md` y `plan-pruebas-automatizacion.md`
(commit `0ec7866`), para poder repetirlo. Es un entorno **100 % local**: no toca
Firebase real ni HiveMQ Cloud, y sus resultados valen para el código, no para
el despliegue real (ver 9).

## 1. Componentes

| Componente | Cómo | Puerto |
| ---------- | ---- | ------ |
| Emuladores de Auth, Firestore y Functions | `firebase emulators:start --project demo-mtpa --only auth,firestore,functions`, con las reglas, los índices y las funciones del repositorio | 9099, 8080, 5001 |
| Broker MQTT | `aedes` (npm) con TLS autofirmado, ver 4 | 8883 |
| Servicio de Integración | `npm start` en `iot-integration-service/` | — |
| Simulador | `npm run simulator` en `iot-integration-service/` | — |
| Frontend | `npx vite --host 127.0.0.1` (servidor de desarrollo, sin `build`) | 5173 |

Versiones: Node 24, Java 25, `firebase-tools` 15.28.2, `firebase-admin` 12.7.0.
Los datos del emulador viven en memoria: al reiniciarlo hay que volver a sembrar.

## 2. Por qué `demo-mtpa` y no `mtpa-dev`

El `.firebaserc` del repositorio apunta al proyecto real `mtpa-dev`. El prefijo
`demo-` es la convención de Firebase para proyectos que solo existen en los
emuladores: no hay un proyecto en la nube con ese id, así que no hay nada real
a lo que apuntar por error. Por eso se pasa siempre `--project demo-mtpa` y
nunca se ejecuta `firebase deploy`.

Esa convención no sustituye las comprobaciones de la sección 3: durante la
ejecución se verificó, antes de arrancar cada proceso, que
`GOOGLE_APPLICATION_CREDENTIALS` no estuviera definida y que los hosts de los
emuladores sí lo estuvieran. No se contrastó con la documentación de Firebase
qué ocurre exactamente si el código intenta usar un servicio no emulado.

## 3. Variables de entorno

Para el servicio, el simulador y cualquier script de Node:

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
SDK no tiene credenciales reales y solo puede hablar con los emuladores. Antes
de arrancar el servicio o el simulador conviene un script que aborte si
`GCLOUD_PROJECT` no es `demo-mtpa`, si faltan los hosts de los emuladores o si
`GOOGLE_APPLICATION_CREDENTIALS` existe. Al arrancar los emuladores, en cambio,
quitar los `*_EMULATOR_HOST` del shell: los define el CLI.

El token de las funciones va en `functions/.env.local`, que git ignora. No usar
`functions/.secret.local` ni `frontend/.env`: no están ignorados (hallazgo H-02
de los planes).

## 4. Broker MQTT local

`iot-integration-service/lib/mqtt-client.js` fuerza `mqtts://` con
`rejectUnauthorized: true`, así que el broker escucha en TLS con un certificado
autofirmado (`openssl req -x509`, CN y SAN `localhost` y `127.0.0.1`,
`CA:TRUE`) que los procesos de Node confían con `NODE_EXTRA_CA_CERTS`. Se usó
`aedes` porque no había un daemon de Docker para `eclipse-mosquitto`; sirve
cualquier broker con TLS y usuario y clave. Los tópicos usan el prefijo
`mtpa-dev`, no `mtpa` (ver `contrato-mqtt.md`).

## 5. Configuración de los emuladores

El `firebase.json` del repositorio no define emuladores. Para no tocarlo se usó
uno propio, fuera del repositorio, solo con `auth`, `firestore` y `functions`
en `127.0.0.1`, apuntando a las reglas, los índices y `functions/` del
repositorio (el CLI exige que estén dentro del directorio del proyecto; en
Windows se resolvió con una junction `mklink /J`). Quizá baste correr el CLI
desde la raíz del repositorio con `--project demo-mtpa`, pero no se probó.

## 6. Parche local del frontend

`frontend/src/services/firebase.js` no se conecta a emuladores. Se aplicó un
parche temporal, no versionado y revertido al terminar: importa
`connectAuthEmulator`, `connectFirestoreEmulator` y `connectFunctionsEmulator`
y los invoca (Auth 9099, Firestore 8080, Functions 5001) cuando
`import.meta.env.VITE_USE_EMULATORS === "true"`. Se acompaña de
`frontend/.env.local` (ignorado por `*.local`) con esa variable y valores
falsos de `VITE_FIREBASE_*`, con `demo-mtpa` como proyecto.

## 7. Siembra de datos

Con el Admin SDK apuntando a los emuladores se crearon tres usuarios en Auth
(`administrador`, `operador` y `consulta`), con el custom claim `role` y su
documento `usuarios/{uid}` con `activo: true`. Las claves son inventadas y no
se guardan en el repositorio. Las incubadoras, los dispositivos y los
ventiladores se crearon desde la interfaz y con las callables
`gestionarIncubadora` y `crearDispositivo`. **Los scripts de siembra y de apoyo
usados (siembra, cliente de llamadas, observadores del panel) no están
versionados.**

## 8. Problema del emulador con `admin.firestore.FieldValue` (H-03)

Con `firebase-tools` 15.28.2 y `firebase-admin` 12.7.0 el emulador de Functions
devuelve `admin.firestore.FieldValue` como `undefined`: reemplaza `firebase-admin`
por un `Proxy` que aplica `bind` a toda propiedad función que no sea un
constructor, y el getter `firestore` es una función flecha con propiedades
estáticas (`FieldValue`, `Timestamp`) que `bind` pierde. Toda callable que
escribe con `serverTimestamp()` falla con `INTERNAL`. En producción no ocurre.

**Workaround, mientras no se corrija en el código:** en el `node_modules` local
(no versionado), editar
`functions/node_modules/firebase-admin/lib/app/firebase-namespace.js` y cambiar
la función flecha que devuelve el getter `firestore` por una `function` común.
No afectó a ningún resultado del producto. La corrección definitiva (importar
`FieldValue` y `Timestamp` desde `firebase-admin/firestore`) va en otro cambio y
hará innecesario este paso.

## 9. Otras particularidades y limitaciones

- `functions/scripts/crear-documentos-ventiladores.js` exige
  `GOOGLE_APPLICATION_CREDENTIALS` por diseño. Solo para ese proceso se usó un
  JSON **falso** (`project_id: demo-mtpa`, clave generada al azar) junto con los
  `*_EMULATOR_HOST`, de modo que escribe únicamente en el emulador.
- Las callables se llamaron por HTTP al emulador (ver 0.8 del plan de control);
  para dos sesiones a la vez (CV-25 y CV-26) se usó un segundo Chrome con
  perfil aislado.
- **No es Firebase real:** quedan sin validar los índices compuestos (el
  emulador no los exige), la latencia real y la atomicidad de AU-48.
- **No es HiveMQ Cloud ni hardware real:** el ventilador fue el simulador o un
  cliente MQTT manual.
- Las duraciones del emulador no representan a Cloud Functions y sus lecturas
  de Firestore no se pueden contar (AU-49 quedó parcial).
