# Bootstrap del primer administrador

`gestionarUsuario` (la Cloud Function callable, ver `functions/index.js`)
exige que quien la invoca ya tenga el custom claim `role: "administrador"`,
incluso para la acción `"crear"`. Esto es intencional: nadie sin ser
administrador puede crear usuarios desde la aplicación. La consecuencia es
que la aplicación web, por sí sola, no tiene ninguna forma de crear al
**primer** administrador de un proyecto de Firebase nuevo (problema de
huevo y gallina).

## Solución: script standalone

`functions/scripts/crear-primer-admin.js` es un script de Node.js que se
ejecuta manualmente, por fuera de la aplicación y de las Cloud Functions
desplegadas (no se sube a producción: `firebase.json` excluye
`scripts/**` del despliegue de `functions`). Usa `firebase-admin` con
credenciales de una **cuenta de servicio** (Service Account) del proyecto,
que tiene permisos administrativos sobre todo el proyecto de Firebase, no
del rol de la aplicación.

### 1. Obtener credenciales de cuenta de servicio

Firebase Console → ⚙️ Configuración del proyecto → **Cuentas de
servicio** → **Generar nueva clave privada**. Se descarga un archivo
`.json`; guardalo fuera del control de versiones (nunca se commitea).

### 2. Ejecutar el script

```bash
cd functions
npm install   # si todavía no se instalaron las dependencias

GOOGLE_APPLICATION_CREDENTIALS="/ruta/a/service-account.json" \
ADMIN_EMAIL="admin@mtpa.com" \
ADMIN_PASSWORD="unaContraseñaSegura123" \
ADMIN_NOMBRE="Administrador Inicial" \
node scripts/crear-primer-admin.js
```

También acepta los datos como argumentos posicionales en vez de variables
de entorno:

```bash
node scripts/crear-primer-admin.js admin@mtpa.com unaContraseñaSegura123 "Administrador Inicial"
```

### 3. Qué hace

1. Busca si ya existe un usuario de Authentication con ese correo; si no
   existe, lo crea.
2. Le asigna el custom claim `{ role: "administrador" }`.
3. Crea (o actualiza) su documento en `usuarios/{uid}` en Firestore con
   `rol: "administrador"` y `activo: true`.

Es idempotente: correrlo de nuevo sobre el mismo correo no duplica nada,
solo confirma/reasigna el rol de administrador.

### 4. Después de correrlo

Con ese usuario ya se puede iniciar sesión en `/login`, llegar a
`/usuarios` y usar la aplicación normalmente (incluida la Cloud Function
`gestionarUsuario`) para crear al resto de los usuarios reales.
