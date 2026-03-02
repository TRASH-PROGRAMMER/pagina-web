import sys
import os
import uuid
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, render_template, request, jsonify, send_from_directory
from werkzeug.utils import secure_filename
from db import Cliente, Foto, db

# Crea la app Flask
app = Flask(__name__)

# Configuración de PostgreSQL — usa psycopg (v3) en vez de psycopg2
DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5434/postgres"
)
app.config['SQLALCHEMY_DATABASE_URI'] = DB_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Carpeta para fotos subidas
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 150 * 10 * 1024 * 1024  # 150 fotos × 10 MB

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
        papel=data.get("papel", "")
    )

    db.session.add(nuevo_cliente)
    db.session.flush()  # Obtener el ID antes de guardar fotos

    # Guardar archivos de fotos
    fotos_guardadas = []
    for archivo in archivos:
        if archivo and archivo.filename and allowed_file(archivo.filename):
            nombre_seguro = secure_filename(archivo.filename)
            nombre_unico = f"{uuid.uuid4().hex[:8]}_{nombre_seguro}"
            ruta = os.path.join(app.config['UPLOAD_FOLDER'], nombre_unico)
            archivo.save(ruta)

            foto = Foto(filename=nombre_unico, cliente_id=nuevo_cliente.id)
            db.session.add(foto)
            fotos_guardadas.append(nombre_unico)

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
            "fotos": fotos_guardadas
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
        "fotos":          [f.filename for f in c.fotos]
    } for c in clientes]), 200

@app.route('/api/clientes/<int:id>', methods=['DELETE'])
def eliminar_cliente(id):
    cliente = Cliente.query.get(id)
    if not cliente:
        return jsonify({"error": "Cliente no encontrado"}), 404
    # Eliminar archivos de fotos del disco
    for foto in cliente.fotos:
        ruta = os.path.join(app.config['UPLOAD_FOLDER'], foto.filename)
        if os.path.exists(ruta):
            os.remove(ruta)
    db.session.delete(cliente)
    db.session.commit()
    return jsonify({"mensaje": "Cliente eliminado correctamente"}), 200


@app.route('/api/uploads/<filename>')
def servir_foto(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


if __name__ == '__main__':
    app.run(debug=True)
