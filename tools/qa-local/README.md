# Kit de pruebas locales con emuladores

Levanta M.T.P.A. en tu máquina sin tocar Firebase real ni HiveMQ Cloud:
emuladores de Auth, Firestore y Functions (con las reglas, los índices y las
funciones del repositorio), un broker MQTT local, el Servicio de Integración,
el simulador y, si querés, el frontend. Destila lo repetible de la ejecución
descrita en [`docs/pruebas/ejecucion-local-emuladores.md`](../../docs/pruebas/ejecucion-local-emuladores.md).

Todos los bloques de código son **bash** (en Windows, Git Bash): no sirven tal
cual en PowerShell ni en `cmd`.

## Seguridad: leelo antes de empezar

- Todo corre con el proyecto **`demo-mtpa`**. El prefijo `demo-` es la convención
  de Firebase para proyectos que solo existen en los emuladores. **No** se usa
  `mtpa-dev` (el de `.firebaserc`) porque es un proyecto real: una variable mal
  puesta escribiría en la nube.
- El prefijo no basta. [`verificar-entorno.js`](verificar-entorno.js) aborta
  (código 1) si `GCLOUD_PROJECT` (o `GOOGLE_CLOUD_PROJECT`, `GCP_PROJECT`,
  `CLOUDSDK_CORE_PROJECT`, `FIREBASE_CONFIG`, si existen) no empieza con
  `demo-`, si `FIRESTORE_EMULATOR_HOST` o `FIREBASE_AUTH_EMULATOR_HOST` faltan o
  no son `host:puerto` de esta máquina, o si está definida
  `GOOGLE_APPLICATION_CREDENTIALS`. `entorno.sh` y `seed.js` lo ejecutan siempre.
- Única excepción: `functions/scripts/crear-documentos-ventiladores.js` exige
  `GOOGLE_APPLICATION_CREDENTIALS` por diseño. Usá una cuenta de servicio
  **falsa** (JSON con `project_id: demo-mtpa`, un `client_email` que contenga
  `demo-` y una `private_key` RSA generada por vos; nunca una real) y corré
  `node tools/qa-local/verificar-entorno.js --migracion-ventiladores` **en el
  mismo shell** que después ejecuta el script de migración. Solo la admite si
  `project_id` y `client_email` son de un proyecto `demo-`. Probado con
  `--dry-run` contra el emulador sembrado.
- Nunca ejecutes `firebase deploy` desde este entorno.

## Contenido

| Archivo | Para qué |
| ------- | -------- |
| [`firebase.emulators.json`](../../firebase.emulators.json) | Emuladores Auth 9099, Firestore 8080 y Functions 5001 (sin UI). **Vive en la raíz** y no acá: el CLI rechaza rutas fuera del directorio de su configuración (`../../firestore.rules is outside of project directory`). No reemplaza al `firebase.json` de despliegue. |
| `entorno.sh` | Variables de cada terminal (se ejecuta con `source`). Genera al azar la clave MQTT y el token de las funciones y los guarda en `.entorno.local`. |
| `verificar-entorno.js` | Las comprobaciones de seguridad de arriba. |
| `seed.js` | Usuarios `administrador`, `operador`, `consulta` y datos base. Imprime los ids para el simulador. |
| `.gitignore` | Ignora claves, certificados y logs de este directorio. |
| `.gitattributes` | Fuerza finales de línea LF en los `.sh` (con CRLF, bash falla en Windows). |

## Requisitos

- bash (en Windows, Git Bash), Node.js ≥ 20, JDK (los emuladores de Firestore lo
  necesitan), `firebase-tools` y `openssl` (viene con Git for Windows).
- Probado con Node 24.13.1, Java 25.0.1, `firebase-tools` 15.28.2 y
  `firebase-admin` 12.x.
- **El seed usa las callables reales, que en el emulador fallan sin el arreglo
  de `admin.firestore.FieldValue`** (PR #43, rama
  `fix/validar-id-ventilador-y-fieldvalue`) o su equivalente ya en `main`. Sin él,
  `seed.js` crea al administrador pero se detiene en el operador con
  `gestionarUsuario: INTERNAL (¿falta el arreglo de FieldValue…?)`, y el log de
  los emuladores muestra `Cannot read properties of undefined (reading
  'serverTimestamp')`. **Sin #43, no sigas**; o aplicá el workaround local del
  §8 de [`docs/pruebas/ejecucion-local-emuladores.md`](../../docs/pruebas/ejecucion-local-emuladores.md)
  (editar un archivo de `functions/node_modules`, que git no versiona).

## Pasos

Ejecutá todo desde la raíz del repositorio. **En CADA terminal nueva, lo primero
es `source tools/qa-local/entorno.sh`** (define las variables y corre la
verificación de seguridad; si no dice `Entorno OK`, no sigas). Una vez:

```bash
npm install --no-package-lock --prefix functions
npm install --no-package-lock --prefix iot-integration-service
```

**1. Emuladores** (terminal A). El `cd` hace que los logs de depuración caigan
en este directorio, donde git los ignora:

```bash
source tools/qa-local/entorno.sh
(cd tools/qa-local && firebase emulators:start --config ../../firebase.emulators.json --project demo-mtpa)
```

**No omitas nunca `--project demo-mtpa`**: sin él el CLI toma el proyecto de
`.firebaserc` (`mtpa-dev`). Los emuladores seguirían siendo locales, pero
perderías la protección del prefijo `demo-`.

Esperá `All emulators ready` y las siete líneas `function initialized`. Los
datos viven en memoria: al reiniciar hay que volver a sembrar.

**2. Verificar el entorno** (terminal B):

```bash
source tools/qa-local/entorno.sh
node tools/qa-local/verificar-entorno.js
```

Los dos deben decir `Entorno OK` (el primero ya lo corre al terminar; el
segundo lo repite a mano).

**3. Sembrar** (terminal B):

```bash
source tools/qa-local/entorno.sh
node tools/qa-local/seed.js
```

Crea los usuarios (correos `<rol>@mtpa-qa.test`), una incubadora activa, un
sensor de temperatura y dos ventiladores. Las claves se generan al azar la
primera vez y se guardan en `tools/qa-local/.credenciales.local.json` (ignorado
por git); las siembras siguientes las reutilizan. El script solo imprime esa
ruta, nunca las claves. Al final imprime los ids de documento y los
`export SIMULADOR_*` del paso 6. Podés repetirlo: si ya está sembrado lo dice y
no duplica nada.

**4. Broker MQTT** (terminal C). El servicio fuerza `mqtts://` con certificado
válido, así que el broker escucha en TLS con un certificado autofirmado que
Node confía vía `NODE_EXTRA_CA_CERTS` (lo exporta `entorno.sh`). `aedes` es una
dependencia que el repositorio no tiene; se instala en `.broker/`, que git
ignora, sin tocar ningún `package.json` versionado. El certificado dura 365
días: si venció, borrá `cert.pem` y `key.pem` de `.broker/` y repetí el
`openssl`. Una vez:

```bash
mkdir -p tools/qa-local/.broker && cd tools/qa-local/.broker
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 \
  -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" -addext "basicConstraints=critical,CA:TRUE"
echo '{"name":"mtpa-broker-local","private":true}' > package.json && npm install aedes@0.51.3
cat > broker.js <<'EOF'
const fs = require("fs");
const path = require("path");
const aedes = require("aedes").createBroker();
const { MQTT_USERNAME, MQTT_PASSWORD } = process.env;
aedes.authenticate = (cliente, usuario, clave, cb) =>
  usuario === MQTT_USERNAME && clave && clave.toString() === MQTT_PASSWORD
    ? cb(null, true)
    : cb(Object.assign(new Error("credenciales inválidas"), { returnCode: 4 }), false);
aedes.on("publish", (p, c) => c && !p.topic.startsWith("$SYS") && console.log(c.id, p.topic, p.payload.toString()));
require("tls")
  .createServer({ key: fs.readFileSync(path.join(__dirname, "key.pem")), cert: fs.readFileSync(path.join(__dirname, "cert.pem")) }, aedes.handle)
  .listen(8883, "127.0.0.1", () => console.log("broker mqtts en 127.0.0.1:8883"));
EOF
cd ../../..
```

Y cada vez (el `source` va después de crear el certificado, para que tome
`NODE_EXTRA_CA_CERTS`):

```bash
source tools/qa-local/entorno.sh
node tools/qa-local/.broker/broker.js
```

Alternativa: cualquier broker con TLS y usuario/clave (p. ej. el contenedor
`eclipse-mosquitto`, no probado acá) en `localhost:8883`, con el usuario
`mtpa-qa` y la clave de `MQTT_PASSWORD` (en `.entorno.local`). Los tópicos usan
el prefijo `mtpa-dev` (el valor por defecto del servicio); `docs/contrato-mqtt.md`
habla de `mtpa/`.

**5. Servicio de Integración** (terminal D, tras el paso 4):

```bash
source tools/qa-local/entorno.sh
cd iot-integration-service && npm start
```

**Antes de arrancar, comprobá que no exista un `iot-integration-service/.env`
real** (o renombralo mientras uses el kit): el servicio y el simulador lo cargan
*después* de la verificación (`lib/env.js`) y solo completan las variables que
faltan, pero un `.env` con credenciales reales de HiveMQ o de Firebase no
debería estar a mano en este entorno.

**6. Simulador** (terminal E). Reemplazá los tres valores por los `export` que
imprimió el seed:

```bash
source tools/qa-local/entorno.sh
export SIMULADOR_INCUBADORA_ID=ID_INCUBADORA SIMULADOR_SENSOR_ID=ID_SENSOR SIMULADOR_VENTILADOR_ID=ID_VENTILADOR_1
cd iot-integration-service && npm run simulator
```

**7. Comprobar de punta a punta, sin frontend** (terminal B). Reemplazá
`ID_VENTILADOR_1` por el id que imprimió el seed. Envía `encender` como
operador y muestra cómo la orden llega a `ejecutada`:

```bash
source tools/qa-local/entorno.sh
node - ID_VENTILADOR_1 <<'EOF'
const { operador } = require("./tools/qa-local/.credenciales.local.json").usuarios;
const post = async (url, cuerpo, token) =>
  (await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(cuerpo) })).json();
(async () => {
  const { idToken } = await post(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, { email: operador.correo, password: operador.password, returnSecureToken: true });
  const { result } = await post("http://127.0.0.1:5001/demo-mtpa/us-central1/enviarComandoVentilador", { data: { ventiladorId: process.argv[2], accionSolicitada: "encender" } }, idToken);
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const doc = await (await fetch(`http://127.0.0.1:8080/v1/projects/demo-mtpa/databases/(default)/documents/ordenes_ventilador/${result.ordenId}`, { headers: { Authorization: "Bearer owner" } })).json();
    console.log(doc.fields.estado.stringValue);
    if (["ejecutada", "fallida", "expirada"].includes(doc.fields.estado.stringValue)) break;
  }
})();
EOF
```

**8. Frontend (opcional).** `frontend/src/services/firebase.js` no se conecta a
emuladores. Hace falta un cambio **local, que no se debe commitear**: importar
`connectAuthEmulator`, `connectFirestoreEmulator` y `connectFunctionsEmulator`
y, tras crear `auth`, `db` y `functions`, añadir:

```js
if (import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
```

Y un `frontend/.env.local` (git lo ignora; tiene prioridad sobre `.env`) con
valores falsos: `VITE_USE_EMULATORS=true`, `VITE_FIREBASE_PROJECT_ID=demo-mtpa`
y valores de relleno para `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`,
`_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID` y `_APP_ID`. Luego
`cd frontend && npm ci && npx vite --host 127.0.0.1` e iniciá sesión con los
correos y claves de `.credenciales.local.json`. Al terminar:
`git checkout -- frontend/src/services/firebase.js`. (Este paso no se ejecutó al
armar el kit.)

## Limpiar

Detené cada proceso con Ctrl+C (los datos de los emuladores desaparecen).
Para borrar lo generado: `git clean -fdX tools/qa-local` (claves, certificado,
`.broker/`, logs) y `rm functions/.env.demo-mtpa`.

## Qué NO valida este entorno

- **Firebase real**: reglas y funciones se ejecutan en emuladores; latencias,
  cuotas, permisos de IAM y el despliegue quedan sin probar.
- **HiveMQ Cloud y hardware real**: el broker es local y el ventilador es el
  simulador.
- **Índices compuestos**: el emulador de Firestore no los exige; una consulta que
  los necesite pasa acá y falla en la nube.
- **Atomicidad real de Firestore** (transacciones y lotes concurrentes) y el
  conteo de lecturas.
- El emulador de Functions no reproduce los tiempos ni el arranque en frío de
  Cloud Functions.
