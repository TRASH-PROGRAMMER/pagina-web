from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import func

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
    estado         = db.Column(db.String(20),  nullable=False, default='pendiente')
    pagado         = db.Column(db.Boolean, nullable=False, default=False)
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


class FotoTamano(db.Model):
    __tablename__ = 'foto_tamanos'
    id            = db.Column(db.Integer, primary_key=True)
    clave         = db.Column(db.String(50), nullable=False, unique=True)
    nombre        = db.Column(db.String(100), nullable=False)
    precio_base   = db.Column(db.Float, nullable=False, default=0.0)
    activo        = db.Column(db.Boolean, nullable=False, default=True)
    updated_at    = db.Column(db.DateTime(timezone=True), nullable=False,
                              server_default=func.now(), onupdate=func.now())


class MarcoDiseno(db.Model):
    __tablename__ = 'marcos_diseno'
    id            = db.Column(db.Integer, primary_key=True)
    nombre        = db.Column(db.String(120), nullable=False)
    imagen_url    = db.Column(db.String(500), nullable=False)
    activo        = db.Column(db.Boolean, nullable=False, default=True)
    created_at    = db.Column(db.DateTime(timezone=True), nullable=False,
                              server_default=func.now())
    updated_at    = db.Column(db.DateTime(timezone=True), nullable=False,
                              server_default=func.now(), onupdate=func.now())


class User(db.Model):
    __tablename__ = 'users'
    id            = db.Column(db.Integer, primary_key=True)
    username      = db.Column(db.String(50), nullable=False, unique=True)
    email         = db.Column(db.String(120), nullable=False, unique=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role          = db.Column(db.String(20), nullable=False, default='operador')
    activo        = db.Column(db.Boolean, nullable=False, default=True)
    created_at    = db.Column(db.DateTime(timezone=True), nullable=False,
                              server_default=func.now())
