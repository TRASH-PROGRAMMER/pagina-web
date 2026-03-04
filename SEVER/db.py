from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
# Define los modelos de la base de datos
class Cliente(db.Model):
    __tablename__ = 'clientes'
    id             = db.Column(db.Integer, primary_key=True)
    nombre         = db.Column(db.String(50),  nullable=False)
    apellido       = db.Column(db.String(50),  nullable=False)
    correo         = db.Column(db.String(100), nullable=False, unique=True)
    telefono       = db.Column(db.String(20),  nullable=False)
    fecha_registro = db.Column(db.String(50),  nullable=False)
    tamano         = db.Column(db.String(200), nullable=True)
    tamano_keys    = db.Column(db.String(200), nullable=True)
    papel          = db.Column(db.String(50),  nullable=True)
    fotos          = db.relationship('Foto', backref='cliente',
                                     cascade='all, delete-orphan', lazy=True)

# Modelo para almacenar información de las fotos asociadas a cada cliente
class Foto(db.Model):
    __tablename__ = 'fotos'
    id         = db.Column(db.Integer, primary_key=True)
    filename   = db.Column(db.String(500), nullable=False)   # URL de Cloudinary
    public_id  = db.Column(db.String(255), nullable=True)    # public_id para eliminar
    cliente_id = db.Column(db.Integer,
                           db.ForeignKey('clientes.id'), nullable=False)
