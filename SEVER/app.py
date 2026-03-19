import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Cargar variables de entorno desde .ENV
from dotenv import load_dotenv
for env_candidate in [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.ENV'),
    os.path.join(os.getcwd(), '.ENV'),
    '.ENV',
]:
    if os.path.isfile(env_candidate):
        load_dotenv(env_candidate)
        break

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_session import Session
from werkzeug.security import generate_password_hash
from db import Cliente, Foto, FotoTamano, User, db
from auth import auth_bp, login_required, role_required
import cloudinary
import cloudinary.uploader
import cloudinary.api
import cloudinary.utils

# Crea la app Flask
app = Flask(__name__)

# Configuración de PostgreSQL — usa psycopg (v3) en vez de psycopg2
DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5434/postgres"
)
app.config['SQLALCHEMY_DATABASE_URI'] = DB_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = 150 * 10 * 1024 * 1024  # 150 fotos × 10 MB
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-change-me')
app.config['SESSION_TYPE'] = os.environ.get('SESSION_TYPE', 'filesystem')
app.config['SESSION_FILE_DIR'] = os.environ.get(
    'SESSION_FILE_DIR', os.path.join(os.path.dirname(os.path.abspath(__file__)), '.flask_session')
)
app.config['SESSION_PERMANENT'] = False
app.config['SESSION_USE_SIGNER'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('FLASK_ENV') == 'production'

Session(app)

# Configuración de Cloudinary
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET'),
    secure=True
)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}

DEFAULT_TAMANOS = [
    {"clave": "instax", "nombre": "Instax (5x8cm)", "precio_base": 0.00},
    {"clave": "polaroid", "nombre": "Polaroid (8x8cm)", "precio_base": 0.00},
    {"clave": "10x10", "nombre": "10x10cm", "precio_base": 1.80},
    {"clave": "10x15", "nombre": "10x15cm (4R)", "precio_base": 1.70},
    {"clave": "13x18", "nombre": "13x18cm (5R)", "precio_base": 1.80},
    {"clave": "15x15", "nombre": "15x15cm", "precio_base": 1.95},
    {"clave": "15x21", "nombre": "15x21cm (6R)", "precio_base": 1.95},
    {"clave": "20x20", "nombre": "20x20cm", "precio_base": 3.65},
    {"clave": "20x25", "nombre": "20x25cm (8R)", "precio_base": 3.65},
    {"clave": "20x30", "nombre": "20x30cm", "precio_base": 4.00},
]


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _thumbnail_url(public_id=None, fallback_url=""):
    """Genera una miniatura pequeña de Cloudinary y usa fallback si algo falla."""
    if public_id:
        try:
            thumb_url, _ = cloudinary.utils.cloudinary_url(
                public_id,
                width=300,
                height=300,
                crop="fill",
                gravity="auto",
                fetch_format="auto",
                quality="auto",
                secure=True,
            )
            return thumb_url
        except Exception as e:
            print(f"Error creando thumbnail para {public_id}: {e}")
    return fallback_url or ""

db.init_app(app)
app.register_blueprint(auth_bp)

# Crea las tablas si no existen + migración ligera
with app.app_context():
    db.create_all()
    # Agregar columnas nuevas si la tabla ya existía sin ellas
    with db.engine.connect() as conn:
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tamano VARCHAR(200)"))
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS papel VARCHAR(50)"))
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS tamano_keys VARCHAR(200)"))
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estado VARCHAR(20) DEFAULT 'pendiente'"))
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pagado BOOLEAN DEFAULT FALSE"))
        conn.execute(db.text(
            "UPDATE clientes SET estado='pendiente' WHERE estado IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET pagado=FALSE WHERE pagado IS NULL"))
        conn.execute(db.text(
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS public_id VARCHAR(255)"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS nombre VARCHAR(100)"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS precio_base FLOAT"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.commit()

    # Seed inicial de tamanos si la tabla está vacía
    if FotoTamano.query.count() == 0:
        for item in DEFAULT_TAMANOS:
            db.session.add(FotoTamano(
                clave=item["clave"],
                nombre=item["nombre"],
                precio_base=item["precio_base"],
                activo=True,
            ))
        db.session.commit()

    # Seed inicial de usuarios de acceso (idempotente)
    default_users = [
        {
            "username": os.environ.get("ADMIN_USERNAME", "admin"),
            "email": os.environ.get("ADMIN_EMAIL", "admin@imagemanager.local"),
            "password": os.environ.get("ADMIN_PASSWORD", "admin123"),
            "role": "admin",
        },
        {
            "username": os.environ.get("OPERADOR_USERNAME", "operador"),
            "email": os.environ.get("OPERADOR_EMAIL", "operador@imagemanager.local"),
            "password": os.environ.get("OPERADOR_PASSWORD", "operador123"),
            "role": "operador",
        },
        {
            "username": os.environ.get("CAJERO_USERNAME", "cajero"),
            "email": os.environ.get("CAJERO_EMAIL", "cajero@imagemanager.local"),
            "password": os.environ.get("CAJERO_PASSWORD", "cajero123"),
            "role": "cajero",
        },
    ]

    for u in default_users:
        exists = User.query.filter_by(username=u["username"]).first()
        if exists:
            continue

        db.session.add(User(
            username=u["username"],
            email=u["email"],
            password_hash=generate_password_hash(u["password"]),
            role=u["role"],
            activo=True,
        ))

    db.session.commit()

@app.route('/')
def home():
    if session.get('user_id'):
        return redirect(url_for('auth.redirect_by_role'))
    return render_template('index.html')

# crea una ruta para la página de administración
@app.route('/admin')
@login_required
@role_required('admin')
def admin():
    return render_template('admin.html')
# imprime un mensaje en la consola para indicar que el programa está funcionando
print("El programa está funcionando")
@app.route('/operador')
@login_required
@role_required('admin', 'operador')
def operador():
    return render_template('operador.html')


@app.route('/cajero')
@login_required
@role_required('admin', 'cajero')
def cajero():
    return render_template('cajero.html')
@app.route('/api/clientes', methods=['POST'])
def crear_clientes():
    # Soporta FormData (con fotos) y JSON (sin fotos)
    if request.content_type and 'multipart/form-data' in request.content_type:
        data = request.form.to_dict()
        archivos = request.files.getlist('fotos')
    else:
        data = request.get_json() or {}
        archivos = []

    # Validación básica backend
    campos = ['nombre', 'apellido', 'correo', 'telefono', 'fechaRegistro']
    for campo in campos:
        if not data.get(campo):
            return jsonify({"error": f"Campo '{campo}' requerido"}), 400

    # Verificar si ya existe el correo → agregar fotos al cliente existente
    existe = Cliente.query.filter_by(correo=data["correo"]).first()
    if existe:
        # Actualizar datos del pedido (tamaño, papel, fecha)
        existe.tamano       = data.get("tamano", existe.tamano)
        existe.tamano_keys  = data.get("tamano_keys", existe.tamano_keys)
        existe.papel        = data.get("papel", existe.papel)
        existe.fecha_registro = data["fechaRegistro"]
        if not existe.estado:
            existe.estado = 'pendiente'
        if existe.pagado is None:
            existe.pagado = False

        # Subir nuevas fotos a Cloudinary
        fotos_guardadas = []
        thumbnails_guardadas = []
        for archivo in archivos:
            if archivo and archivo.filename and allowed_file(archivo.filename):
                try:
                    resultado = cloudinary.uploader.upload(
                        archivo,
                        folder=f"image_manager/cliente_{existe.id}",
                        resource_type="image"
                    )
                    foto = Foto(
                        filename=resultado['secure_url'],
                        public_id=resultado['public_id'],
                        cliente_id=existe.id
                    )
                    db.session.add(foto)
                    fotos_guardadas.append(resultado['secure_url'])
                    thumbnails_guardadas.append(
                        _thumbnail_url(resultado.get('public_id'), resultado.get('secure_url', ''))
                    )
                except Exception as e:
                    print(f"Error subiendo a Cloudinary: {e}")
                    continue

        db.session.commit()
        return jsonify({
            "mensaje": "Fotos agregadas al pedido existente",
            "cliente": {
                "id": existe.id,
                "nombre": existe.nombre,
                "apellido": existe.apellido,
                "correo": existe.correo,
                "telefono": existe.telefono,
                "fechaRegistro": existe.fecha_registro,
                "tamano": existe.tamano,
                "papel": existe.papel,
                "estado": existe.estado,
                "pagado": bool(existe.pagado),
                "numFotos": len(fotos_guardadas),
                "fotos": fotos_guardadas,
                "thumbnails": thumbnails_guardadas,
                "precioTotal": calcular_precio_total(
                    existe.tamano_keys, len(existe.fotos), existe.tamano)
            }
        }), 200

    nuevo_cliente = Cliente(
        nombre=data["nombre"],
        apellido=data["apellido"],
        correo=data["correo"],
        telefono=data["telefono"],
        fecha_registro=data["fechaRegistro"],
        tamano=data.get("tamano", ""),
        tamano_keys=data.get("tamano_keys", ""),
        papel=data.get("papel", ""),
        estado='pendiente',
        pagado=False,
    )

    db.session.add(nuevo_cliente)
    db.session.flush()  # Obtener el ID antes de guardar fotos

    # Subir fotos a Cloudinary
    fotos_guardadas = []
    thumbnails_guardadas = []
    for archivo in archivos:
        if archivo and archivo.filename and allowed_file(archivo.filename):
            try:
                resultado = cloudinary.uploader.upload(
                    archivo,
                    folder=f"image_manager/cliente_{nuevo_cliente.id}",
                    resource_type="image"
                )
                url_segura = resultado['secure_url']
                public_id  = resultado['public_id']

                foto = Foto(
                    filename=url_segura,
                    public_id=public_id,
                    cliente_id=nuevo_cliente.id
                )
                db.session.add(foto)
                fotos_guardadas.append(url_segura)
                thumbnails_guardadas.append(_thumbnail_url(public_id, url_segura))
            except Exception as e:
                print(f"Error subiendo a Cloudinary: {e}")
                continue

    db.session.commit()

    return jsonify({
        "mensaje": "Pedido guardado correctamente",
        "cliente": {
            "id": nuevo_cliente.id,
            "nombre": nuevo_cliente.nombre,
            "apellido": nuevo_cliente.apellido,
            "correo": nuevo_cliente.correo,
            "telefono": nuevo_cliente.telefono,
            "fechaRegistro": nuevo_cliente.fecha_registro,
            "tamano": nuevo_cliente.tamano,
            "papel": nuevo_cliente.papel,
            "estado": nuevo_cliente.estado,
            "pagado": bool(nuevo_cliente.pagado),
            "numFotos": len(fotos_guardadas),
            "fotos": fotos_guardadas,
            "thumbnails": thumbnails_guardadas,
            "precioTotal": calcular_precio_total(
                nuevo_cliente.tamano_keys, len(fotos_guardadas),
                nuevo_cliente.tamano)
        }
    }), 201

@app.route('/api/clientes', methods=['GET'])
@login_required
@role_required('admin', 'operador', 'cajero')
def obtener_clientes():
    clientes = Cliente.query.order_by(Cliente.id.desc()).all()
    return jsonify([{
        "id":             c.id,
        "nombre":         c.nombre,
        "apellido":       c.apellido,
        "correo":         c.correo,
        "telefono":       c.telefono,
        "fechaRegistro":  c.fecha_registro,
        "tamano":         c.tamano or "",
        "papel":          c.papel or "",
        "estado":         c.estado or "pendiente",
        "pagado":         bool(c.pagado),
        "numFotos":       len(c.fotos),
        "fotos":          [f.filename for f in c.fotos],
        "thumbnails":     [_thumbnail_url(f.public_id, f.filename) for f in c.fotos],
        "precioTotal":    calcular_precio_total(c.tamano_keys, len(c.fotos), c.tamano)
    } for c in clientes]), 200

@app.route('/api/clientes/<int:id>', methods=['DELETE'])
@login_required
@role_required('admin', 'operador')
def eliminar_cliente(id):
    cliente = db.session.get(Cliente, id)
    if not cliente:
        return jsonify({"error": "Cliente no encontrado"}), 404
    # Eliminar fotos de Cloudinary
    for foto in cliente.fotos:
        if foto.public_id:
            try:
                cloudinary.uploader.destroy(foto.public_id)
            except Exception as e:
                print(f"Error eliminando de Cloudinary: {e}")
    db.session.delete(cliente)
    db.session.commit()
    return jsonify({"mensaje": "Cliente eliminado correctamente"}), 200


@app.route('/api/clientes/<int:id>/estado', methods=['PATCH'])
@login_required
@role_required('admin', 'operador')
def actualizar_estado_cliente(id):
    cliente = db.session.get(Cliente, id)
    if not cliente:
        return jsonify({"error": "Cliente no encontrado"}), 404

    data = request.get_json() or {}
    estado = (data.get('estado') or '').strip().lower()
    estados_validos = {'pendiente', 'procesando', 'entregado', 'cancelado'}

    if estado not in estados_validos:
        return jsonify({"error": "Estado invalido"}), 400

    cliente.estado = estado
    db.session.commit()
    return jsonify({"mensaje": "Estado actualizado", "estado": cliente.estado}), 200


@app.route('/api/clientes/<int:id>/pago', methods=['PATCH'])
@login_required
@role_required('admin', 'cajero')
def actualizar_pago_cliente(id):
    cliente = db.session.get(Cliente, id)
    if not cliente:
        return jsonify({"error": "Cliente no encontrado"}), 404

    data = request.get_json() or {}
    pagado = data.get('pagado')
    if pagado is None:
        return jsonify({"error": "Campo pagado requerido"}), 400

    cliente.pagado = bool(pagado)
    # Si se marca como pagado, cambiar estado a "procesando"
    if cliente.pagado:
        cliente.estado = 'procesando'
    db.session.commit()
    return jsonify({"mensaje": "Pago actualizado", "pagado": bool(cliente.pagado), "estado": cliente.estado}), 200

PRECIOS = {item["clave"]: {"precio": item["precio_base"]} for item in DEFAULT_TAMANOS}


def _tamano_to_dict(t):
    return {
        "id": t.id,
        "clave": t.clave,
        "nombre": t.nombre,
        "precio_base": float(t.precio_base or 0),
        "activo": bool(t.activo),
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def _catalogo_version():
    row = db.session.query(db.func.max(FotoTamano.updated_at)).scalar()
    return row.isoformat() if row else "0"


def _precio_base_tamano(clave):
    t = FotoTamano.query.filter_by(clave=clave, activo=True).first()
    if t:
        return float(t.precio_base or 0)
    if clave in PRECIOS:
        return PRECIOS[clave]["precio"]
    return None


def _map_texto_a_clave():
    mapping = {}
    for t in FotoTamano.query.all():
        nombre = (t.nombre or "").strip().lower()
        if nombre:
            mapping[nombre] = t.clave
            mapping[nombre.replace(" ", "")] = t.clave
        mapping[t.clave.lower()] = t.clave
    return mapping


def _extraer_claves_desde_texto(tamano_texto):
    if not tamano_texto:
        return []
    mapping = _map_texto_a_clave()
    partes = [p.strip().lower() for p in tamano_texto.split(',') if p.strip()]
    claves = []
    for parte in partes:
        normal = parte.replace(" ", "")
        if parte in mapping:
            claves.append(mapping[parte])
            continue
        if normal in mapping:
            claves.append(mapping[normal])
            continue
        for texto, clave in mapping.items():
            if texto in parte or parte in texto:
                claves.append(clave)
                break
    return claves


def _aplicar_descuentos(clave, cantidad, precio_unitario):
    pu = precio_unitario
    if clave == "10x15":
        if 15 <= cantidad <= 24:
            pu = 0.62
        elif 25 <= cantidad <= 49:
            pu = 0.52
        elif 50 <= cantidad <= 99:
            pu = 0.47
        elif 100 <= cantidad <= 299:
            pu = 0.39
        elif cantidad >= 300:
            pu = 0.32
    elif clave == "15x15":
        if 15 <= cantidad <= 24:
            pu = 1.80
        elif 25 <= cantidad <= 49:
            pu = 0.70
        elif 50 <= cantidad <= 99:
            pu = 0.60
        elif 100 <= cantidad <= 299:
            pu = 0.50
        elif cantidad >= 300:
            pu = 0.40
    return pu


def calcular_precio_total(tamano_keys_str, cantidad, tamano_texto=None):
    if cantidad <= 0:
        return 0.0

    if tamano_keys_str:
        tokens = [k.strip() for k in tamano_keys_str.split(',') if k.strip()]

        # Nuevo formato: clave:cantidad (ej: 10x15:2,20x30:2)
        if any(':' in token for token in tokens):
            total = 0.0
            for token in tokens:
                if ':' not in token:
                    continue
                clave_raw, cantidad_raw = token.split(':', 1)
                clave = clave_raw.strip()
                try:
                    cantidad_clave = int(cantidad_raw.strip())
                except (TypeError, ValueError):
                    continue

                if cantidad_clave <= 0:
                    continue

                precio_base = _precio_base_tamano(clave)
                if precio_base is None:
                    continue

                pu = _aplicar_descuentos(clave, cantidad_clave, precio_base)
                total += round(pu * cantidad_clave, 2)

            return round(total, 2)

        claves = tokens
    elif tamano_texto:
        claves = _extraer_claves_desde_texto(tamano_texto)
    else:
        return 0.0

    total = 0.0
    for clave in claves:
        precio_base = _precio_base_tamano(clave)
        if precio_base is None:
            continue
        pu = _aplicar_descuentos(clave, cantidad, precio_base)
        total += round(pu * cantidad, 2)
    return round(total, 2)


@app.route('/api/tamanos', methods=['GET'])
def obtener_tamanos_publicos():
    tamanos = FotoTamano.query.filter_by(activo=True).order_by(FotoTamano.id.asc()).all()
    return jsonify({
        "version": _catalogo_version(),
        "tamanos": [_tamano_to_dict(t) for t in tamanos],
    }), 200


@app.route('/api/admin/tamanos', methods=['GET'])
@login_required
@role_required('admin')
def admin_listar_tamanos():
    tamanos = FotoTamano.query.order_by(FotoTamano.id.asc()).all()
    return jsonify({
        "version": _catalogo_version(),
        "tamanos": [_tamano_to_dict(t) for t in tamanos],
    }), 200


@app.route('/api/admin/tamanos', methods=['POST'])
@login_required
@role_required('admin')
def admin_crear_tamano():
    data = request.get_json() or {}
    clave = (data.get("clave") or "").strip().lower()
    nombre = (data.get("nombre") or "").strip()

    try:
        precio_base = float(data.get("precio_base", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "precio_base debe ser numérico"}), 400

    if not clave or not nombre:
        return jsonify({"error": "clave y nombre son requeridos"}), 400
    if precio_base < 0:
        return jsonify({"error": "precio_base no puede ser negativo"}), 400
    if FotoTamano.query.filter_by(clave=clave).first():
        return jsonify({"error": "La clave ya existe"}), 409

    nuevo = FotoTamano(clave=clave, nombre=nombre, precio_base=precio_base, activo=True)
    db.session.add(nuevo)
    db.session.commit()

    return jsonify({"tamano": _tamano_to_dict(nuevo), "version": _catalogo_version()}), 201


@app.route('/api/admin/tamanos/<int:tamano_id>', methods=['PUT', 'PATCH'])
@login_required
@role_required('admin')
def admin_editar_tamano(tamano_id):
    t = db.session.get(FotoTamano, tamano_id)
    if not t:
        return jsonify({"error": "Tamaño no encontrado"}), 404

    data = request.get_json() or {}

    if "clave" in data:
        nueva_clave = (data.get("clave") or "").strip().lower()
        if not nueva_clave:
            return jsonify({"error": "clave inválida"}), 400
        existe = FotoTamano.query.filter(FotoTamano.clave == nueva_clave, FotoTamano.id != tamano_id).first()
        if existe:
            return jsonify({"error": "La clave ya existe"}), 409
        t.clave = nueva_clave

    if "nombre" in data:
        nuevo_nombre = (data.get("nombre") or "").strip()
        if not nuevo_nombre:
            return jsonify({"error": "nombre inválido"}), 400
        t.nombre = nuevo_nombre

    if "precio_base" in data:
        try:
            nuevo_precio = float(data.get("precio_base"))
        except (TypeError, ValueError):
            return jsonify({"error": "precio_base debe ser numérico"}), 400
        if nuevo_precio < 0:
            return jsonify({"error": "precio_base no puede ser negativo"}), 400
        t.precio_base = nuevo_precio

    if "activo" in data:
        t.activo = bool(data.get("activo"))

    db.session.commit()
    return jsonify({"tamano": _tamano_to_dict(t), "version": _catalogo_version()}), 200


@app.route('/api/admin/tamanos/<int:tamano_id>/desactivar', methods=['PATCH'])
@login_required
@role_required('admin')
def admin_desactivar_tamano(tamano_id):
    t = db.session.get(FotoTamano, tamano_id)
    if not t:
        return jsonify({"error": "Tamaño no encontrado"}), 404

    t.activo = False
    db.session.commit()
    return jsonify({"tamano": _tamano_to_dict(t), "version": _catalogo_version()}), 200


@app.route('/api/precios', methods=['POST'])
def obtener_precios():
    data = request.get_json() or {}

    tamano = data.get("tamano")
    cantidad = data.get("cantidad")

    try:
        cantidad = int(cantidad)
    except (TypeError, ValueError):
        return jsonify({"error": "cantidad inválida"}), 400

    if not tamano or cantidad <= 0:
        return jsonify({"error": "Datos incompletos"}), 400

    precio_base = _precio_base_tamano(tamano)
    if precio_base is None:
        return jsonify({"error": "Tamaño no válido"}), 400

    precio_unitario = _aplicar_descuentos(tamano, cantidad, precio_base)
    total = round(precio_unitario * cantidad, 2)

    return jsonify({
        "tamano": tamano,
        "cantidad": cantidad,
        "precio_unitario": precio_unitario,
        "total": total
    }), 200

@app.route('/api/pedidos-semana', methods=['GET'])
@login_required
@role_required('admin')
def pedidos_semana():
    from datetime import datetime, timedelta
    hoy = datetime.now().date()
    dias = []
    nombres_dias = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
    for i in range(6, -1, -1):
        dia = hoy - timedelta(days=i)
        dias.append(dia)
    clientes = Cliente.query.all()
    conteo = {d: 0 for d in dias}
    for c in clientes:
        try:
            fecha = datetime.strptime(c.fecha_registro.split(',')[0].strip(), '%d/%m/%Y').date()
        except (ValueError, AttributeError):
            try:
                fecha = datetime.strptime(c.fecha_registro.split(',')[0].strip(), '%m/%d/%Y').date()
            except (ValueError, AttributeError):
                continue
        if fecha in conteo:
            conteo[fecha] += 1
    labels = [nombres_dias[d.weekday()] for d in dias]
    valores = [conteo[d] for d in dias]
    return jsonify({"labels": labels, "valores": valores}), 200

@app.route('/api/estadisticas', methods=['GET'])
@login_required
@role_required('admin')
def estadisticas():
    from datetime import datetime, timedelta
    hoy = datetime.now().date()
    ayer = hoy - timedelta(days=1)
    inicio_semana = hoy - timedelta(days=7)

    clientes = Cliente.query.all()
    total_clientes = len(clientes)
    total_fotos = Foto.query.count()

    pedidos_hoy = 0
    pedidos_ayer = 0
    nuevos_hoy = 0
    fotos_semana = 0

    for c in clientes:
        try:
            fecha = datetime.strptime(c.fecha_registro.split(',')[0].strip(), '%d/%m/%Y').date()
        except (ValueError, AttributeError):
            try:
                fecha = datetime.strptime(c.fecha_registro.split(',')[0].strip(), '%m/%d/%Y').date()
            except (ValueError, AttributeError):
                continue
        if fecha == hoy:
            pedidos_hoy += 1
            nuevos_hoy += 1
        elif fecha == ayer:
            pedidos_ayer += 1
        if fecha >= inicio_semana:
            fotos_semana += sum(1 for _ in c.fotos)

    if pedidos_ayer > 0:
        cambio_pct = round(((pedidos_hoy - pedidos_ayer) / pedidos_ayer) * 100)
    else:
        cambio_pct = 100 if pedidos_hoy > 0 else 0

    return jsonify({
        "pedidos_hoy": pedidos_hoy,
        "cambio_pct": cambio_pct,
        "total_fotos": total_fotos,
        "fotos_semana": fotos_semana,
        "clientes_activos": total_clientes,
        "nuevos_hoy": nuevos_hoy,
        "pendientes": pedidos_hoy,
    }), 200

@app.route('/api/ultimas-subidas', methods=['GET'])
@login_required
@role_required('admin', 'operador')
def ultimas_subidas():
    from datetime import datetime
    fotos = (Foto.query
             .order_by(Foto.id.desc())
             .limit(10)
             .all())
    resultado = []
    for f in fotos:
        cliente = f.cliente
        resultado.append({
            "url": f.filename,
            "thumbnail": _thumbnail_url(f.public_id, f.filename),
            "cliente": f"{cliente.nombre} {cliente.apellido}",
            "fecha": cliente.fecha_registro,
            "numFotos": len(cliente.fotos),
        })
    return jsonify(resultado), 200

@app.route('/api/cloudinary-stats', methods=['GET'])
@login_required
@role_required('admin')
def cloudinary_stats():
    """Obtiene estadísticas de almacenamiento de Cloudinary."""
    try:
        stats = cloudinary.api.usage()
        # stats contiene: 
        # - bandwidth (ancho de banda usado)
        # - get_requests (solicitudes GET)
        # - put_requests (solicitudes PUT)
        # - etc.
        # Para planes con almacenamiento limitado, intentamos obtener el límite
        return jsonify({
            "bandwidth": stats.get("bandwidth", 0),
            "bandwidth_limit": stats.get("bandwidth_limit", 0),
            "context": stats.get("context", {}),
            "derived_resources": stats.get("derived_resources", 0),
            "derived_resources_limit": stats.get("derived_resources_limit", 0),
            "media_limit": stats.get("media_limit", 0),
            "media_duration": stats.get("media_duration", 0),
            "media_duration_limit": stats.get("media_duration_limit", 0),
            "transformation_count": stats.get("transformation_count", 0),
            "transformation_count_limit": stats.get("transformation_count_limit", 0),
            "requests": stats.get("requests", 0),
        }), 200
    except Exception as e:
        print(f"Error obteniendo stats de Cloudinary: {e}")
        return jsonify({"error": str(e)}), 500

   
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)



















