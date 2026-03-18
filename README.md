# Sistema web de gestion de pedidos de impresion de fotos

## Autenticacion y roles (RBAC)

El proyecto usa sesiones de Flask (Flask-Session) con control de acceso por rol:

- `admin`: acceso completo.
- `operador`: ver pedidos, cambiar estado, eliminar y descargar fotos.
- `cajero`: ver pedidos y marcar pedidos como pagados.

### Rutas clave

- `/login`: inicio de sesion.
- `/logout`: cierre de sesion.
- `/admin`: solo `admin`.
- `/operador`: `admin` y `operador`.
- `/cajero`: `admin` y `cajero`.

### Credenciales iniciales (seed automatico)

Si no existen usuarios en DB, se crean automaticamente:

- admin / admin123
- operador / operador123
- cajero / cajero123

Puedes sobrescribirlos con variables de entorno:

- `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`
- `OPERADOR_USERNAME`, `OPERADOR_EMAIL`, `OPERADOR_PASSWORD`
- `CAJERO_USERNAME`, `CAJERO_EMAIL`, `CAJERO_PASSWORD`

Tambien configura:

- `SECRET_KEY` para firmar sesiones.
- `SESSION_TYPE` (default `filesystem`).
- `SESSION_FILE_DIR` (opcional).

### Notas de seguridad

- Cambia las contrasenas iniciales antes de produccion.
- Define `SECRET_KEY` fuerte en entorno.
- En produccion usa HTTPS para `SESSION_COOKIE_SECURE`.
