# Image Manager - App web de pedidos de impresion de fotos

Aplicacion fullstack con Flask + PostgreSQL + Cloudinary para:

- registrar pedidos con fotos
- calcular precios por tamano/cantidad
- gestionar estados de pedido por roles
- hacer seguimiento publico por numero de pedido + correo
- autoguardar progreso del formulario
- limpiar recursos cancelados en Cloudinary
- ejecutar backup automatico de base de datos

## 1) Stack tecnico

- Backend: Flask, Flask-SQLAlchemy, Flask-Session
- Base de datos: PostgreSQL (driver `psycopg`)
- Almacenamiento de imagenes: Cloudinary
- Frontend: HTML + CSS + JavaScript vanilla
- Infra: Dockerfile + docker-compose

## 2) Modulos principales

### Cliente (sitio publico)

Ruta: `/`

Archivo principal: `SEVER/templates/index.html`

Funciones:

- formulario de datos personales
- carga multiple de fotos (limite backend: 150 fotos x 10 MB)
- seleccion de tamano base y papel
- asignacion por foto (modo avanzado)
- recorte de imagen con Cropper manteniendo proporcion del tamano
- comparador antes/despues en modal de recorte
- previsualizacion de marcos
- resumen y envio de pedido

Scripts involucrados:

- `SEVER/static/script/formulario_clientes.js`
- `SEVER/static/script/precios_fotos.js`
- `SEVER/static/script/autosave_pedido.js`
- `SEVER/static/script/main.js`

### Seguimiento de pedido

Ruta: `/seguimiento`

Archivo principal: `SEVER/templates/seguimiento.html`

Permite consultar estado, detalle y total del pedido usando:

- numero de pedido
- correo del cliente

Endpoint usado: `GET /api/seguimiento/<cliente_id>?correo=<correo>`

### Admin / Operador / Cajero

Rutas:

- `/admin`
- `/operador`
- `/cajero`

Funciones por rol:

- `admin`: todo el panel, tamanos, marcos, metricas, cloudinary stats, backups
- `operador`: gestion operativa de pedidos
- `cajero`: marcar pagos, mover flujo a procesando

Panel admin incluye:

- tabla de pedidos
- cambio de estado
- eliminacion
- descarga de fotos
- ultimas subidas (5 clientes recientes) con carrusel
- grafico y estadisticas
- uso de almacenamiento Cloudinary
- CRUD de tamanos
- gestion de marcos

## 3) Autenticacion y autorizacion

Archivo: `SEVER/auth.py`

Mecanismo:

- login web clasico por sesion Flask (`/login`)
- login API tab-scoped con bearer token (`/api/auth/login`)
- control de acceso con decoradores:
  - `@login_required`
  - `@role_required(...)`

Endpoints clave:

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/auth/me`

Frontend protegido:

- `SEVER/static/script/session_auth_client.js`
- agrega `Authorization: Bearer ...` automaticamente a llamadas `/api/*`

## 4) Modelo de datos

Archivo: `SEVER/db.py`

Tablas:

- `clientes`
- `fotos`
- `cliente_drafts` (autosave)
- `foto_tamanos`
- `marcos_diseno`
- `users`
- `auth_sessions`

Relaciones importantes:

- `Cliente 1 -> N Foto`
- `User 1 -> N AuthSession`

## 5) Autosave del formulario

Frontend: `SEVER/static/script/autosave_pedido.js`  
Backend: `SEVER/app.py` (`/api/autosave/...`)

Comportamiento:

- debounce de 2 segundos luego de la ultima interaccion
- captura estado de formulario, opciones y metadata de fotos
- guarda localmente en `localStorage`
- sincroniza con backend en `cliente_drafts`
- usa cola local cuando no hay red
- reintenta automaticamente al volver online
- envia beacon en `beforeunload/pagehide/visibilitychange`
- limpia borrador despues de enviar pedido (`pedido:enviado`)
- maneja conflictos por version (`baseVersion`, HTTP 409)

Endpoints:

- `GET /api/autosave/<draft_key>`
- `PUT /api/autosave/<draft_key>`
- `DELETE /api/autosave/<draft_key>`
- `POST /api/autosave/<draft_key>/beacon`

## 6) Cloudinary: carga, metricas y limpieza automatica

### Carga de fotos

En `POST /api/clientes` se suben fotos a Cloudinary y se guarda:

- `secure_url`
- `public_id`

### Metricas de uso

Endpoint: `GET /api/cloudinary-stats`  
Uso: tarjeta de almacenamiento en admin.

### Limpieza automatica de cancelados

Cuando un pedido pasa a `cancelado`, se guarda `cancelled_at`.

Job interno:

- elimina fotos de pedidos cancelados con antiguedad mayor a X dias
- borra recursos en Cloudinary por `public_id`
- borra filas `fotos` en DB

Configurable por variables:

- `CLOUDINARY_CANCELLED_RETENTION_DAYS` (default: 10)
- `CLOUDINARY_CANCELLED_CLEANUP_INTERVAL_SECONDS` (default: 21600)

## 7) Backup automatico de base de datos

Implementado en `SEVER/app.py`.

Estrategia:

- genera `.sql` con `pg_dump`
- guarda en carpeta local de backups
- elimina backups antiguos segun retencion
- puede dispararse manualmente via API admin

Endpoint manual:

- `POST /api/admin/db-backup` (solo admin)

Variables:

- `DB_BACKUP_ENABLED` (default: true)
- `DB_BACKUP_INTERVAL_SECONDS` (default: 86400)
- `DB_BACKUP_RETENTION_DAYS` (default: 15)
- `DB_BACKUP_DIR` (default: `SEVER/backups`)
- `DB_BACKUP_COMMAND` (default: `pg_dump`)

## 8) API resumida por dominio

### Pedidos

- `POST /api/clientes`
- `GET /api/clientes`
- `DELETE /api/clientes/<id>`
- `PATCH /api/clientes/<id>/estado`
- `PATCH /api/clientes/<id>/pago`

### Seguimiento

- `GET /api/seguimiento/<cliente_id>?correo=...`

### Tamanos

- `GET /api/tamanos`
- `GET /api/admin/tamanos`
- `POST /api/admin/tamanos`
- `PUT|PATCH /api/admin/tamanos/<tamano_id>`
- `PATCH /api/admin/tamanos/<tamano_id>/desactivar`

### Marcos

- `GET /api/marcos`
- `GET /api/admin/marcos`
- `POST /api/admin/marcos`
- `PATCH /api/admin/marcos/<marco_id>/estado`

### Dashboard admin

- `POST /api/precios`
- `GET /api/pedidos-semana`
- `GET /api/estadisticas`
- `GET /api/ultimas-subidas`
- `GET /api/cloudinary-stats`

### Auth + sesion

- `GET|POST /login`
- `GET|POST /logout`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/logout-all`
- `GET /api/auth/me`

### Autosave

- `GET|PUT|DELETE /api/autosave/<draft_key>`
- `POST /api/autosave/<draft_key>/beacon`

## 9) Variables de entorno

La app intenta cargar `.ENV` desde:

1. `../.ENV` relativo a `SEVER/`
2. `.ENV` en root actual
3. `.ENV` local

Minimas recomendadas:

```env
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5434/postgres
SECRET_KEY=tu_secret_key_fuerte

CLOUDINARY_CLOUD_NAME=tu_cloud_name
CLOUDINARY_API_KEY=tu_api_key
CLOUDINARY_API_SECRET=tu_api_secret

ADMIN_USERNAME=admin
ADMIN_EMAIL=admin@imagemanager.local
ADMIN_PASSWORD=cambia_esto
OPERADOR_USERNAME=operador
OPERADOR_EMAIL=operador@imagemanager.local
OPERADOR_PASSWORD=cambia_esto
CAJERO_USERNAME=cajero
CAJERO_EMAIL=cajero@imagemanager.local
CAJERO_PASSWORD=cambia_esto
```

Opcionales de sesion:

- `SESSION_TYPE` (default `filesystem`)
- `SESSION_FILE_DIR` (default `SEVER/.flask_session`)
- `FLASK_ENV=production` para cookie secure

## 10) Instalacion local (sin Docker)

### Requisitos

- Python 3.11+
- PostgreSQL 16+ (o compatible)
- `pg_dump` disponible en PATH para backup

### Pasos

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux/Mac
# source .venv/bin/activate

pip install -r requirements.txt
```

Configura `.ENV` y levanta la app:

```bash
python SEVER/app.py
```

URL:

- `http://localhost:5000`

## 11) Instalacion con Docker

### Levantar todo

```bash
docker compose up --build
```

Servicios:

- app en `http://localhost:8080`
- postgres expuesto en `localhost:5434`

## 12) Estructura del proyecto

```text
pagina-web/
|- SEVER/
|  |- app.py
|  |- auth.py
|  |- db.py
|  |- templates/
|  |  |- index.html
|  |  |- seguimiento.html
|  |  |- admin.html
|  |  |- operador.html
|  |  |- cajero.html
|  |  |- login.html
|  |- static/
|  |  |- script/
|  |  |- style/
|- docs/
|- requirements.txt
|- Dockerfile
|- docker-compose.yml
```

## 13) Flujo funcional resumido

1. Cliente crea pedido en `/`.
2. Frontend valida datos, permite recorte/marcos y calcula resumen.
3. Autosave protege progreso local + servidor.
4. Backend guarda pedido y fotos en Cloudinary.
5. Admin/operador/cajero gestionan estado y pago.
6. Cliente consulta estado en `/seguimiento`.
7. Jobs internos ejecutan limpieza Cloudinary y backup DB.

## 14) Operacion y mantenimiento

### Revisar backups

- carpeta default: `SEVER/backups`
- endpoint manual: `POST /api/admin/db-backup`

### Revisar sesion/autorizacion

- verificar expiracion de tokens en `auth_sessions`
- usar logout global si hay sesion comprometida

### Revisar almacenamiento Cloudinary

- panel admin usa `/api/cloudinary-stats`
- confirmar que credenciales cloudinary esten activas

## 15) Notas de seguridad

- Cambiar credenciales de seed en produccion
- Definir `SECRET_KEY` fuerte
- No subir `.ENV` al repositorio
- Servir detras de HTTPS en produccion
- Revisar limites de subida y cuota de Cloudinary

## 16) Estado actual del proyecto

La aplicacion esta enfocada en operacion real de pedidos:

- formulario avanzado con UX/a11y
- autosave resiliente
- seguimiento de pedidos
- dashboard admin con metricas
- limpieza y backup automatizados

Si quieres, se puede extender con:

- tests automatizados (backend/frontend)
- CI/CD
- observabilidad (logs estructurados + alertas)
- migraciones formales con Alembic
