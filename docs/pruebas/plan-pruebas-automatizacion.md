# Plan de pruebas — Automatización de ventiladores con histéresis (CU-02)

Casos de prueba de extremo a extremo para la **automatización de ventiladores
con histéresis** del Sprint 4 (RF-019 y RF-020, paso de evaluación de
automatización del caso de uso **CU-02** del ERS): configurar el modo y la regla
de un ventilador, y comprobar que cada medición que llega crea (o no) la orden
automática correcta, sin duplicados y sin oscilar. Se usa el simulador de
dispositivo (`iot-integration-service/simulator/simulador.js`) en lugar de
hardware real.

El flujo cubierto es:

```
Configuración (administrador): /ventiladores/automatizacion
  -> guardarReglaAutomatizacion (Cloud Function callable)
  -> ventiladores/{id}.modoControl + reglas_automatizacion/{id} (en un solo batch)

Evaluación, con cada medición:
simulador MQTT -> Servicio de Integración IoT -> procesarMedicion (Cloud Function)
  -> mediciones/{id}
  -> evaluarUmbrales (alertas, ver plan-pruebas-monitoreo-alertas.md)
  -> evaluarAutomatizacion
       reglas_automatizacion (incubadoraId + variable, solo activa === true)
         -> histéresis: valor >= umbral -> encender
                        valor <= umbral - margen -> apagar
                        en medio -> nada
         -> ventiladores/{id}: modoControl "automatico" o "mixto", estadoActual
         -> cooldown de 120 s y ventana de 300 s (últimas 10 órdenes del ventilador)
         -> transacción: ordenes_ventilador/{id}
              origen "automatico", solicitadoPor "sistema", estado "pendiente"

Ejecución de la orden:
  Servicio: pendiente -> enviando -> enviada -> comando MQTT .../comando
  simulador -> .../estado -> Servicio: ventiladores/{id}.estadoActual + orden "ejecutada"
  panel /ventiladores: chip de estado y "Última orden" en tiempo real
Desenlaces alternativos: "fallida" (sin confirmación en 30 s) y "expirada" (más de 60 s pendiente)
```

> **Estado de este plan: ejecutado en local el 2026-10-18 (51 casos: 50 Pasó,
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
>   sus emuladores.
> - **Atomicidad de AU-48.** Las 3 tandas de 5 mediciones simultáneas dieron
>   una sola orden, pero en el emulador de Firestore. La garantía de la
>   transacción con consulta depende del comportamiento de Firestore real y
>   sigue sin verificarse allí.
> - **HiveMQ Cloud y hardware real.** El broker fue uno local, y el ventilador
>   fue siempre el simulador o un cliente MQTT manual.
> - **Índices compuestos.** El emulador de Firestore no exige índices, así que
>   el despliegue de `firestore.indexes.json` (el índice de
>   `ordenes_ventilador` que usa la automatización) no quedó validado.
> - **AU-49, parcial.** Los tiempos del emulador no son representativos de
>   Cloud Functions reales y las lecturas de Firestore por medición no se
>   pueden contar en el emulador; se midió solo la duración relativa y las
>   lecturas se dedujeron del código.
> - **Compilación de producción.** El frontend se ejecutó con el servidor de
>   desarrollo y un parche local no versionado para conectarlo a los
>   emuladores; no se hizo `build`.
>
> Los resultados de este plan valen entonces para el comportamiento del código
> en un entorno local, no como aceptación del despliegue real.

Los resultados esperados salen del código de las ramas listadas en 0.1, no de
las descripciones de las tarjetas de Notion. Los textos entre comillas son los
literales de la interfaz y de las Cloud Functions.

## 0. Prerrequisitos

### 0.1 Código bajo prueba

Los de `docs/pruebas/plan-pruebas-control-ventiladores.md` (sección 0.1), y
además la automatización: `guardarReglaAutomatizacion`, `evaluarAutomatizacion`
dentro de `procesarMedicion` y el Servicio de Integración que confirma el
estado y cierra las órdenes (rama `feat/sprint-4-iot-confirmar-estado`, que
contiene los commits de `functions/` apilados), y el formulario de reglas con
sus rutas (rama `feat/sprint-4-rutas-permisos-ventiladores`), o `main` una vez
integradas.

### 0.2 Firebase

Valen el orden de despliegue y la tabla de 0.2 del plan de control de
ventiladores, incluido el script `functions/scripts/crear-documentos-ventiladores.js`
(`--dry-run` y luego `--confirmar`, una vez por entorno), sin el cual todo
comando da `not-found`. Específico de este plan:

| Elemento | Qué debe estar listo |
| -------- | -------------------- |
| Cloud Functions | Desplegadas `guardarReglaAutomatizacion` y `procesarMedicion` con `evaluarAutomatizacion`, además de `crearDispositivo`, `enviarComandoVentilador` y `notificarAlerta`. |
| `INTEGRATION_SERVICE_TOKEN` | Configurado en las Cloud Functions, con el mismo valor que `PROCESAR_MEDICION_TOKEN` del servicio. También lo necesita quien ejecute la sección 5 (0.7). |
| Reglas e índices | `firestore.rules` e `firestore.indexes.json` desplegados. La automatización no necesita índices nuevos: la consulta de reglas usa solo filtros de igualdad y la de órdenes usa el índice existente de `ordenes_ventilador` (`ventiladorId` + `creadaEn` descendente). |
| Usuarios | Un `administrador`, un `operador` y un usuario de `consulta`, activos y con su custom claim `role` correcto. |

### 0.3 Datos de prueba

Las reglas guardadas no se pueden borrar desde la interfaz, así que este plan
parte de ventiladores propios (si ya se ejecutó el plan de control, crear
ventiladores nuevos). Como `administrador`, desde `/incubadoras/<id>/editar`
("+ Agregar dispositivo"):

1. **Incubadora A** (activa), con un `sensor_temperatura` (SA) y dos
   `ventilador`:
   - **VS, ventilador simulado**: su id es el `SIMULADOR_VENTILADOR_ID` del
     simulador. Responde a los comandos.
   - **VN, ventilador sin respuesta**: nadie contesta a sus comandos; sus
     órdenes terminan `fallida` y se mantiene "Desconocido".
2. **Incubadora B** (activa, **distinta** de A), con un `sensor_temperatura`
   (SB) y un `ventilador` (**VB**, "banco de valores exactos"): el simulador no
   la alimenta, y las mediciones y los estados se envían a mano (0.7).
3. Anotar el **id del documento** de cada dispositivo en `dispositivos/` (no el
   `identificadorMqtt`) y comprobar que existe `ventiladores/<id>` para VS, VN
   y VB, los tres con `modoControl: "manual"` y `estadoActual: null`.

Sin reglas guardadas, los tres ventiladores están en modo `manual` y no
reciben órdenes automáticas.

### 0.4 Servicio de Integración y simulador

Igual que en 0.4 del plan de control de ventiladores (variables de entorno sin
valores, `npm start` y el simulador con `SIMULADOR_INCUBADORA_ID` = incubadora
A, `SIMULADOR_SENSOR_ID` = SA y `SIMULADOR_VENTILADOR_ID` = VS). Tiempos que
suponen los casos, con sus valores por defecto: `ORDEN_MAX_ANTIGUEDAD_SEGUNDOS`
60 y `ORDEN_CONFIRMACION_TIMEOUT_SEGUNDOS` 30 (barrido cada 10 s).

Comportamiento del simulador a tener presente: publica cada 8 segundos una
medición con `temperatura` y `humedad` (caminata aleatoria que arranca en
37,5 °C y 55 %, acotada a 35–40 °C y 40–70 %), y su ventilador arranca
**apagado** (al conectarse publica ese estado, que lleva `estadoActual` de VS
de `null` a `"apagado"` sin ninguna orden). No hay una opción para forzar un
valor puntual: la temperatura varía hasta ±0,15 °C y la humedad hasta ±1,5 %
por medición. Para provocar una decisión se **mueve la regla alrededor del valor
simulado actual** (0.6), y el `valor` realmente evaluado se verifica siempre en
la colección `mediciones`. Detener el simulador (Ctrl+C) lo detiene entero:
también las mediciones. Responde a los comandos de VS al instante, y reiniciarlo
vuelve a publicar "apagado".

### 0.5 Frontend

En `frontend/` crear `.env` con `VITE_FIREBASE_API_KEY`,
`VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID` y
`VITE_FIREBASE_APP_ID`, y levantar la aplicación con `npm run dev`. El layout
monta el menú lateral (`Sidebar`): el `administrador` ve Panel general,
Incubadoras, Alertas, Límites de alerta, Ventiladores y Usuarios; el `operador`,
Panel general, Incubadoras, Alertas y Ventiladores; la `consulta`, Panel general
e Incubadoras. **No hay ítem de menú para `/ventiladores/automatizacion`**: el
administrador llega con el enlace "Configurar modo y automatización" de cada
tarjeta del panel `/ventiladores`, o escribiendo la URL.

Los campos del formulario de `/ventiladores/automatizacion` son: selectores
"Incubadora" y "Ventilador"; "Modo de control" (Manual, Automático, Mixto);
"Variable" (Temperatura o Humedad); "Umbral de activación (°C)" y "Margen de
histéresis (°C)" (en humedad, `(%)`); casilla "Regla activa"; y el botón
"Guardar" ("Guardando..." mientras guarda).

### 0.6 Cómo mover la regla alrededor del valor simulado

Se lee el último valor `V` de la variable (en `mediciones`, filtrando por
`incubadoraId` y `variable`, ordenado por `medidoEn` descendente) y se guarda
la regla **enseguida** (en menos de ~40 s para temperatura y ~24 s para
humedad, o repetir con un valor nuevo). Se redondea a un decimal, que es lo que avanza el campo. La regla se evalúa con la
**siguiente** medición que llega después de guardarla (hasta unos 10 s).

Temperatura (cada medición se mueve hasta ±0,15 °C respecto de la anterior):

| Objetivo | Regla a guardar | Por qué |
| -------- | --------------- | ------- |
| Encender en la próxima medición | Umbral `V − 1`, margen 0,2 | Para n mediciones intermedias el valor sigue en `[V − 0,15·n; V + 0,15·n]`; con n ≤ 6 queda ≥ umbral. |
| Apagar en la próxima medición | Umbral `V + 1`, margen 0,2 (límite de apagado `V + 0,8`) | Con n ≤ 5 el valor queda ≤ `V + 0,8`. |
| Zona de histéresis (ni encender ni apagar) | Umbral `V + 2`, margen 4 (límite de apagado `V − 2`) | Con n ≤ 13 (más de 100 s) el valor sigue dentro de la banda abierta `(V − 2; V + 2)`. |
| Regla "inerte" (nunca dispara) | Umbral 60, margen 30 | La temperatura simulada (35–40 °C) queda dentro de la banda `(30; 60)`. |

Humedad (cada medición se mueve hasta ±1,5 %): encender con umbral `H − 5` y
margen 1; apagar con umbral `H + 6` y margen 1 (límite de apagado `H + 5`),
ambos válidos con hasta 3 mediciones entre la lectura de `H` y la evaluación.

Siempre se confirma en `mediciones` que el valor evaluado quedó donde se
esperaba (por encima del umbral, por debajo del límite de apagado, o dentro de
la banda). Si no, el caso no es válido y se repite con un valor nuevo.

### 0.7 Banco de valores exactos (incubadora B)

El simulador no puede fijar un valor exacto, así que los casos de la sección 5
(bordes) envían las mediciones de la incubadora B directamente a
`procesarMedicion`, la misma función que usa el servicio, con el `valor`
deseado, y informan a mano el estado de VB por MQTT.

- **Medición**: `POST` a la URL de `procesarMedicion`
  (`PROCESAR_MEDICION_URL`) con cabecera `Authorization: Bearer <token>`, donde
  el token es el `INTEGRATION_SERVICE_TOKEN` (un secreto: tenerlo en una
  variable de entorno del shell, no escribirlo en el documento ni en la
  evidencia). Ejemplo en PowerShell:

  ```powershell
  Invoke-RestMethod -Method Post -Uri $env:PROCESAR_MEDICION_URL `
    -ContentType "application/json" `
    -Headers @{ Authorization = "Bearer $env:INTEGRATION_SERVICE_TOKEN" } `
    -Body (@{ incubadoraId = "<id de B>"; dispositivoId = "<id de SB>";
              variable = "temperatura"; valor = 29.5; unidad = "°C";
              medidoEn = (Get-Date).ToUniversalTime().ToString("o") } | ConvertTo-Json)
  ```

  (En bash: `curl -X POST "$PROCESAR_MEDICION_URL" -H "Content-Type: application/json" -H "Authorization: Bearer $INTEGRATION_SERVICE_TOKEN" -d '{"incubadoraId":"<id de B>","dispositivoId":"<id de SB>","variable":"temperatura","valor":29.5,"unidad":"°C","medidoEn":"<fecha ISO 8601>"}'`.)
  Respuesta esperada: HTTP 201 con `ok: true` y `medicionId`. La medición queda
  en `mediciones` y se evalúan umbrales y reglas de la incubadora B.
- **Estado del ventilador VB**: con el cliente web de HiveMQ Cloud o
  `mosquitto_pub` (ver `docs/broker-mqtt.md`), publicar en
  `<MQTT_TOPIC_PREFIX>/<id de B>/ventiladores/<id de VB>/estado` el JSON
  `{"encendido": true}` o `{"encendido": false}`. El servicio lo toma como
  reporte del ventilador: actualiza `estadoActual` y cierra la orden `enviada`
  de esa acción, si la hay.
- Los comandos que el servicio publica para VB no los contesta nadie: sus
  órdenes quedan `enviada` y terminan `fallida` a los 30–40 s, salvo que se
  informe el estado a mano antes (punto anterior). El servicio puede marcar a SB y VB como
  desconectados y crear alertas de desconexión; no afectan a este plan.
  Todas las órdenes de VB se verifican en `ordenes_ventilador`.

### 0.8 Cómo verificar en Firestore

| Qué | Dónde | Campos |
| --- | ----- | ------ |
| Medición evaluada | `mediciones`, filtrando por `incubadoraId` y `variable`, ordenado por `medidoEn` descendente | `valor`, `variable`, `unidad`, `medidoEn`, `creadoEn`. |
| Regla | `reglas_automatizacion/<id del ventilador>` | `ventiladorId`, `incubadoraId`, `variable`, `umbralActivacion`, `margenHisteresis`, `activa`, `actualizadoEn`, `actualizadoPor`. |
| Modo y estado | `ventiladores/<id>` | `modoControl`, `estadoActual` (`null` / `encendido` / `apagado`), `actualizadoEn`. |
| Órdenes | `ordenes_ventilador`, filtrando por `ventiladorId` y ordenando por `creadaEn` descendente | `accionSolicitada`, `origen` (`automatico` / `manual`), `solicitadoPor` (`"sistema"` o uid), `estado`, `creadaEn`, `enviadaEn`, `ejecutadaEn`, `actualizadaEn`, `error`. |

Las órdenes automáticas tienen los mismos campos que las manuales; cambian
`origen: "automatico"` y `solicitadoPor: "sistema"`.

### 0.9 Convenciones y orden de ejecución

- **Cooldown.** Una orden de la misma acción creada hace menos de 120 s (en
  cualquier estado, también `fallida`, `expirada` o `ejecutada`) bloquea a la
  nueva; una orden en curso (`pendiente`, `enviando` o `enviada`) la bloquea
  hasta los 300 s. La acción contraria nunca bloquea. Por eso, antes de cada
  caso que espera una orden nueva, mirar en `ordenes_ventilador` la última
  orden **de la misma acción** de ese ventilador y esperar si es de hace menos
  de 120 s.
- **Contar órdenes.** "Una sola orden" significa un solo documento nuevo en
  `ordenes_ventilador` para ese `ventiladorId` y esa acción; anotar el conteo
  antes y después del caso.
- **Devolver a VN al estado inerte.** Al terminar cada caso que use VN,
  guardar su regla "inerte" (umbral 60, margen 30) o ponerlo en `manual`, para
  que no siga generando órdenes.
- **Orden sugerido.** Sección 1 (formulario, sin simulador); secciones 2 y 3
  (sobre VS); AU-26 a AU-28 (sobre VN); secciones 6 y 7; después, sobre VB, la
  sección 5 (AU-31 a AU-41) y a continuación AU-29 y AU-30, con las esperas que
  indica cada precondición; por último AU-48 a AU-51.
- Los tiempos "~115 s", "~125 s" admiten ±5 s: el servidor compara la
  antigüedad de la orden con 120 s y la medición llega en su ciclo de 8 s.

## 1. Configuración del modo y de la regla

Los casos de esta sección se ejecutan sobre VN, **sin simulador**, y usan la
regla inerte (umbral 60, margen 30) cuando necesitan guardar una válida. Al
terminar la sección, dejar a VN en modo "Manual".

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-01 | `administrador`; VN recién creado, sin regla. | Abrir `/ventiladores/automatizacion` (o entrar desde el enlace "Configurar modo y automatización" de la tarjeta de VN), elegir la incubadora A y el ventilador VN. | El formulario muestra "Modo de control: Manual" con la ayuda "Solo se aceptan comandos manuales.", la variable "Temperatura", los campos de umbral y margen **vacíos**, "Regla activa" marcada, y la nota "En modo manual la regla no se aplica y la guardada se conserva sin cambios. Elija el modo automático o mixto para configurarla.". Los campos de la regla están deshabilitados. En Firestore no existe `reglas_automatizacion/<id de VN>`. |
| AU-02 | AU-01 hecho. | Elegir el modo "Automático" (aparece "En modo automático los comandos manuales de este ventilador se rechazarán."), variable "Temperatura", umbral 60, margen 30, "Regla activa" marcada y pulsar "Guardar". | Aparece "La configuración del ventilador se guardó correctamente.". En Firestore: `ventiladores/<id de VN>.modoControl` es `"automatico"` y existe `reglas_automatizacion/<id de VN>` con `ventiladorId` y `incubadoraId` correctos, `variable: "temperatura"`, `umbralActivacion: 60`, `margenHisteresis: 30`, `activa: true`, `actualizadoEn` y `actualizadoPor` igual al uid del administrador. La regla y el modo se escriben juntos. |
| AU-03 | AU-02 hecho. | Elegir "Mixto", **desmarcar** "Regla activa" y pulsar "Guardar". | Aparece el aviso "Con la regla inactiva, el ventilador solo responderá a los comandos manuales." y se guarda: `modoControl: "mixto"` y la regla con `activa: false`. El modo mixto admite la regla inactiva. |
| AU-04 | VN en mixto con la regla inactiva (AU-03). | Elegir "Automático" con "Regla activa" **desmarcada** y pulsar "Guardar". | En el formulario aparece bajo la casilla: "En modo automático la regla debe estar activa. Elija el modo Mixto si desea dejarla inactiva.". No se llama a la función: en Firestore `modoControl` sigue `"mixto"` y la regla no cambia (`actualizadoEn` igual). |
| AU-05 | `administrador`. | Invocar `guardarReglaAutomatizacion` directamente (callable, ver 0.8 del plan de control) con `{ventiladorId: "<id de VN>", modoControl: "automatico", variable: "temperatura", umbralActivacion: 60, margenHisteresis: 30, activa: false}`. | `invalid-argument`: "En modo automático la regla debe estar activa: una regla inactiva dejaría al ventilador sin control, porque en ese modo se rechazan los comandos manuales. Usá el modo "mixto" o "manual".". No se escribe nada: ni el modo ni la regla cambian. |
| AU-06 | VN en mixto con regla (AU-03). Anotar `actualizadoEn` de la regla. | Elegir "Manual" y pulsar "Guardar". Luego repetirlo por la función con `{ventiladorId, modoControl: "manual", umbralActivacion: "texto", margenHisteresis: -5}`. | Ambos guardados correctos: `modoControl: "manual"` y la regla **conservada sin cambios** (mismos valores y mismo `actualizadoEn`): en modo manual solo se cambia el modo y los demás campos se ignoran, sin validarlos. |
| AU-07 | AU-06 hecho. | Recargar el formulario y volver a elegir VN. Cambiar el modo a "Automático", marcar "Regla activa", cambiar el umbral a 61 y guardar. | Al abrir, el formulario se precarga con el modo guardado ("Manual") y con la regla guardada (umbral 60, margen 30, "Regla activa" desmarcada). Tras guardar, sigue habiendo **un solo** documento `reglas_automatizacion/<id de VN>` (una regla por ventilador, cuyo id es el del ventilador), con umbral 61 y `actualizadoEn` más reciente. Devolver el umbral a 60. |
| AU-08 | VN con regla de AU-07. | Guardar umbral 60 y margen 0,01. | Se acepta (el margen mínimo es 0,01): `margenHisteresis: 0.01` en Firestore. |
| AU-09 | VN con regla de AU-07. | Intentar guardar margen 0,009; margen 0; margen -1 (formulario). Repetir los tres por la función. | Formulario (valida al pulsar "Guardar"; los mensajes de 0 y -1 aparecen además al teclear): 0,009 muestra "El margen mínimo es 0,01."; 0 y -1 muestran "El margen debe ser mayor que 0."; no se guarda nada. Función: los tres dan `invalid-argument` con "El margenHisteresis debe ser al menos 0.01.". La regla anterior no cambia. |
| AU-10 | VN con regla de AU-07. | Guardar umbral 60 con margen 60 y con margen 61 (formulario y función). Luego guardar umbral 60 con margen 59,99. | Con margen igual o mayor que el umbral: formulario "El margen debe ser menor que el umbral."; función `invalid-argument` "El umbralActivacion debe ser positivo y mayor que el margenHisteresis."; no se guarda. Con margen 59,99 (menor que el umbral por 0,01) se acepta y se guarda. |
| AU-11 | VN con regla de AU-07. | Guardar umbral 0 con margen 0,5; umbral -5 con margen 1 (formulario y función). | Formulario: bajo el umbral, "El umbral de activación debe ser positivo y mayor que el margen."; función: `invalid-argument` "El umbralActivacion debe ser positivo y mayor que el margenHisteresis.". No se guarda. |
| AU-12 | VN con regla de AU-07. | En el formulario, vaciar el umbral y guardar; luego vaciar el margen y guardar (el campo numérico no admite texto). Por la función, enviar `umbralActivacion: "60"` y `margenHisteresis: "30"` como texto. | Formulario: "Ingrese un umbral numérico." y "Ingrese un margen numérico."; no se guarda. Función: `invalid-argument` "El umbralActivacion debe ser un número válido." y "El margenHisteresis debe ser un número válido.". |
| AU-13 | `administrador`; llamadas directas a la función con un payload válido salvo un campo. | `variable: "presion"`; `activa: "si"` (texto); `modoControl: "turbo"`; `ventiladorId` ausente; `ventiladorId: "a/b"`. | Todas `invalid-argument`: "La variable debe ser una de: temperatura, humedad.", "El campo activa debe ser verdadero o falso.", "El modoControl debe ser uno de: manual, automatico, mixto.", "El ventiladorId es obligatorio." y "El ventiladorId no es válido.". Ninguna escribe. |
| AU-14 | `administrador`. | Con un payload válido, `ventiladorId: "no-existe"`. | `not-found`: "El ventilador solicitado no existe.". No se crea ninguna regla. |

## 2. Recorrido de punta a punta con el simulador

Los casos de esta sección se ejecutan en orden sobre **VS**, con el servicio y
el simulador corriendo, `/ventiladores` abierto como `administrador`, y con VN
y VB en modo `manual` o con la regla inerte. VS arranca "Apagado" (estado
inicial del simulador) y sin órdenes recientes.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-15 | VS en modo manual, "Apagado", sin regla. Leer el último valor `V` de temperatura. | En el formulario elegir VS, modo "Automático", variable "Temperatura", umbral `V − 1`, margen 0,2, "Regla activa" marcada y "Guardar". Esperar la siguiente medición y unos segundos más. | **Valor que cruza el umbral.** La medición evaluada tiene `valor` ≥ umbral. Se crea **una** orden para VS con `accionSolicitada: "encender"`, `origen: "automatico"`, `solicitadoPor: "sistema"`, `ventiladorId`, `incubadoraId` y `dispositivoId` correctos y `creadaEn`. Recorre `pendiente` → `enviando` → `enviada` (con `enviadaEn`) y llega a `ejecutada` (con `ejecutadaEn`, sin `error`). El simulador loguea `Estado de ventilador publicado en ...` con `"encendido":true`. En Firestore `ventiladores/<id de VS>.estadoActual` es `"encendido"`. En el log del servicio: `Orden <id> publicada en ".../ventiladores/<id de VS>/comando".`, `Ventilador <id de VS> actualizado a "encendido".` y `Orden <id> ejecutada (ventilador <id de VS> "encendido").`. |
| AU-16 | AU-15 hecho (VS "Encendido", regla sin cambios). | En el panel, mirar la tarjeta de VS. | El chip pasa a "Encendido" y "Última orden" muestra "Encender · <fecha y hora>" con "Ejecutada" y "El ventilador confirmó el cambio.", sin recargar. Los botones "Encender" y "Apagar" están deshabilitados con "El ventilador está en modo automático y no admite comandos manuales.". |
| AU-17 | AU-15 hecho. | Dejar la regla sin tocar durante al menos 6 mediciones (≥ 50 s). Contar las órdenes de VS. | **Sin tormenta de órdenes**: no se crea ninguna orden nueva. Cada medición sigue por encima del umbral, pero `estadoActual` ya coincide con el estado deseado. Sigue habiendo una sola orden `encender`. |
| AU-18 | VS "Encendido". Leer el último valor `V`. | Guardar la regla (modo automático) con umbral `V + 2` y margen 4 (zona de histéresis). Observar al menos 5 mediciones (≥ 40 s) y verificar en `mediciones` que cada `valor` quedó dentro de `(V − 2; V + 2)`. | **Valor que baja pero queda dentro del margen**: no se crea ninguna orden y el ventilador **no se apaga**. `estadoActual` sigue `"encendido"`; el panel sigue en "Encendido". |
| AU-19 | VS "Encendido", sin órdenes `apagar` recientes. Leer el último valor `V`. | Guardar la regla con umbral `V + 1` y margen 0,2 (límite de apagado `V + 0,8`). Esperar la siguiente medición. | **Valor por debajo de `umbralActivacion − margenHisteresis`**: el `valor` evaluado es ≤ `V + 0,8` y se crea **una** orden `apagar` (`origen: "automatico"`, `solicitadoPor: "sistema"`) que llega a `ejecutada`; `estadoActual` pasa a `"apagado"` y el chip a "Apagado". |
| AU-20 | AU-19 hecho. | Dejar la regla sin tocar durante al menos 6 mediciones. | No se crean más órdenes: `estadoActual` ya es `"apagado"`, el estado deseado. Sigue habiendo una sola orden `apagar`. |
| AU-21 | VS "Apagado"; pasaron más de 120 s desde la última orden `encender` de VS. Leer el último valor `H` de **humedad**. | Guardar la regla con variable "Humedad", umbral `H − 5` y margen 1 (modo automático, activa). Esperar la siguiente medición de humedad. | La regla de humedad se evalúa con las mediciones de humedad y se crea una orden `encender` automática que llega a `ejecutada`; `estadoActual` pasa a `"encendido"`. Las mediciones de temperatura no intervienen. La regla anterior (temperatura) fue reemplazada: sigue habiendo un solo documento de regla para VS. |

## 3. Modos manual, mixto y automático

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-22 | AU-21 hecho: VS "Encendido", regla de humedad que pide encender y activa, más de 120 s desde la última orden `encender`. | Cambiar VS a "Mixto" (regla activa). Desde el panel, como `administrador`, pulsar "Apagar". Observar durante 3 minutos. | **Conviven la automática y la manual.** El panel admite el comando: se crea una orden `apagar` con `origen: "manual"` y `solicitadoPor` igual al uid, que llega a `ejecutada`. En la primera medición posterior en que la regla vuelve a pedir "encender" y se cumplan los 120 s desde la última orden `encender`, se crea una orden `encender` con `origen: "automatico"` y `solicitadoPor: "sistema"` que también llega a `ejecutada`. Es decir, en modo mixto la automática puede revertir la manual (comportamiento documentado). Los botones del panel están habilitados en mixto. |
| AU-23 | AU-22 hecho; esperar más de 120 s desde la última orden `encender` de VS. | Cambiar VS a "Manual" y pulsar "Apagar". Observar al menos 6 mediciones. | **Ventilador en `manual`: no se crean órdenes automáticas**, aunque la regla de humedad siga pidiendo encender. `reglas_automatizacion/<id de VS>` conserva la regla (mismo `actualizadoEn`). VS queda "Apagado". |
| AU-24 | AU-23 hecho (VS manual, "Apagado"). | Elegir "Mixto", **desmarcar** "Regla activa" y guardar. Esperar al menos 6 mediciones. Después marcar "Regla activa" y guardar. | **Regla con `activa: false`: no se crean órdenes** mientras está inactiva (con `activa: false` en Firestore y la regla conservada). Al reactivarla, la primera medición posterior **que cruce el umbral** pide "encender" y se crea la orden automática, que llega a `ejecutada`: con el simulador el valor deriva y puede quedar dentro de la banda justo tras reactivar (sin orden, por la histéresis); si pasa, esperar la siguiente medición o mover la regla (0.6) justo antes de reactivarla. |
| AU-25 | VS en "Automático" con la regla activa (cualquier regla válida). | Comprobar el panel de VS y llamar a `enviarComandoVentilador` directamente (como en CV-19 del plan de control). | Los botones están deshabilitados y la función rechaza el comando manual con `failed-precondition` ("El ventilador está configurado en modo automático y no admite comandos manuales."), pero la automatización **sigue** creando órdenes cuando corresponde (por ejemplo, tras mover la regla con 0.6). |

## 4. Cooldown, órdenes en curso y reintentos

Estos casos usan **VN** (sin respuesta, `estadoActual: null`, que cuenta como
distinto de cualquier estado deseado) con el simulador corriendo, y **VB**
(sección 5). Los de VN se hacen con VS en `manual` para no mezclar efectos.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-26 | VS en `manual`. VN en modo automático, sin órdenes recientes. Leer `V`. | Guardar la regla de VN: umbral `V − 1`, margen 0,2 (pide encender). Anotar la `creadaEn` de la primera orden (t0). Observar las órdenes de VN hasta t0 + 110 s. | **Sin duplicados.** Hay exactamente **una** orden `encender` (`automatico`): queda `enviada` unos 30 s y pasa a `fallida` (entre 30 y 40 s después de `enviadaEn`, con `error: "El dispositivo no confirmó el estado en 30 s."`). Aunque `estadoActual` siga `null` y la orden ya esté `fallida`, **no** se crea otra hasta cumplirse 120 s desde t0: el cooldown cuenta órdenes en cualquier estado. |
| AU-27 | AU-26 hecho; la regla de VN sigue pidiendo encender. | Seguir observando después de t0 + 110 s. | En la primera medición que llega en o después de t0 + 120 s (hasta ~10 s más) se crea una **segunda** orden `encender`: es el reintento, espaciado por el cooldown. Una tercera no aparece antes de t0 + 240 s. Al terminar, devolver a VN al estado inerte. |
| AU-28 | VS en `manual`. VN en automático, sin órdenes recientes. Leer `V`. | Guardar para VN la regla de apagar (umbral `V + 1`, margen 0,2) y anotar t0 (`creadaEn` de la orden `apagar`). En la medición siguiente (~10 s después de t0) guardar la regla de encender (umbral `V − 1`, margen 0,2). Hacia t0 + 30 s guardar de nuevo la regla de apagar. Observar hasta t0 + 130 s. | **Tiempo mínimo entre ciclos de la misma acción.** Se crea `apagar` en t0 y `encender` en la medición siguiente a cambiar la regla (la acción contraria no bloquea). La nueva necesidad de apagar a t0 + ~30 s **no** genera orden (la `apagar` de t0 tiene menos de 120 s). Recién la primera medición en o después de t0 + 120 s que siga pidiendo apagar crea la segunda `apagar`. Al terminar, devolver a VN al estado inerte. |
| AU-29 | Después de la sección 5. VB en automático con regla `temperatura`, umbral 30, margen 0,5, activa; **servicio detenido**; sin órdenes `encender` de VB en los últimos 300 s (esperar si hace falta). | Enviar a VB una medición de 31 °C (0.7) y anotar t0 (`creadaEn`). Repetir la medición a ~100 s, a ~130 s y a ~310 s de t0, contando las órdenes de VB. | **Ventana de las órdenes en curso.** A t0 se crea **una** orden `encender` que queda `pendiente` (servicio detenido). A ~100 s no se crea otra (cooldown). A ~130 s tampoco: la orden sigue en curso y tiene menos de 300 s. A ~310 s sí se crea una nueva (la orden varada deja de bloquear). Al terminar, arrancar el servicio: las órdenes `pendiente` con más de 60 s pasan a `expirada`; una que tenga menos se publica y termina `fallida` (VB no contesta). |
| AU-30 | Después de AU-29. VB en automático con la regla de AU-29, servicio **corriendo**, sin órdenes `encender` de VB en los últimos 120 s (esperar si hace falta). | Enviar la medición de 31 °C (t0). Dentro de los 30 s, informar el estado `{"encendido": true}` de VB (0.7): la orden pasa a `ejecutada`. Informar `{"encendido": false}`. A ~60 s de t0 enviar otra medición de 31 °C; repetirla a ~125 s. | **El cooldown vale también tras `ejecutada`.** La primera crea la orden `encender` y el estado informado la cierra como `ejecutada` (`estadoActual: "encendido"`). Tras informar "apagado", la medición de ~60 s pide encender (el estado difiere del deseado) pero **no** se crea orden (la `encender` ejecutada tiene menos de 120 s). La de ~125 s sí crea una nueva. |

## 5. Bordes con valor exacto (banco de la incubadora B)

> Los casos AU-31 a AU-41 (y después AU-29 y AU-30, de la sección 4) comparten
> VB y sus tiempos de cooldown: ejecutarlos en ese orden, anotando la `creadaEn`
> de cada orden `apagar` y `encender`, y respetando las esperas indicadas. Todos
> usan el envío directo a `procesarMedicion` de 0.7. Partida: VB recién creado
> (`estadoActual: null`), en modo automático con la regla `temperatura`,
> **umbral 30, margen 0,5** (límite de apagado 29,5), activa, guardada con el
> formulario; el servicio corriendo. Las órdenes que no se informan a mano
> terminan `fallida` a los ~35 s, lo que no afecta a lo que se verifica.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-31 | El simulador corriendo en la incubadora A; VB sin órdenes. No enviar nada a B. | Observar 4 mediciones del simulador (≥ 30 s) mientras la regla de VB (umbral 30) estaría satisfecha por los 35–40 °C del simulador. | **La regla es por incubadora.** VB no recibe ninguna orden: las mediciones de la incubadora A no se evalúan contra las reglas de B. |
| AU-32 | VB sin órdenes. | Enviar a SB una medición de `temperatura` de 29,99 y después otra de 29,51. | Ambos valores quedan en la zona de histéresis (por debajo del umbral 30 y por encima del límite 29,5): **no se crea ninguna orden**. `procesarMedicion` responde 201 en las dos. |
| AU-33 | VB sin órdenes `apagar`; `estadoActual: null`. | Enviar una medición de 29,5 (exactamente el límite). Anotar t_a (`creadaEn`). | **Borde inclusivo del límite de apagado**: se crea **una** orden `apagar` (`automatico`), aunque `estadoActual` sea `null` (un estado desconocido cuenta como distinto del deseado). |
| AU-34 | AU-33 hecho. | Enviar una medición de 30 (exactamente el umbral). Anotar t_e. | **Borde inclusivo del umbral**: se crea **una** orden `encender` (`automatico`). La orden `apagar` anterior no la bloquea (acción contraria). |
| AU-35 | AU-33 y AU-34 hechos, ambas con menos de 120 s. | Enviar 29,49 y luego 30,01. | No se crea ninguna orden: 29,49 pide apagar, pero la `apagar` de t_a tiene menos de 120 s; 30,01 pide encender, pero la `encender` de t_e también (bloqueo por tiempo, también si ya están `fallida`). |
| AU-36 | AU-35 hecho. | Contando desde t_a: enviar 29,4 a ~110 s y de nuevo a ~125 s. Contando desde t_e: enviar 31 a ~110 s y a ~125 s. | A ~110 s no se crea orden (ni `apagar` ni `encender`); a ~125 s se crea una nueva orden `apagar` y otra `encender`. El límite es de 120 s por acción, sin importar que las órdenes anteriores ya estén `fallida`. |
| AU-37 | Esperar 120 s desde las últimas `apagar` y `encender` de VB. | Guardar umbral 30 y margen 0,01 (límite 29,99). Enviar 29,995 y después 29,99. | **Margen mínimo.** 29,995 está dentro de la banda: sin orden. 29,99 (el límite exacto) crea una orden `apagar`. |
| AU-38 | Esperar 120 s desde las últimas órdenes de VB. | Guardar umbral 0,3 y margen 0,1. Enviar 0,2000001, después 0,2 y después 0,3. | **Punto flotante.** 0,2000001 queda dentro de la banda: sin orden. 0,2 es el límite de apagado (0,3 − 0,1 da 0,19999999999999998 en punto flotante, pero la función lo redondea a 6 decimales): crea una orden `apagar`. 0,3 es el umbral: crea una orden `encender`. |
| AU-39 | Volver a guardar para VB la regla de temperatura con umbral 30 y margen 0,5. | Informar `{"encendido": true}` de VB (0.7); enviar 31. Informar `{"encendido": false}`; enviar 29. | **`estadoActual` ya coincide con el deseado: no se crea orden.** Con VB "encendido" la medición de 31 (pide encender) no genera orden; con VB "apagado" la de 29 (pide apagar) tampoco. No se evalúa el cooldown en ese caso. |
| AU-40 | VB "apagado" (AU-39); regla de `temperatura` umbral 30. | Enviar a SB una medición de **humedad** de 50 (que superaría el umbral 30 si se comparara). | **Variable distinta**: no se crea ninguna orden; la regla de VB es de temperatura y solo se evalúa con mediciones de temperatura. |
| AU-41 | Token de servicio disponible en el shell (0.7). | Enviar a `procesarMedicion` una medición con `valor: "abc"`, otra sin `valor` y otra con `valor: null`. | Cada una responde HTTP 400 ("valor debe ser un número válido." para el texto; `camposFaltantes: ["valor"]` para las otras dos). No se guarda ninguna medición ni se crea ninguna orden. |

## 6. Varios ventiladores en la misma incubadora

Sobre VS y VN (incubadora A), con el simulador corriendo.

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-42 | VS y VN en automático, sin órdenes recientes de encender; VS "Apagado". Leer `V`. | Guardar la regla de VS (encender: umbral `V − 1`, margen 0,2) y la de VN inerte (umbral 60, margen 30). | Solo VS recibe una orden `encender`; VN no recibe ninguna. Cada regla se evalúa por separado. |
| AU-43 | VS "Apagado"; sin órdenes `encender` de VS ni de VN en los últimos 120 s. Leer `V`. | Guardar para **ambos** la regla de encender (umbral `V − 1`, margen 0,2). | En la misma medición se crea una orden `encender` para cada uno. La de VS llega a `ejecutada`; la de VN queda `enviada` y termina `fallida` (30–40 s). Los desenlaces son independientes. |
| AU-44 | VS en `manual`. VN en automático, `estadoActual: null`, sin órdenes recientes: antes de empezar, dejar la regla de VN inerte (60/30) y esperar 120 s desde su última orden `encender` (por ejemplo, la de AU-43 si su regla de temperatura sigue activa), o el cooldown bloqueará la orden esperada. Leer el último valor `H` de humedad. | Guardar para VN la regla de **humedad** con umbral `H − 5` y margen 1. Observar 3 mediciones del simulador (cada una trae temperatura y humedad). | VN recibe una orden `encender` (la humedad está por encima del umbral) y **ninguna orden `apagar`**: las mediciones de temperatura (35–40 °C) quedarían muy por debajo del límite de apagado (`H − 6`, alrededor de 50) si se compararan con esta regla, pero la regla solo se evalúa con mediciones de humedad. Devolver a VN al estado inerte. |
| AU-45 | VS "Apagado" en automático con una regla que pide encender (0.6), sin órdenes `encender` recientes, y VN con la regla inválida: editar a mano en la consola `reglas_automatizacion/<id de VN>.umbralActivacion` a un texto (por ejemplo `"abc"`). Anotar el valor original. | Esperar 3 mediciones. Mirar los registros de la función `procesarMedicion`. | VN no recibe órdenes y el registro muestra la advertencia "La regla de automatización tiene valores inválidos." con el `reglaId`; **VS sigue recibiendo órdenes** y las mediciones se guardan (`procesarMedicion` responde 201). Restaurar el valor. |

## 7. Fallos del ventilador y del simulador

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-46 | VS en `manual`; VN en automático; simulador, servicio y panel abiertos. Leer `V`. | Guardar para VN la regla de encender (umbral `V − 1`, margen 0,2). Observar 3 minutos: las órdenes de VN, `mediciones` y el panel. | La orden automática de VN queda `enviada` y pasa a **`fallida`** a los 30–40 s, con `error: "El dispositivo no confirmó el estado en 30 s."`; el log del servicio muestra `Orden <id> fallida: El dispositivo no confirmó el estado en 30 s.`. El panel muestra a VN "Desconocido" con el bloque "Fallida" ("La orden no pudo completarse. Inténtalo nuevamente."). Mientras tanto **el procesamiento de mediciones no se rompe**: llega un documento nuevo por variable cada ~8 s en `mediciones`, `procesarMedicion` responde 201 y no hay "Error al evaluar la automatización de ventiladores." en sus registros. `estadoActual` de VN no cambia. |
| AU-47 | VS en modo automático con la regla de humedad de AU-21 (pide encender), "Encendido". | Detener el simulador (Ctrl+C) y esperar 60 s. Volver a arrancarlo y observar 2 minutos. | Con el simulador detenido no llegan mediciones: no se evalúa ninguna regla y no se crean órdenes automáticas (la automatización solo corre al llegar una medición). Al reiniciar, el simulador publica el estado "apagado" y `estadoActual` de VS pasa a `"apagado"` sin orden; en la primera medición posterior, si la regla pide encender y pasaron 120 s desde la última orden `encender`, se crea una nueva orden automática que llega a `ejecutada`. |

## 8. Concurrencia y carga

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-48 | VB en automático con la regla umbral 30 y margen 0,5; sin órdenes `encender` de VB en los últimos 300 s; `estadoActual` distinto de `"encendido"`. | Enviar a la vez cinco mediciones de 31 °C (en bash con `&` y `wait`, o en PowerShell 7 con `ForEach-Object -Parallel`). | Se guardan las cinco mediciones y se crea **una sola** orden `encender` (la lectura de las órdenes recientes y la creación van en una transacción: las demás se reintentan, ven la orden nueva y no crean otra). Repetir 3 veces con esperas de 300 s. **No verificado contra Firestore real al redactar el plan.** |
| AU-49 | Registros de Cloud Functions y uso de Firestore del proyecto. | Con el simulador corriendo, anotar la duración de `procesarMedicion` (`Function execution took N ms`) en al menos 10 ejecuciones: (a) sin ninguna regla activa, (b) con una regla activa en zona de histéresis y (c) con una regla que dispara. Anotar también las lecturas de Firestore por medición. | La función sigue respondiendo 201 en todos los casos. Por medición hay **una consulta** a `reglas_automatizacion` siempre; solo si hay una regla activa y el valor queda fuera de la banda se lee además el documento del ventilador y, si el estado difiere, las 10 órdenes recientes (en una transacción), y solo si hace falta se escribe una orden. Se registra la diferencia de duración y de lecturas en `Evidencia`. |

## 9. Permisos

| Caso | Precondición | Pasos | Resultado esperado |
| ---- | ------------ | ----- | ------------------ |
| AU-50 | VN en `manual` y sin regla. | Invocar `guardarReglaAutomatizacion` directamente (0.8 del plan de control) con `{ventiladorId: "<id de VN>", modoControl: "automatico", variable: "temperatura", umbralActivacion: 60, margenHisteresis: 30, activa: true}` como `operador`, como `consulta` y sin sesión. Luego como `administrador`. | `operador` y `consulta`: `permission-denied` ("Solo un administrador puede configurar la automatización de un ventilador."); sin sesión: `unauthenticated` ("Debes iniciar sesión para realizar esta acción."). **No se escribe nada**: `modoControl` sigue `"manual"` y no existe la regla. Como `administrador`: `ok: true` con `ventiladorId`, `modoControl: "automatico"` y "Configuración del ventilador guardada correctamente."; el modo y la regla quedan guardados. |
| AU-51 | Sesión de `operador`, luego de `consulta` y luego sin sesión. | Abrir `/ventiladores/automatizacion` escribiendo la URL; con `operador`, mirar además las tarjetas de `/ventiladores`. | `operador` y `consulta` se redirigen a `/sin-autorizacion` ("Acceso no autorizado"); sin sesión se redirige a `/login`. Las tarjetas del `operador` no tienen el enlace "Configurar modo y automatización". Solo el `administrador` configura reglas. |

## 10. Trazabilidad

| Requisito | Qué se comprueba | Casos |
| --------- | ---------------- | ----- |
| RF-019 / RF-020 (CU-02, evaluación de automatización) — configurar modo y regla | Alta, validación y permisos de la regla; modo manual, mixto y automático. | AU-01 a AU-14, AU-22 a AU-25, AU-50, AU-51 |
| RF-019 / RF-020 (CU-02) — histéresis | Cruce del umbral, zona sin órdenes, apagado bajo el límite, bordes inclusivos y punto flotante. | AU-15, AU-18, AU-19, AU-21, AU-32 a AU-38, AU-40 |
| RF-019 / RF-020 (CU-02) — sin duplicados ni oscilación | Sin órdenes con el estado ya coincidente, cooldown de 120 s, ventana de 300 s y atomicidad. | AU-17, AU-20, AU-26 a AU-30, AU-35, AU-36, AU-39, AU-48 |
| RF-019 / RF-020 (CU-02) — de punta a punta | Medición, orden automática, comando, estado del simulador, orden `ejecutada` y `estadoActual`. | AU-15, AU-16, AU-19, AU-21, AU-22 |
| RF-019 / RF-020 (CU-02) — tolerancia a fallos | Orden `fallida` sin romper mediciones; simulador detenido; regla inválida; dos ventiladores. | AU-42 a AU-47 |
| Operación | Carga adicional por medición. | AU-49 |

Las tarjetas de Notion y el repositorio no detallan cuál de los dos requisitos
(RF-019 o RF-020) cubre cada caso; por eso se trazan juntos.

## 11. Registro de resultados

Resultados de la ejecución local del 2026-10-18 (ver el recuadro de estado al
inicio: emuladores, broker local, commit `0ec7866`). `Resultado`: Pasó /
Parcial / Falló / Bloqueado. `Evidencia`: lo observado, con la ruta o el campo
donde se comprobó (ocultar tokens y credenciales). Las siglas H-nn remiten a
los hallazgos de abajo. Al repetir el plan, reemplazar estas filas con el
resultado de la nueva ejecución e indicar el entorno.

Totales: **51 casos: 50 Pasó, 1 Parcial (AU-49), 0 Falló, 0 Bloqueado.**

| Caso | Descripción | Resultado | Evidencia |
| ---- | ----------- | --------- | --------- |
| AU-01 | Ventilador nuevo: manual, formulario vacío, sin regla | Pasó | Con VN recién creado el formulario mostró Modo "Manual" con "Solo se aceptan comandos manuales.", variable "Temperatura", umbral y margen vacíos, "Regla activa" marcada, los campos de la regla deshabilitados y la nota de modo manual. En Firestore no existía la regla y `modoControl` era `manual`. |
| AU-02 | Guardar modo automático con regla válida | Pasó | Automático, Temperatura, 60, 30 y activa: aparecieron el aviso y "La configuración del ventilador se guardó correctamente.". En Firestore `modoControl: "automatico"` y la regla con `ventiladorId` e `incubadoraId` correctos, 60, 30, `activa: true` y `actualizadoPor` del administrador. |
| AU-03 | Guardar mixto con la regla inactiva | Pasó | Mixto con "Regla activa" desmarcada: apareció "Con la regla inactiva, el ventilador solo responderá a los comandos manuales." y se guardó `modoControl: "mixto"` con `activa: false`. |
| AU-04 | Automático con regla inactiva rechazado en el formulario | Pasó | Al elegir Automático con la regla inactiva apareció bajo la casilla "En modo automático la regla debe estar activa. Elija el modo Mixto si desea dejarla inactiva."; Guardar no llamó a la función (`modoControl` siguió en `mixto` y la regla con el mismo `actualizadoEn`). |
| AU-05 | Automático con regla inactiva rechazado por la función | Pasó | La función con `modoControl: "automatico"` y `activa: false` respondió 400 `INVALID_ARGUMENT` con el mensaje esperado ("En modo automático la regla debe estar activa...") y no cambió ni el modo ni la regla. |
| AU-06 | Manual conserva la regla guardada | Pasó | Manual más Guardar dejó `modoControl: "manual"` con la regla idéntica (mismo `actualizadoEn`, 60/30, inactiva). La llamada con `umbralActivacion: "texto"` y `margenHisteresis: -5` respondió 200 `ok: true` y tampoco tocó la regla. |
| AU-07 | Precarga y reemplazo: una regla por ventilador | Pasó | Al reabrir, el formulario se precargó con el modo `manual` y la regla guardada (60/30, inactiva, Temperatura). Guardar con umbral 61 dejó un solo documento de regla con el id del ventilador, con umbral 61 y `actualizadoEn` más reciente; se devolvió a 60. |
| AU-08 | Margen mínimo 0,01 aceptado | Pasó | Umbral 60 y margen 0,01 se guardaron: `margenHisteresis: 0.01` en Firestore. |
| AU-09 | Margen menor que 0,01, cero o negativo rechazado | Pasó | Formulario: margen 0,009 mostró "El margen mínimo es 0,01." y 0 y -1 "El margen debe ser mayor que 0."; no se guardó nada. Función: los tres valores dieron 400 `INVALID_ARGUMENT` "El margenHisteresis debe ser al menos 0.01.". Los mensajes aparecen al pulsar Guardar (los de 0 y -1 también al teclear). |
| AU-10 | Margen igual o mayor que el umbral rechazado | Pasó | Con umbral 60, margen 60 y 61 dieron "El margen debe ser menor que el umbral." en el formulario y 400 `INVALID_ARGUMENT` en la función, sin guardar. Margen 59,99 se aceptó (`margenHisteresis: 59.99`). |
| AU-11 | Umbral cero o negativo rechazado | Pasó | Umbral 0 con margen 0,5 y umbral -5 con margen 1: el formulario mostró "El umbral de activación debe ser positivo y mayor que el margen." y la función respondió 400 `INVALID_ARGUMENT` "El umbralActivacion debe ser positivo y mayor que el margenHisteresis."; no se guardó. |
| AU-12 | Campos vacíos o no numéricos rechazados | Pasó | Formulario: umbral vacío mostró "Ingrese un umbral numérico.", margen vacío "Ingrese un margen numérico." y ambos vacíos los dos mensajes. Función con "60" y "30" como texto: 400 `INVALID_ARGUMENT` "El umbralActivacion debe ser un número válido." y "El margenHisteresis debe ser un número válido.". |
| AU-13 | Variable, activa, modo y ventiladorId inválidos | Pasó | Con un campo inválido por llamada (`variable: "presion"`, `activa: "si"`, `modoControl: "turbo"`, sin `ventiladorId` y `ventiladorId: "a/b"`) la función respondió 400 `INVALID_ARGUMENT` con los cinco mensajes esperados, sin escribir nada. |
| AU-14 | Ventilador inexistente | Pasó | Con `ventiladorId: "no-existe"` y un payload válido la función respondió 404 `NOT_FOUND` "El ventilador solicitado no existe." y no se creó ninguna regla. |
| AU-15 | Cruce del umbral: orden automática de encender hasta `ejecutada` | Pasó | Con la regla de VS guardada por la función (la misma que usa el formulario, para cumplir la ventana de ~40 s) en umbral V - 1 y margen 0,2, la medición evaluada (37,63, mayor que 36,6) creó una sola orden `encender` (`origen: "automatico"`, `solicitadoPor: "sistema"`) que pasó por `enviadaEn` y `ejecutadaEn` en ~160 ms hasta `ejecutada`, sin `error`. `estadoActual: "encendido"`. |
| AU-16 | Panel: estado, última orden y botones bloqueados | Pasó | La tarjeta de VS mostró el chip "Encendido", "Modo de control: Automático" y la última orden "Encender" en "Ejecutada" con "El ventilador confirmó el cambio.", con los botones deshabilitados por "El ventilador está en modo automático y no admite comandos manuales.". |
| AU-17 | Sin tormenta de órdenes con el estado ya coincidente | Pasó | Durante 8 mediciones (~64 s), todas por encima del umbral, no se creó ninguna orden nueva: siguió habiendo una sola `encender`. |
| AU-18 | Zona de histéresis: ni encender ni apagar | Pasó | Con la regla 39,3/4 (límite de apagado 35,3), las 6 mediciones evaluadas en 46 s (entre 37,1 y 37,28) quedaron dentro de la banda: 0 órdenes nuevas y `estadoActual` siguió en `"encendido"`. |
| AU-19 | Por debajo del límite de apagado: orden de apagar | Pasó | Con la regla 38,2/0,2 (límite de apagado 38,0), la medición 37,19 creó una orden `apagar` (`automatico`/`sistema`) que llegó a `ejecutada`; `estadoActual` pasó a `"apagado"`. |
| AU-20 | Sin órdenes con el ventilador ya apagado | Pasó | Con 7 mediciones por debajo del límite y el ventilador ya `apagado` no se creó ninguna orden más: sigue habiendo una sola `apagar`. |
| AU-21 | Regla sobre humedad | Pasó | Con la regla de humedad 50,8/1 (H = 55,77), la medición de humedad 56,53 creó una orden `encender` automática que llegó a `ejecutada` (`estadoActual: "encendido"`). Las mediciones de temperatura no intervinieron y sigue habiendo un solo documento de regla para VS (reemplazó a la de temperatura). |
| AU-22 | Modo mixto: conviven la manual y la automática | Pasó | En mixto, el Apagar manual del panel creó una orden `apagar`/`manual` con `solicitadoPor` del administrador que llegó a `ejecutada`. En la primera medición posterior (a los ~8 s) la regla creó una `encender`/`automatico`/`sistema` que también llegó a `ejecutada` y revirtió la manual. Se observó ~2,2 min en vez de 3, suficiente porque la reversión ocurrió a los 8 s. |
| AU-23 | Modo manual: sin órdenes automáticas | Pasó | En Manual (regla de humedad 50,8/1 conservada, mismo `actualizadoEn`) se pulsó Apagar y durante 75 s (10 mediciones, todas por encima del umbral) no se creó ninguna orden automática; solo la manual. VS quedó "Apagado". |
| AU-24 | Regla inactiva: sin órdenes; al reactivarla vuelve a operar | Pasó | Con la regla inactiva (Mixto), 7 mediciones en 56 s (las 5 primeras habrían pedido encender) no crearon órdenes y `activa: false` se conservó. Al reactivarla, la 1.ª medición (50,1) quedó dentro de la banda sin orden y la 2.ª (51,11) creó la orden automática `encender`, que llegó a `ejecutada` (H-10, plan corregido). |
| AU-25 | Automático rechaza manuales y la regla sigue operando | Pasó | En Automático el panel deshabilitó los botones con el texto esperado y `enviarComandoVentilador` dio 400 `FAILED_PRECONDITION` para administrador y operador. Tras mover la regla (38,3/0,2) la automatización siguió operando: creó una orden `apagar`/`automatico`/`sistema` que llegó a `ejecutada`. |
| AU-26 | Sin duplicados con la orden anterior `fallida` (cooldown) | Pasó | Con la regla de encender sobre VN (36,8/0,2), la 1.ª orden automática pasó a `enviada` y a `fallida` (~39 s después de `enviadaEn`, "El dispositivo no confirmó el estado en 30 s."). A t0 + 110 s seguía habiendo una sola orden, aunque `estadoActual` era `null`. VS estaba en mixto y no en manual, sin interferir. |
| AU-27 | Reintento al cumplirse los 120 s | Pasó | La 2.ª orden `encender` automática se creó a t0 + 120,1 s (en la 1.ª medición posterior a los 120 s) y la 3.ª a t0 + 240,25 s; entre ambas no hubo otra. VN se devolvió a la regla inerte 60/30. |
| AU-28 | Tiempo mínimo entre ciclos de la misma acción | Pasó | En VN: `apagar` en t0, `encender` ~16 s después (la acción contraria no bloquea), nueva necesidad de apagar a t0 + 30 s sin orden por el cooldown, y 2.ª `apagar` a t0 + 120,14 s. Se volvió a guardar la regla a t0 + 100 s con un valor nuevo para asegurar que la medición siguiera fuera de banda (permitido por 0.6). |
| AU-29 | Ventana de 300 s de una orden en curso | Pasó | Con el servicio detenido y VB (regla 30/0,5), una medición de 31 °C creó una orden `encender` que quedó `pendiente`; a ~100 s y a ~130 s no se creó otra y a ~310 s se creó la 2.ª. Al arrancar el servicio, la 1.ª pasó a `expirada` ("tiene 322 s y el máximo es 60 s") y la 2.ª se publicó y terminó `fallida`. |
| AU-30 | El cooldown vale también tras `ejecutada` | Pasó | En VB, la medición de 31 °C creó una orden `encender` que se cerró como `ejecutada` al informar `{"encendido": true}` a mano. Tras informar `"apagado"`, la medición de ~60 s no creó orden (cooldown de 120 s tras `ejecutada`) y la de ~125 s creó una nueva. |
| AU-31 | La regla es por incubadora | Pasó | Con la regla de VB (incubadora B) guardada con el formulario, durante 36 s el simulador de la incubadora A publicó 5 mediciones (todas mayores que 30) y VB no recibió ninguna orden. |
| AU-32 | Zona de histéresis con valor exacto cerca de los bordes | Pasó | `procesarMedicion` con 29,99 y 29,51 (incubadora B): ambas respondieron HTTP 201 `ok: true` y no se creó ninguna orden (zona de histéresis). |
| AU-33 | Límite de apagado exacto (inclusivo) con estado `null` | Pasó | Con `estadoActual` en `null`, la medición 29,5 (límite de apagado exacto) respondió 201 y creó una orden `apagar`/`automatico`/`sistema`, que terminó `fallida` por falta de respuesta de VB. |
| AU-34 | Umbral exacto (inclusivo) | Pasó | La medición 30 (umbral exacto) respondió 201 y creó una orden `encender`/`automatico`/`sistema`; la `apagar` anterior no la bloqueó. |
| AU-35 | Cooldown con valores en los bordes | Pasó | Con las dos órdenes de menos de 1 s, las mediciones 29,49 y 30,01 respondieron 201 y no crearon órdenes (total 2): bloqueo por tiempo de la misma acción. |
| AU-36 | Cooldown a ~110 s y ~125 s | Pasó | A ~110 s de t_a y t_e (ambas ya `fallida`) las mediciones 29,4 y 31 no crearon órdenes; a ~125 s se creó una `apagar` y una `encender` nuevas. |
| AU-37 | Margen mínimo 0,01 en la evaluación | Pasó | Con margen 0,01 (límite 29,99): 29,995 respondió 201 sin orden y 29,99 (límite exacto) creó una orden `apagar`. |
| AU-38 | Punto flotante (0,3 − 0,1) | Pasó | Con umbral 0,3 y margen 0,1: 0,2000001 no creó orden, 0,2 creó una `apagar` y 0,3 una `encender`, con más de 120 s desde las órdenes previas de VB. |
| AU-39 | `estadoActual` ya coincide: sin orden | Pasó | Con VB informado como `"encendido"` a mano, la medición 31 no creó orden; con VB `"apagado"`, la medición 29 tampoco. Ambas respondieron 201. |
| AU-40 | Variable distinta: sin orden | Pasó | Una medición de humedad de 50 contra la regla de temperatura de VB (con VB "apagado") respondió 201 y no creó órdenes. |
| AU-41 | `valor` inválido en `procesarMedicion` | Pasó | `procesarMedicion` con `valor: "abc"` respondió 400 "valor debe ser un número válido."; sin `valor` y con `null`, 400 con `camposFaltantes: ["valor"]`. La colección `mediciones` no cambió (508 documentos antes y después) y no se creó ninguna orden. |
| AU-42 | Dos ventiladores: dispara solo uno | Pasó | Con la regla de VS en 36,0/0,2 y la de VN inerte (60/30), solo VS recibió una orden `encender` (llegó a `ejecutada`); VN no recibió ninguna. VS estaba en `manual` y pasó a automático al guardar su regla. |
| AU-43 | Dos ventiladores: disparan los dos, desenlaces independientes | Pasó | Con la misma regla de encender para ambos, la misma medición creó dos órdenes `encender` automáticas, una por ventilador: la de VS llegó a `ejecutada` y la de VN terminó `fallida` a los ~35 s. |
| AU-44 | Cada regla con su variable | Pasó | Con la regla de humedad de VN (38,5/1), 3 mediciones produjeron una sola orden `encender` y ninguna `apagar`, aunque las 3 temperaturas (37,08, 36,94 y 36,99) estaban por debajo de 37,5. El caso se repitió: la 1.ª ejecución quedó invalidada por el cooldown de una orden de AU-43 (H-09, plan corregido). |
| AU-45 | Regla inválida de un ventilador no frena al otro | Pasó | Con `umbralActivacion` de la regla de VN editado a "abc", VS siguió recibiendo órdenes (una `encender` automática llegó a `ejecutada`), VN no recibió ninguna, las mediciones se guardaron y el log de la función mostró 3 veces "La regla de automatización tiene valores inválidos." con el `reglaId`. Se restauró el valor. |
| AU-46 | Orden `fallida` sin romper el procesamiento de mediciones | Pasó | Las órdenes automáticas de VN pasaron a `enviada` y a `fallida` (~35 s) con el error esperado, y el panel mostró VN "Desconocido" con el bloque "Fallida". En 180 s llegaron 22 mediciones de temperatura y 22 de humedad a intervalos de 8 s, sin "Error al evaluar la automatización de ventiladores." en el log de la función; `estadoActual` de VN siguió en `null`. |
| AU-47 | Simulador detenido y reiniciado | Pasó | Con el simulador detenido 60 s no llegaron mediciones ni se crearon órdenes. Al reiniciarlo publicó "apagado" (`estadoActual` pasó a `"apagado"` sin orden) y con la primera medición posterior (más de 120 s desde la última `encender`) se creó una `encender` automática que llegó a `ejecutada`. |
| AU-48 | Cinco mediciones simultáneas: una sola orden | Pasó | En 3 tandas de 5 mediciones simultáneas de 31 °C a `procesarMedicion` (separadas por más de 300 s) hubo 5 respuestas 201 y 5 mediciones guardadas por tanda, y una sola orden `encender` en cada una. Es el resultado en el emulador de Firestore: la atomicidad no está verificada contra Firestore real. |
| AU-49 | Carga adicional por medición | Parcial | Contra el emulador, la mediana de duración de `procesarMedicion` fue ~63 ms sin regla o con la regla en la banda, ~113 ms con la regla fuera de banda y la orden bloqueada por cooldown o estado, y ~120 ms al crear la orden (lotes de 10 mediciones, todas 201). Las lecturas de Firestore no se pueden contar en el emulador y se dedujeron del código; los tiempos no son representativos de Cloud Functions reales. |
| AU-50 | `guardarReglaAutomatizacion`: rol equivocado y sin sesión | Pasó | Con un ventilador nuevo: operador y consulta recibieron 403 `PERMISSION_DENIED` y sin sesión 401 `UNAUTHENTICATED`, sin escribir nada (`modoControl` siguió `manual` y no existe la regla). El administrador recibió 200 `ok: true` con `modoControl: "automatico"` y quedaron guardados el modo y la regla. |
| AU-51 | Formulario de reglas solo para el administrador | Pasó | Operador y consulta redirigieron a `/sin-autorizacion` y sin sesión a `/login`; las tarjetas de `/ventiladores` del operador no tienen el enlace "Configurar modo y automatización". |

### Hallazgos de la ejecución

Defectos y fricciones que dejó la ejecución local y que afectan a este plan.
Ninguno hizo fallar un caso. **Todos están pendientes de corrección** (esta
documentación no los arregla).

| ID | Qué se observó | Impacto | Estado |
| -- | -------------- | ------- | ------ |
| H-01 | `enviarComandoVentilador` responde `INTERNAL` (HTTP 500) cuando `ventiladorId` no es un id de documento válido (`"a/b"`, `"."`, `".."`, `"__x__"`). `guardarReglaAutomatizacion` sí valida esos ids y responde `invalid-argument` (AU-13). Este plan llama a `enviarComandoVentilador` en AU-25. | Baja. No se crea ninguna orden, pero el cliente recibe un error genérico y se registra un error no controlado. | Pendiente de corrección. Al corregirlo, agregar un caso al plan de control de ventiladores (por ejemplo, CV-34 con `"a/b"`). |
| H-02 | `frontend/.env` y `functions/.secret.local` no están ignorados por git. El plan (0.5) indica crear `frontend/.env`. | Baja. Un commit accidental de esos archivos. En la ejecución se usó `frontend/.env.local`, que sí está ignorado. | Pendiente de corrección. |
| H-03 | Con `firebase-tools` 15.28.2 y `firebase-admin` 12.7.0, el emulador de Functions deja `admin.firestore.FieldValue` en `undefined` y toda función que escribe con `serverTimestamp()` falla con `INTERNAL`. En producción no ocurre. | Info. Hace falta un workaround local para ejecutar el plan en emuladores (ver `docs/pruebas/ejecucion-local-emuladores.md`). | Pendiente de corrección en el código (importar `FieldValue` y `Timestamp` desde `firebase-admin/firestore`). |
| H-05 | El alta de dispositivos (`/incubadoras/<id>/editar`) informa solo el `identificadorMqtt`, no el id del documento de `dispositivos/`. Ese id es el que piden el simulador, los tópicos MQTT y este plan (0.3, punto 3). | Menor. Hay que leerlo de Firestore, lo que es una fricción operativa. | Pendiente de corrección. |
| H-11 | AU-48 (cinco mediciones simultáneas, una sola orden) dio el resultado esperado en las 3 tandas, pero contra el emulador de Firestore. La primera tanda tardó ~23,5 s por el arranque en frío de los workers del emulador. | Info. Sin evidencia de problema; la atomicidad sigue sin verificarse en Firestore real. | Pendiente de verificar en Firestore real. |

Los identificadores H-nn son los de la ejecución y se mantienen iguales en
`docs/pruebas/plan-pruebas-control-ventiladores.md`. Además, la ejecución
encontró desviaciones del plan, que **ya se corrigieron en este documento**:

- **H-06.** El `Sidebar` sí está montado y no tiene ítem para
  `/ventiladores/automatizacion` (0.5).
- **H-08.** AU-09: los mensajes de validación del formulario aparecen al pulsar
  "Guardar" (algunos también al teclear).
- **H-09.** AU-44: puede invalidarse si la regla de VN del caso anterior sigue
  activa; ahora la precondición pide dejarla inerte (60/30) y esperar 120 s.
- **H-10.** AU-24: al reactivar la regla, lo que crea la orden es la primera
  medición posterior que cruce el umbral, no necesariamente "la primera".

## Notas

- **Ejecución local, no real.** El plan se ejecutó el 2026-10-18 en un entorno
  local (ver el recuadro de estado al inicio): sus resultados no sustituyen una
  pasada contra Firebase y HiveMQ Cloud reales, que sigue pendiente.
- Los casos de validación de la sección 1 (AU-05, AU-09 a AU-14) y AU-50
  pueden ejecutarse con el emulador de Functions y AU-51 solo necesita el
  frontend con Firebase Auth; el resto necesita el Servicio de Integración y un
  broker (en la ejecución local, uno propio y no HiveMQ Cloud), y AU-48 y AU-49
  se apoyan en el comportamiento de Firestore y Cloud Functions reales.
- `docs/contrato-mqtt.md` describe los tópicos con el prefijo `mtpa/`, pero el
  valor efectivo es el de `MQTT_TOPIC_PREFIX` (`mtpa-dev` por defecto).
- **Cómo se verifica el valor evaluado.** Para los casos del simulador, el
  `valor` real evaluado siempre se lee de `mediciones`: si el valor no cayó
  donde la regla de 0.6 lo pretendía, el caso es inválido y se repite. Para los
  bordes exactos se usa el envío directo de 0.7, que no pasa por el simulador
  ni por el servicio; por eso solo comprueba `procesarMedicion` y la
  evaluación, no el camino MQTT de entrada.
- **No se prueba la falla interna de la automatización.** El aislamiento por
  `try/catch` (una falla de `evaluarAutomatizacion` no impide guardar la
  medición, y una regla que lanza una excepción no frena a las demás) exige
  inyectar un error en Firestore o en el código, que este plan no hace; los
  casos AU-45 y AU-46 comprueban lo que sí se observa desde afuera.
- **Límites conocidos** (ver `docs/modelo-datos.md` y `docs/contrato-mqtt.md`;
  son observaciones, no casos que deban pasar):
  - Pueden coexistir órdenes de acciones contrarias: una `encender` en curso no
    bloquea a una `apagar` nueva (y viceversa); el ventilador recibe ambas en
    orden (se ve en AU-28 y AU-33/AU-34).
  - Con varias órdenes en vuelo de la misma acción para un ventilador, un
    estado reportado puede cerrar una orden `enviada` que no es la que lo
    provocó, y solo se correlacionan las 10 órdenes más recientes.
  - Los dispositivos reales deben ser idempotentes por `ordenId`: el comando
    viaja con QoS 1 (al menos una entrega) y puede repetirse o llegar tarde. El
    simulador lo cumple solo porque `encender` y `apagar` son idempotentes.
  - Si el Servicio de Integración muere entre reclamar una orden y marcarla
    `enviada`, la orden queda `enviando` sin que nadie la cierre.
  - Una orden manual de la misma acción también cuenta para el cooldown y la
    ventana: la deduplicación no distingue el `origen`.
  - En modo mixto, una orden manual puede ser revertida por la automática en la
    siguiente medición fuera de banda, una vez cumplido el cooldown (AU-22).
  - Si el ventilador no reporta su estado (apagado o sin comunicación),
    `estadoActual` no se actualiza y la automatización pide a lo sumo una orden
    por acción cada 120 s si las órdenes terminan, o cada 300 s si quedan
    varadas.
  - La automatización solo corre cuando llega una medición de esa incubadora y
    variable: sin mediciones (sensor desconectado, servicio detenido) no hay
    órdenes ni correcciones (AU-47).
  - La atomicidad (AU-48) se apoya en que la consulta dentro de la transacción
    impide inserciones concurrentes; no se probó contra Firestore real.
- Una vez ejecutado el plan, completar la sección 11 y, si algún caso falla,
  abrir una incidencia con el identificador del caso y la evidencia.
