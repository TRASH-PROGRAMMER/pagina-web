# Conexión a PostgreSQL con Flask-SQLAlchemy (ORM)

## Estructura de archivos

```
SEVER/
├── app.py        ← configuración de Flask + DB + endpoints API
├── db.py         ← modelo ORM (tabla clientes)
└── static/
    └── script/
        ├── formulario_clientes.js  ← POST /api/clientes
        └── dasbord_admin.js        ← GET /api/clientes · DELETE /api/clientes/<id>
```

---

## Dependencias

```bash
pip install flask flask-sqlalchemy psycopg2-binary
```

---

## db.py — Modelo ORM

`db` se crea sin app para evitar imports circulares.  
`app.py` lo vincula después con `init_app`.

```python
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

class Cliente(db.Model):
    __tablename__ = 'clientes'
    id             = db.Column(db.Integer, primary_key=True)
    nombre         = db.Column(db.String(50),  nullable=False)
    apellido       = db.Column(db.String(50),  nullable=False)
    correo         = db.Column(db.String(100), nullable=False, unique=True)
    telefono       = db.Column(db.String(20),  nullable=False)
    fecha_registro = db.Column(db.String(50),  nullable=False)
```

---

## app.py — Configuración y endpoints

```python
from flask import Flask, render_template, request, jsonify
from db import Cliente, db

app = Flask(__name__)

app.config['SQLALCHEMY_DATABASE_URI'] = 'postgresql://postgres:postgres@localhost:5432/postgres'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

with app.app_context():
    db.create_all()   # crea la tabla si no existe
```

### Cadena de conexión

```
postgresql://<usuario>:<contraseña>@<host>:<puerto>/<nombre_db>
postgresql://postgres:postgres@localhost:5432/postgres
```

| Campo      | Valor por defecto |
|------------|-------------------|
| Usuario    | `postgres`        |
| Contraseña | `postgres`        |
| Host       | `localhost`       |
| Puerto     | `5432`            |
| Base datos | `postgres`        |

---

## API REST — Endpoints

### `POST /api/clientes`
Crea un nuevo cliente.

**Body JSON:**
```json
{
  "nombre":        "Juan",
  "apellido":      "Pérez",
  "correo":        "juan@email.com",
  "telefono":      "0991234567",
  "fechaRegistro": "2/3/2026, 10:00:00"
}
```

**Respuesta 201:**
```json
{
  "mensaje": "Cliente guardado correctamente",
  "cliente": { "id": 1, "nombre": "Juan", ... }
}
```

**Errores:**
| Código | Motivo |
|--------|--------|
| `400`  | Datos inválidos o correo ya registrado |

---

### `GET /api/clientes`
Retorna todos los clientes ordenados del más reciente al más antiguo.

**Respuesta 200:**
```json
[
  { "id": 2, "nombre": "Ana", "apellido": "Ruiz", "correo": "ana@email.com", "telefono": "099", "fechaRegistro": "..." },
  { "id": 1, "nombre": "Juan", ... }
]
```

---

### `DELETE /api/clientes/<id>`
Elimina un cliente por ID.

**Respuesta 200:**
```json
{ "mensaje": "Cliente eliminado correctamente" }
```

**Errores:**
| Código | Motivo |
|--------|--------|
| `404`  | Cliente no encontrado |

---

## Flujo completo

```
index.html
  └─ formulario_clientes.js
       └─ POST /api/clientes ──► Flask ──► SQLAlchemy ──► PostgreSQL
            ├─ ✅ 201 → alert, reset form, BroadcastChannel → admin en tiempo real
            └─ ❌ 400 → muestra error en #mensajeError

admin.html
  └─ dasbord_admin.js
       ├─ DOMContentLoaded → GET /api/clientes → renderiza tabla
       ├─ clic ✕           → DELETE /api/clientes/<id> → elimina fila
       └─ BroadcastChannel → recibe nuevo_cliente → inserta fila en tiempo real
```

---

## Patrón init_app (evita import circular)

```
db.py          →  crea db = SQLAlchemy()   (sin app)
app.py         →  importa db, llama db.init_app(app)
```

Esto permite que `db.py` no necesite importar `app`, eliminando el import circular.
