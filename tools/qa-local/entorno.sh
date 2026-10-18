# Variables del entorno de pruebas local (proyecto demo-mtpa + emuladores).
# Uso, en CADA terminal:   source tools/qa-local/entorno.sh
# Hay que usar "source": si lo ejecutás con "bash entorno.sh" no exporta nada
# (y lo avisa). Requiere bash (en Windows, Git Bash) y node.
#
# Los secretos de prueba (clave MQTT y token del servicio) se generan al azar
# la primera vez, se guardan en .entorno.local (ignorado por git) y se
# reutilizan. El token también se escribe en functions/.env.demo-mtpa, que las
# funciones leen solo al emular el proyecto demo-mtpa y que git ignora.
# Si algo falla, devuelve un código distinto de 0 (con "return", sin cerrar tu terminal).

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "Usá:  source tools/qa-local/entorno.sh   (ejecutarlo no exporta nada)" >&2
  exit 1 # seguro: esta rama solo corre cuando NO se usó "source"
fi

_qa_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_qa_azar() { node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))" 2>/dev/null; }

export GCLOUD_PROJECT=demo-mtpa GOOGLE_CLOUD_PROJECT=demo-mtpa
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
unset GOOGLE_APPLICATION_CREDENTIALS FIREBASE_CONFIG GCP_PROJECT CLOUDSDK_CORE_PROJECT

unset MQTT_PASSWORD PROCESAR_MEDICION_TOKEN
[ -f "$_qa_dir/.entorno.local" ] && . "$_qa_dir/.entorno.local"
if [ -z "$MQTT_PASSWORD" ] || [ -z "$PROCESAR_MEDICION_TOKEN" ]; then
  MQTT_PASSWORD="$(_qa_azar)"
  PROCESAR_MEDICION_TOKEN="$(_qa_azar)"
  if [ -z "$MQTT_PASSWORD" ] || [ -z "$PROCESAR_MEDICION_TOKEN" ]; then
    echo "entorno.sh: no se pudieron generar los secretos (¿está node en el PATH?). No se escribió nada." >&2
    unset MQTT_PASSWORD PROCESAR_MEDICION_TOKEN _qa_dir
    unset -f _qa_azar
    return 1
  fi
  printf 'MQTT_PASSWORD=%s\nPROCESAR_MEDICION_TOKEN=%s\n' "$MQTT_PASSWORD" "$PROCESAR_MEDICION_TOKEN" > "$_qa_dir/.entorno.local"
fi
export MQTT_PASSWORD PROCESAR_MEDICION_TOKEN

printf 'INTEGRATION_SERVICE_TOKEN=%s\n' "$PROCESAR_MEDICION_TOKEN" > "$_qa_dir/../../functions/.env.demo-mtpa"

export MQTT_HOST=localhost MQTT_PORT=8883 MQTT_USERNAME=mtpa-qa
export PROCESAR_MEDICION_URL=http://127.0.0.1:5001/demo-mtpa/us-central1/procesarMedicion
[ -f "$_qa_dir/.broker/cert.pem" ] && export NODE_EXTRA_CA_CERTS="$_qa_dir/.broker/cert.pem"

node "$_qa_dir/verificar-entorno.js"
_qa_estado=$?
unset -f _qa_azar
unset _qa_dir
return $_qa_estado
