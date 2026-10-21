# Guion de la demo de avances (Sprints 1 a 4)

Guion para quien presenta. Dura unos 10-12 minutos. Todos los comandos son **bash**
(en Windows, Git Bash) y se ejecutan desde la raíz del repositorio. Los textos entre
comillas son los reales de la interfaz.

## 1. Qué se muestra y qué NO

Se muestra lo implementado en los Sprints 1 a 4:

- autenticación y roles (administrador, operador, usuario de consulta);
- gestión de usuarios;
- incubadoras y dispositivos;
- monitorización en tiempo real (temperatura, humedad, conexión, estado general);
- umbrales y alertas con su ciclo de vida;
- ventiladores: control manual y automático (histéresis).

**No se muestra, porque todavía no está implementado** (Sprints 5 y 6): históricos,
estadísticas, exportación de datos y auditoría. Sus entradas del menú están ocultas a
propósito, las páginas de históricos, estadísticas y auditoría son archivos vacíos sin ruta, y los módulos
de apoyo del servidor (`functions/lib/estadisticas.js`, `reportes.js`) no están conectados a ninguna función. Si
preguntan: «están planificados para los Sprints 5 y 6»; no abras esas URL.

## 2. Preparación previa (hacela antes, no delante del público)

Los datos de demo se manejan con dos scripts de `functions/scripts/` (no se despliegan):

| Script | Para qué |
| ------ | -------- |
| `cargar-datos-demo.js` | Crea usuarios operador y consulta, 3 incubadoras, dispositivos, umbrales, 12 h de histórico sano y alertas de ejemplo. Idempotente. Con `--solo-claves` solo restablece las claves de operador y consulta. |
| `escenario-demo.js` | `estado` (lectura), `preparar` (antes de arrancar el servicio), `refrescar` (datos frescos) y los escenarios en vivo `calor`, `normal`, `humedad-baja`, `humedad-normal`. |

Ambos son **simulacro por defecto**: sin `--confirmar` no escriben nada y muestran contra
qué proyecto actuarían. Exigen `--proyecto` y, contra un proyecto real, que la clave de
`GOOGLE_APPLICATION_CREDENTIALS` sea de ese mismo proyecto. Además hacen un **PRE-VUELO**
(también en el simulacro, sin escribir datos): comprueban el intercambio del token del
administrador con su claim de rol (crea solo una sesión del administrador) y que la API key sea
del proyecto, y que el token de `procesarMedicion` sea el correcto (`POST {}`: 400 si es válido,
403 si no). Si algo falla, con `--confirmar` abortan **antes** de escribir. Los escenarios que
escriben rechazan las incubadoras cuyo nombre no lleva «(demo)» (protege la incubadora real);
solo se aplican a ellas con `--incluir-no-demo` (vale para `calor`, `normal`, `humedad-*` y `refrescar`). `preparar` es la excepción documentada: actúa sobre TODAS las incubadoras y solo cambia el estado de conexión de un «conectado» viejo a «desconocido».

### 2.1 Variables (en la terminal donde corras los scripts)

```bash
export GOOGLE_APPLICATION_CREDENTIALS="<ruta a la clave de cuenta de servicio de mtpa-dev>.json"
export PROCESAR_MEDICION_TOKEN="<el mismo token que usa el Servicio de Integración>"
export VITE_FIREBASE_API_KEY="<la API key web que ya tenés en frontend/.env>"
```

Si exportás `PROCESAR_MEDICION_URL`, tiene que ser la de `mtpa-dev`; si no, el script aborta.

### 2.2 Antes de cargar nada (en este orden)

1. **Sin variables de emulador heredadas.** `printenv | rg -i "EMULATOR|PROCESAR_MEDICION_URL|GOOGLE_CLOUD_PROJECT"` no debe mostrar `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` ni `GOOGLE_CLOUD_PROJECT` (si aparecen: `unset`); `PROCESAR_MEDICION_URL` solo puede ser la de `mtpa-dev`.
2. **API key del proyecto.** `VITE_FIREBASE_PROJECT_ID` de `frontend/.env` debe ser `mtpa-dev`; la API key que exportes tiene que ser de ese proyecto (si no, el pre-vuelo lo dice).
3. **Dependencias.** `npm install --prefix functions` hecho: los scripts usan `functions/node_modules`.
4. **Mirar lo que ya hay.** Corré `estado` ANTES de cargar y anotá el nombre real de la incubadora del usuario y el `estadoConexion` y las alertas de sus dispositivos:

   ```bash
   node functions/scripts/escenario-demo.js estado --todas --proyecto mtpa-dev
   ```

5. **Preparar la conexión, con el Servicio de Integración DETENIDO.** Al arrancar, el servicio carga como «conectado» todo dispositivo que figure así en Firestore (sin mirar la fecha); si en 30 s no recibe señales, lo marca «desconectado», crea una alerta «Dispositivo desconectado» y la incubadora queda «Crítico» (reproducido: 6 alertas falsas al reiniciar el servicio con 6 dispositivos «conectado» sin señales). `preparar` los deja en «desconocido», el valor de un dispositivo recién creado (el servicio no lo carga y la pantalla muestra «Desconocido»), solo si figuran «conectado» con más de **150 s** sin comunicación (el servicio solo refresca esa fecha cada 60 s, así que un dispositivo vivo tiene entre 0 y ~68 s):

   ```bash
   node functions/scripts/escenario-demo.js preparar --proyecto mtpa-dev              # simulacro: solo lista
   node functions/scripts/escenario-demo.js preparar --proyecto mtpa-dev --confirmar
   ```

   Si hay dispositivos «conectado» con menos de 90 s de comunicación avisa «el Servicio de Integración parece estar activo: detenelo antes de preparar» y, con `--confirmar`, se niega salvo que agregues `--aunque-el-servicio-este-activo`. **Tras cualquier corrida interrumpida** (Ctrl+C o caída de los scripts), esperá unos 150 s y corré `preparar --confirmar` antes de arrancar el servicio.

   `preparar` también lista los dispositivos «desconectado» y las alertas de desconexión abiertas, pero **no los corrige**: una incubadora con un dispositivo «desconectado» sigue «Crítico» hasta que vuelva a enviar latidos. Si es la incubadora real y no va a emitir, resolvé esa alerta desde la interfaz como administrador u operador o dejala (y no la muestres). Si el reloj de la notebook difiere más de ~1 min del de Firebase, «reciente» puede clasificarse mal.

### 2.3 Cargar los datos (por etapas, ANTES de arrancar el servicio)

```bash
# 1) Simulacro: mirá "Proyecto destino : mtpa-dev", el PRE-VUELO y qué crearía.
node functions/scripts/cargar-datos-demo.js --proyecto mtpa-dev --admin-email <correo-del-admin-existente>

# 2) Etapa corta: usuarios, incubadoras, dispositivos, umbrales y regla. Prueba API key, claim y callables.
node functions/scripts/cargar-datos-demo.js --proyecto mtpa-dev --admin-email <correo-del-admin-existente> --confirmar --sin-historico --sin-alertas

# 3) Carga completa (de 1 a 3 minutos): histórico y alertas.
node functions/scripts/cargar-datos-demo.js --proyecto mtpa-dev --admin-email <correo-del-admin-existente> --confirmar
```

**Después de la carga definitiva no vuelvas a correr el cargador sin `--sin-historico`** (con `--sin-historico --sin-alertas` no se envía nada y tampoco se toca el estado de conexión) (si hace falta, `--sin-historico --sin-alertas`). Aunque el script es idempotente (verificado: segunda corrida inmediata y otra 14 min después, cruzando franjas de 10 min, sin duplicar lecturas y sin tocar las alertas de B), un histórico nuevo puede alterar lo que ya está ensayado.

Opciones útiles: `--operador-email` y `--consulta-email` (por defecto
`operador.demo@mtpa.test` y `consulta.demo@mtpa.test`), `--help`.

Qué deja:

| Elemento | Detalle |
| -------- | ------- |
| Usuarios | `operador` y `consulta` de demo. El administrador existente NO se toca. Las claves se generan al azar y se guardan **solo** en `functions/scripts/demo-credenciales.local.json`, bajo `real:mtpa-dev` (git lo ignora; el script nunca las imprime: abrí el archivo). En Windows el archivo queda con los permisos de la carpeta (el modo 0o600 no aplica): no lo compartas. Si no hay clave guardada: `--restablecer-claves`. |
| Incubadoras | «Incubadora A - Lote 1 (demo)» y «Incubadora B - Lote 2 (demo)» (activas, con sensor de temperatura, sensor de humedad y ventilador) y «Incubadora C - En mantenimiento (demo)» (inactiva, sin dispositivos). |
| Umbrales | Temperatura 36.5 a 38.5 °C, humedad 50 a 65 %. |
| Automatización | Ventilador de A: modo Mixto, temperatura ≥ 38.5 °C enciende, histéresis 1.5 (apaga con ≤ 37.0 °C). Ventilador de B: Manual, sin regla. |
| Histórico | 12 h de lecturas sanas cada 10 min en A y B (temperatura entre 37.1 y 37.8; humedad entre 55 y 61). No generan alertas ni órdenes. En una incubadora con alertas abiertas (la B) las corridas posteriores NO envían histórico: una lectura sana las resolvería. |
| Alertas (todas en B) | Temperatura alta **Resuelta**, humedad baja **Reconocida**, temperatura baja **Activa** (queda abierta). La A empieza limpia: estado **Normal**. Si una corrida murió a medias o alguien las tocó, la siguiente las deja exactamente así. |

Al terminar imprime los ids de incubadora y dispositivos. Los necesitás para el simulador.

### 2.4 Arrancar todo (una terminal por cosa)

| Terminal | Comando |
| -------- | ------- |
| 1. Servicio de Integración | `cd iot-integration-service && npm start` |
| 2. Simulador (ver nota) | `export SIMULADOR_INCUBADORA_ID=<id de A>` `export SIMULADOR_VENTILADOR_ID=<id del ventilador de A>` `cd iot-integration-service && npm run simulator` |
| 3. Frontend | `cd frontend && npm run dev` |
| 4. Comandos del presentador | variables de 2.1 ya exportadas |

**Nota sobre el simulador (importante).** El simulador publica cada 8 s una temperatura
y una humedad que caminan al azar (la humedad se sale de 50-65 en pocos minutos). Si lo
arrancás con el sensor real (`SIMULADOR_SENSOR_ID`), pisa las lecturas de los
escenarios: probado, una alerta de `calor` quedó resuelta 3 s después. Por eso el
cargador NO imprime esa variable y se arranca **sin** `SIMULADOR_SENSOR_ID`: su sensor por
defecto no existe en Firestore, `procesarMedicion` lo descarta con un 404 y el Servicio de
Integración imprime ese error cada 8 s en la terminal 1 (es esperado; no lo cierres). El
simulador sigue aportando lo importante: los latidos y el ventilador. No cambies de modo a
mitad de la demo.

**Frontend.** El puerto 5173 suele estar ocupado por otro proyecto y Vite pasa al **5174**:
usá la dirección que imprime la terminal 3.

### 2.5 Frescura de los datos (qué pasa con el paso del tiempo)

Medido en el emulador desplazando 10 h las lecturas: el panel **no tiene ningún aviso de dato
viejo**. Con la última lectura de hace 10 h muestra el valor como si fuera actual:
«Última lectura: 23:30», «Última actualización» con la fecha de ayer, y todo «Normal». La
tarjeta «Estado de conexión» sale distinta: no depende de las lecturas sino del estado de los
dispositivos; con el simulador corriendo (latidos del ventilador) dice «Conectado - Última
comunicación: hace unos segundos», y sin él «Desconectado - Sin información».

Como los datos se cargan con la hora de la carga, el día de la presentación hay que
**refrescarlos** (envía lecturas ahora y pasa por la lógica real; no crea alertas ni órdenes mientras la incubadora no tenga alertas de temperatura abiertas con regla de ventilador: en ese caso `refrescar` aborta, y hay que cerrarlas antes con `normal`):

```bash
node functions/scripts/escenario-demo.js refrescar --proyecto mtpa-dev                 # A: lecturas sanas (temp ~37.4, hum ~58)
node functions/scripts/escenario-demo.js refrescar B --proyecto mtpa-dev --confirmar   # B: coherentes con sus alertas abiertas
node functions/scripts/escenario-demo.js refrescar --sostener 300 --proyecto mtpa-dev --confirmar   # A en vivo (Ctrl+C para cortar)
```

- `refrescar` actúa sobre **una** incubadora (A por defecto; no existe «todas»). En A envía lecturas sanas dentro de la banda muerta de la histéresis (37.2 a 37.6 °C; humedad 56.5 a 59.5 %). En **B** envía lecturas coherentes con sus alertas abiertas (temperatura ~35.8, humedad ~45): refresca la hora **sin resolver ni duplicar** las alertas (verificado: las mismas alertas con los mismos estados antes y después, sin órdenes).
- `--sostener <seg>` repite cada 8 s (`--cada`) hasta cumplir el tiempo o Ctrl+C, con tope de **600 s** (`--sin-tope` lo levanta). Motivo: el panel lee solo las 200 lecturas más recientes de TODA la base y filtra por incubadora en el navegador; un refresco largo de A (2 lecturas cada 8 s: 200 en ~13 min) saca de esa ventana a la B y a la otra variable, y aparece «Faltan mediciones ambientales». Por eso, después de refrescar A, corré `refrescar B` una vez.
- **La incubadora real del usuario.** El histórico de la demo (288 lecturas) también la saca de la ventana de 200 lecturas del panel: si abrís la incubadora real vas a ver «Faltan mediciones ambientales» y datos viejos. Si vas a mostrarla, su servicio y su sensor deben estar emitiendo (así sus lecturas son las más recientes), o directamente no la muestres. El selector «Incubadora» arranca en la primera de la lista (puede ser la real): elegí a mano «Incubadora A - Lote 1 (demo)».
- `estado` lee las 300 lecturas más recientes (si una incubadora no aparece en ellas muestra «sin mediciones recientes»).

### 2.6 Lista de comprobación (5 minutos antes)

- [ ] **Refresco:** `refrescar` de A con `--sostener 300 --confirmar` (o una vez sola) y `refrescar B --confirmar`. «Última actualización» muestra la hora de hoy en las dos. **Cortalo con Ctrl+C antes de hacer `calor`** (ver 3.6).
- [ ] Terminal 1 dice «Conectado a …» y «Suscripto a …».
- [ ] Terminal 2 dice «Conectado a …» y «Suscripto a …».
- [ ] `node functions/scripts/escenario-demo.js estado --proyecto mtpa-dev` muestra A sin alertas abiertas, con el ventilador «conectado» y en estado **«apagado»**, y B con 2 alertas abiertas. Si ensayaste `calor` sin `normal`, el `calor` en vivo no crearía alerta ni orden: corré `normal` y esperá.
- [ ] `node functions/scripts/escenario-demo.js calor --proyecto mtpa-dev` (simulacro) muestra «Incubadora A - Lote 1 (demo)»: detecta una ambigüedad de nombres antes del público.
- [ ] Login correcto con los **tres** usuarios (usá tres ventanas de navegador distintas o una de incógnito).
- [ ] Panel general: Incubadora A «Normal» y Incubadora B «Advertencia». **Anotá los contadores reales** (Incubadoras / Normal / Advertencia / Crítico y los del listado de alertas) y usá esos: las cifras del guion («Todas (3)», «Activas (1)», «0 Crítico»…) valen solo si la base no tiene otras incubadoras ni alertas, y la incubadora real del usuario suma las suyas.
- [ ] **Incubadora real:** si no va a emitir en la presentación, no la abras en el panel (por la ventana de 200 lecturas vería «Faltan mediciones ambientales»). Verificá a mano que A y B muestran temperatura y humedad.
- [ ] Si algún script se cortó (Ctrl+C o error), esperá ~150 s y corré `preparar --confirmar` antes de arrancar el servicio.
- [ ] El selector «Incubadora» arranca en la **primera de la lista**, que puede ser la real o la B: elegí a mano «Incubadora A - Lote 1 (demo)».
- [ ] No reinicies el Servicio de Integración después de preparar todo (ver Plan B).

## 3. Recorrido paso a paso

### 3.1 Login y roles (2 min)

1. Abrí la aplicación: «Iniciar sesión», «M.T.P.A. — Mejora Técnica de Producción Avícola». Entrá como administrador.
2. Menú lateral del **administrador**: «Panel general», «Incubadoras», «Alertas», «Límites de alerta», «Ventiladores», «Usuarios».
3. Ventana del **operador**: «Panel general», «Incubadoras», «Alertas», «Ventiladores».
4. Ventana de **consulta**: solo «Panel general» e «Incubadoras». Si escribe `/ventiladores` en la barra: «Acceso no autorizado».

Decí: «cada rol ve solo lo que necesita; los permisos se aplican en la aplicación y en las reglas de Firestore».

### 3.2 Usuarios (1 min, administrador)

«Usuarios» → «Gestión de usuarios»: columnas Nombre, Correo, Rol, Estado, Acciones; botones «Editar», «Desactivar» y «+ Nuevo usuario». Decí: «los usuarios se crean por una función del servidor, nunca escribiendo directo en la base».

### 3.3 Incubadoras (1,5 min)

«Incubadoras» → listado (Nombre, Ubicación, Estado, Acciones). Mostrá la «Incubadora C - En mantenimiento (demo)» con estado «Inactiva» y las otras «Activa». «Ver detalle» de la A: datos y tabla «Dispositivos» (Tipo, Identificador MQTT, Estado de conexión): «Ventilador», «Sensor de temperatura», «Sensor de humedad».

Cuidado: el botón «+ Nueva incubadora» se ve con cualquier rol, pero solo el administrador puede usarlo.

### 3.4 Monitorización (1,5 min)

«Panel general». Arriba el resumen (Incubadoras / Normal / Advertencia / Crítico) y el selector «Incubadora». Con la A elegida, las tarjetas: «Estado general» (Normal), «Temperatura», «Humedad» (%HR), «Última actualización», «Estado de conexión» («Conectado», «Última comunicación»), «Ventiladores» (1/1).

**Para mostrarlo en vivo**, en la terminal 4, ANTES de esta parte:

```bash
node functions/scripts/escenario-demo.js refrescar --sostener 90 --proyecto mtpa-dev --confirmar
```

Cada 8 s llegan lecturas nuevas: cambian el valor de «Temperatura» y «Humedad» y la hora de «Última lectura» y «Última actualización». **Cortalo con Ctrl+C ANTES de hacer `calor`** (3.6): las lecturas sanas del refresco pisarían el escenario, igual que el simulador con sensor real (resolverían la alerta a los pocos segundos). El comando termina solo a los 90 s.

Elegí la B: «Advertencia», las tarjetas en rojo («Temperatura fuera del umbral», «Humedad fuera del umbral»), «Estado de conexión: Desconectado» y «Ventiladores 0/1». Es lo esperado: la B no tiene ningún equipo (ni simulado) conectado. Presentala como «una incubadora con alertas abiertas».

### 3.5 Umbrales (1 min, administrador)

«Límites de alerta» → «Límites de monitoreo». Por incubadora: «Temperatura (°C)» mínimo 36.5 y máximo 38.5; «Humedad (%)» mínimo 50 y máximo 65; botones «Guardar temperatura» y «Guardar humedad». Mostralo, **no lo cambies** (los escenarios usan estos valores; si lo cambiás, el script calcula los valores a partir de lo guardado).

### 3.6 Alertas y su ciclo de vida (2,5 min)

1. «Alertas»: filtros «Todas (3)», «Activas (1)», «Reconocidas (1)», «Resueltas (1)» (tus contadores reales pueden ser otros). Abrí una: título, «Incubadora», «Variable», «Valor registrado», «Límite excedido», «Tipo», «Estado», «Generada el».
2. La alerta **Reconocida** (humedad baja) y la **Resuelta** (temperatura alta; abajo dice «Resuelta automáticamente» y «La medición volvió a 37,4 °C»).
3. El banner de arriba («Ver alerta») muestra la alerta activa más reciente, con «×» para descartarlo.
4. En vivo, terminal 4 (con el refresco cortado):

   ```bash
   node functions/scripts/escenario-demo.js calor --proyecto mtpa-dev --confirmar
   ```

   En 2 o 3 segundos aparece la alerta nueva «Temperatura fuera de rango» (39.2 °C, por encima del máximo de 38.5 °C) y un banner nuevo; la A pasa a «Advertencia» y su tarjeta de temperatura se pone roja.
5. En el detalle de esa alerta, «Marcar como reconocida» (administrador u operador): pasa a «Reconocida». **Sigue abierta**: no se crea otra igual mientras esté activa o reconocida.
6. Se cierra sola cuando la medición vuelve a rango (paso 3.7).

### 3.7 Ventiladores (3 min)

«Ventiladores» → «Control de ventiladores». Elegí la A: tarjeta «Ventilador xxxxxxxx...» con su estado («Encendido», «Apagado» o «Desconocido»), «Modo de control: Mixto», «Última orden» y los botones «Encender» y «Apagar».

**Automático.** Si hiciste `calor` en 3.6, el ventilador se encendió solo: «Encender · …», estado «Ejecutada», «El ventilador confirmó el cambio.», y arriba «Encendido». Decí: «lo ordenó la regla de automatización, no una persona». Ahora el ventilador vuelve a apagarse con la histéresis:

```bash
node functions/scripts/escenario-demo.js normal --proyecto mtpa-dev --confirmar
```

Envía 38.0 °C (la alerta se resuelve y el ventilador **sigue encendido**: está dentro de la banda de histéresis), espera 6 s y envía 36.9 °C (por debajo de 37.0): orden de apagar. La alerta queda «Resuelta» («Resuelta automáticamente»).

**Manual.** Con el botón «Apagar»/«Encender» se crea una orden. El Servicio de Integración la toma y el simulador la confirma. Los estados son Pendiente, Enviando, Enviada y Ejecutada, pero **todo ocurre en 0,1 a 6 s** (medido), así que la pantalla casi salta a «Ejecutada»; para mostrar los pasos, dejá el botón «Enviando...» en pantalla y señalá «Hay una orden en curso; espere a que termine para enviar otra.». Hacelo con el ventilador de la **A**: el de la B es manual pero no tiene equipo conectado y según el código, su orden terminaría «Fallida» a los 30 s (no probado).

**Configuración.** «Configurar modo y automatización» → «Automatización de ventiladores»: «Modo de control» (Manual, Automático, Mixto), «Variable», «Umbral de activación (°C)», «Margen de histéresis (°C)», «Regla activa» y «Guardar». Mostrá la regla de la A y no la cambies.

**Tiempos que tenés que respetar entre escenarios:**

| Situación | Espera |
| --------- | ------ |
| Repetir `calor` (otra orden de **encender**) | **120 s** desde la orden de encender anterior (enfriamiento). Antes de eso se crea la alerta pero NO la orden (medido: repetido a los 41 s no creó orden; pasados los 120 s, sí). |
| Repetir `normal` (otra orden de **apagar**) | 120 s desde la orden de apagar anterior. |
| Que una orden termine | 0,1 a 6 s medidos (hasta 30 s si el simulador no responde: pasa a «Fallida»). |
| Alerta ya «Reconocida» y vuelvo a pedir `calor` | No crea otra alerta: sigue la reconocida. Cerrala con `normal`. |
| `refrescar` y `calor` | No a la vez: cortá el refresco (Ctrl+C) antes de `calor`. |

Otros comandos: `humedad-baja` y `humedad-normal` (alerta de humedad y su resolución con 57.5 %), cada uno con la incubadora opcional (`A`, `B` o un id; por defecto A; «A» y «B» prefieren siempre las de «(demo)»), y:

```bash
node functions/scripts/escenario-demo.js estado --proyecto mtpa-dev
```

que imprime, por incubadora, la última medición, las alertas abiertas, el estado de los dispositivos, el modo y estado del ventilador y sus últimas 3 órdenes (útil como respaldo si la pantalla no actualiza). Los escenarios que escriben aceptan además `--sostener <segundos>` (tope 600 s) para repetir la última lectura cada 8 s como un sensor real (se corta con Ctrl+C: restaura el estado de conexión de los sensores y sale), y sin `--confirmar` solo simulan.

### 3.8 Desconexión de un dispositivo (1 min)

1. Detené el simulador (Ctrl+C en la terminal 2).
2. A los **30 a 35 s** (`LATIDO_TIMEOUT_SEGUNDOS`, 30 s, con revisión cada 5 s) aparece el banner «Dispositivo desconectado» («El dispositivo … dejó de enviar señales hace más de 30 segundos.»). En el panel, la A pasa a «Crítico», «Estado de conexión: Desconectado» y «Ventiladores 0/1 - 1 sin conexión».
3. Volvé a arrancar el simulador: el dispositivo vuelve a «Conectado» enseguida, pero la alerta se resuelve sola recién tras **60 s de conexión estable** (`LATIDO_ESTABILIDAD_SEGUNDOS`): medido, unos 75 s después de arrancar. El simulador reiniciado informa el ventilador como «Apagado».

## 4. Honestidad sobre el correo

Cada alerta nueva hace que la función `notificarAlerta` cree un documento en la colección `mail`
(uno por administrador activo) para la extensión **Trigger Email de Firebase**. Esa extensión
**no está instalada** (se comprobó con `firebase ext:list`; podés repetirlo): no sale ningún correo.
En la demo se ve la alerta en la aplicación (listado, detalle y banner); el correo se presenta
como «preparado, falta configurar el servicio de correo».

## 5. Plan B

| Si pasa esto | Hacé esto |
| ------------ | --------- |
| El simulador no conecta | Revisá las variables `MQTT_*` y que el servicio diga «Conectado a …». Sin MQTT, alertas, panel y umbrales siguen funcionando con `escenario-demo.js`. Las órdenes del ventilador **no se descartan**: mientras el servicio o MQTT están caídos quedan «Pendiente» y se revisan al reconectar; al reconectar, las de más de 60 s pasan a «Expirada» y las más nuevas se envían. Y una orden automática sigue bloqueando otra igual (en curso) hasta 300 s. Mostrá la regla y la alerta y contá el resto. |
| Falla un login | El mensaje es «Correo o contraseña incorrectos.». Abrí `functions/scripts/demo-credenciales.local.json` y copiá la clave; si no está o no sirve: `node functions/scripts/cargar-datos-demo.js --proyecto mtpa-dev --confirmar --solo-claves` (solo restablece las claves de operador y consulta; no toca nada más ni exige el correo del admin). Siempre podés presentar con el administrador. |
| No llegan lecturas / el panel no se mueve | `node functions/scripts/escenario-demo.js estado --proyecto mtpa-dev`. Un error 401/403 de `escenario-demo.js` es el token (`PROCESAR_MEDICION_TOKEN`; el PRE-VUELO lo dice). Logs de la función: `firebase functions:log --only procesarMedicion --project mtpa-dev`. Refrescá la página. |
| «Última actualización» muestra una hora vieja | El panel no avisa de datos viejos: `escenario-demo.js refrescar --confirmar` (A) y `refrescar B --confirmar`. |
| «Faltan mediciones ambientales» en una incubadora | Un refresco largo sacó sus lecturas de la ventana de 200 del panel: `refrescar` esa incubadora una vez. |
| Aparecen alertas «Dispositivo desconectado» que no esperabas | Es el comportamiento real del servicio. Con `preparar` y con los scripts, que devuelven los sensores a su estado de conexión anterior al terminar, el «conectado» falso solo se da por una corrida interrumpida (esperá ~150 s y corré `preparar --confirmar` con el servicio detenido) o por dispositivos reales de otra sesión. Corré `preparar --confirmar` con el servicio detenido antes de arrancarlo, y mientras tanto presentalo como la detección de desconexión. |
| Se ven alertas que no pediste | Probablemente arrancaste el simulador con `SIMULADOR_SENSOR_ID` (modo realista) o dejaste corriendo un `refrescar` sobre una incubadora con otro estado. Detenelo y arrancalo sin esa variable. |

## 6. Limpieza posterior

- Detené el simulador y el Servicio de Integración (Ctrl+C): el servicio sigue escribiendo en Firestore (estado de los dispositivos, alertas de desconexión) y un simulador en modo realista escribe lecturas cada 8 s.
- Los datos de demo se reconocen por el texto **«(demo)»** en el nombre de las incubadoras. **No hay borrado masivo automático**: si querés eliminarlos, hacelo a mano desde la consola de Firebase (incubadoras, sus dispositivos, ventiladores, reglas, umbrales, alertas, órdenes y mediciones, más los usuarios de demo).
- Borrá `functions/scripts/demo-credenciales.local.json` si ya no lo necesitás.
