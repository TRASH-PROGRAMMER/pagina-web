import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Cargar variables de entorno desde .ENV
from dotenv import load_dotenv
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.ENV')
loaded = load_dotenv(env_path)
print(f"[DEBUG] .ENV path: {os.path.abspath(env_path)}")
print(f"[DEBUG] .ENV loaded: {loaded}")
print(f"[DEBUG] CLOUDINARY_API_KEY: {os.environ.get('CLOUDINARY_API_KEY', 'NOT FOUND')}")

from flask import Flask, render_template, request, jsonify
from db import Cliente, Foto, db
import cloudinary
import cloudinary.uploader
import cloudinary.api

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

# Configuración de Cloudinary
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET'),
    secure=True
)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

db.init_app(app)

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
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS public_id VARCHAR(255)"))
        conn.commit()

@app.route('/')
def home():
    return render_template('index.html')

# crea una ruta para la página de administración
@app.route('/admin')
def admin():
    return render_template('admin.html')
# imprime un mensaje en la consola para indicar que el programa está funcionando
print("El programa está funcionando")
@app.route('/operador')
def operador():
    return render_template('operador.html')
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

    # Verificar si ya existe el correo
    existe = Cliente.query.filter_by(correo=data["correo"]).first()
    if existe:
        return jsonify({"error": "El correo ya está registrado"}), 400

    nuevo_cliente = Cliente(
        nombre=data["nombre"],
        apellido=data["apellido"],
        correo=data["correo"],
        telefono=data["telefono"],
        fecha_registro=data["fechaRegistro"],
        tamano=data.get("tamano", ""),
        tamano_keys=data.get("tamano_keys", ""),
        papel=data.get("papel", "")
    )

    db.session.add(nuevo_cliente)
    db.session.flush()  # Obtener el ID antes de guardar fotos

    # Subir fotos a Cloudinary
    fotos_guardadas = []
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
            "numFotos": len(fotos_guardadas),
            "fotos": fotos_guardadas,
            "precioTotal": calcular_precio_total(
                nuevo_cliente.tamano_keys, len(fotos_guardadas),
                nuevo_cliente.tamano)
        }
    }), 201

@app.route('/api/clientes', methods=['GET'])
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
        "numFotos":       len(c.fotos),
        "fotos":          [f.filename for f in c.fotos],
        "precioTotal":    calcular_precio_total(c.tamano_keys, len(c.fotos), c.tamano)
    } for c in clientes]), 200

@app.route('/api/clientes/<int:id>', methods=['DELETE'])
def eliminar_cliente(id):
    cliente = Cliente.query.get(id)
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

PRECIOS = {
    "instax": {"precio": 0.00},
    "polaroid": {"precio": 0.00},
    "10x10": {"precio": 1.80},
    "10x15": {"precio": 1.70},
    "13x18": {"precio": 1.80},
    "15x15": {"precio": 1.95},
    "15x21": {"precio": 1.95},
    "20x20": {"precio": 3.65},
    "20x25": {"precio": 3.65},
    "20x30": {"precio": 4.00},
}

# Mapeo de texto legible → clave de precio (para registros sin tamano_keys)
TAMANO_TEXT_A_KEY = {
    "instax (5x8cm)": "instax",
    "instax": "instax",
    "polaroid (8x8cm)": "polaroid",
    "polaroid": "polaroid",
    "10x10cm": "10x10",
    "10x15cm (4r)": "10x15",
    "10x15cm(4r)": "10x15",
    "10x15": "10x15",
    "13x18cm (5r)": "13x18",
    "13x18cm(5r)": "13x18",
    "13x18": "13x18",
    "15x15cm": "15x15",
    "15x15": "15x15",
    "15x21cm (6r)": "15x21",
    "15x21cm(6r)": "15x21",
    "15x21": "15x21",
    "20x20cm": "20x20",
    "20x20": "20x20",
    "20x25cm (8r)": "20x25",
    "20x25cm(8r)": "20x25",
    "20x25": "20x25",
    "20x30cm": "20x30",
    "20x30": "20x30",
}


def _extraer_claves_desde_texto(tamano_texto):
    """Extrae claves de precio desde el texto legible del tamaño."""
    if not tamano_texto:
        return []
    partes = [p.strip().lower() for p in tamano_texto.split(',') if p.strip()]
    claves = []
    for parte in partes:
        if parte in TAMANO_TEXT_A_KEY:
            claves.append(TAMANO_TEXT_A_KEY[parte])
        else:
            # Intentar coincidencia parcial
            for texto, clave in TAMANO_TEXT_A_KEY.items():
                if texto in parte or parte in texto:
                    claves.append(clave)
                    break
    return claves


def calcular_precio_total(tamano_keys_str, cantidad, tamano_texto=None):
    """Calcula el precio total. Usa tamano_keys si existe, sino parsea tamano_texto."""
    if cantidad <= 0:
        return 0.0

    # Obtener claves: primero de tamano_keys, si no, del texto
    if tamano_keys_str:
        claves = [k.strip() for k in tamano_keys_str.split(',') if k.strip()]
    elif tamano_texto:
        claves = _extraer_claves_desde_texto(tamano_texto)
    else:
        return 0.0

    total = 0.0
    for clave in claves:
        if clave not in PRECIOS:
            continue
        pu = PRECIOS[clave]["precio"]
        # Descuentos por cantidad
        if clave == "10x15":
            if 15 <= cantidad <= 24: pu = 0.62
            elif 25 <= cantidad <= 49: pu = 0.52
            elif 50 <= cantidad <= 99: pu = 0.47
            elif 100 <= cantidad <= 299: pu = 0.39
            elif cantidad >= 300: pu = 0.32
        elif clave == "15x15":
            if 15 <= cantidad <= 24: pu = 1.80
            elif 25 <= cantidad <= 49: pu = 0.70
            elif 50 <= cantidad <= 99: pu = 0.60
            elif 100 <= cantidad <= 299: pu = 0.50
            elif cantidad >= 300: pu = 0.40
        total += round(pu * cantidad, 2)
    return round(total, 2)
@app.route('/api/precios', methods=['POST'])
def obtener_precios():
    data = request.get_json()

    tamano = data.get("tamano")
    cantidad = data.get("cantidad")

    if not tamano or not cantidad:
        return jsonify({"error": "Datos incompletos"}), 400

    if tamano not in PRECIOS:
        return jsonify({"error": "Tamaño no válido"}), 400

    precio_unitario = PRECIOS[tamano]["precio"]

    # 🔥 Descuentos
    if tamano == "10x15":
        if 15 <= cantidad <= 24:
            precio_unitario = 0.62
        elif 25 <= cantidad <= 49:
            precio_unitario = 0.52
        elif 50 <= cantidad <= 99:
            precio_unitario = 0.47
        elif 100 <= cantidad <= 299:
            precio_unitario = 0.39
        elif cantidad >= 300:
            precio_unitario = 0.32

    elif tamano == "15x15":
        if 15 <= cantidad <= 24:
            precio_unitario = 1.80
        elif 25 <= cantidad <= 49:
            precio_unitario = 0.70
        elif 50 <= cantidad <= 99:
            precio_unitario = 0.60
        elif 100 <= cantidad <= 299:
            precio_unitario = 0.50
        elif cantidad >= 300:
            precio_unitario = 0.40

    total = round(precio_unitario * cantidad, 2)

    return jsonify({
        "tamano": tamano,
        "cantidad": cantidad,
        "precio_unitario": precio_unitario,
        "total": total
    }), 200

   
if __name__ == '__main__':
    app.run(debug=True)



















