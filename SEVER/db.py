from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.sql import func

db = SQLAlchemy()


# Define los modelos de la base de datos
class Cliente(db.Model):
    __tablename__ = 'clientes'
    id             = db.Column(db.Integer, primary_key=True)
    nombre         = db.Column(db.String(50),  nullable=False)
    apellido       = db.Column(db.String(50),  nullable=False)
    correo         = db.Column(db.String(100), nullable=False)
    telefono       = db.Column(db.String(20),  nullable=False)
    fecha_registro = db.Column(db.String(50),  nullable=False)
    tamano         = db.Column(db.String(200), nullable=True)
    tamano_keys    = db.Column(db.String(200), nullable=True)
    papel          = db.Column(db.String(50),  nullable=True)
    estado         = db.Column(db.String(20),  nullable=False, default='pendiente')
    pagado         = db.Column(db.Boolean, nullable=False, default=False)
    cancelled_at   = db.Column(db.DateTime(timezone=True), nullable=True)
    fotos          = db.relationship('Foto', backref='cliente',
                                     cascade='all, delete-orphan', lazy=True)

# Modelo para almacenar información de las fotos asociadas a cada cliente
class Foto(db.Model):
    __tablename__ = 'fotos'
    id         = db.Column(db.Integer, primary_key=True)
    filename   = db.Column(db.String(500), nullable=False)   # URL de Cloudinary
    public_id  = db.Column(db.String(255), nullable=True)    # public_id para eliminar
    cantidad   = db.Column(db.Integer, nullable=False, default=1)  # Copias pedidas por el cliente
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    exclude_auto_delete = db.Column(db.Boolean, nullable=False, default=False)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False,
                           server_default=func.now())
    cliente_id = db.Column(db.Integer,
                           db.ForeignKey('clientes.id'), nullable=False)


class ClienteDraft(db.Model):
    __tablename__ = 'cliente_drafts'
    id         = db.Column(db.Integer, primary_key=True)
    draft_key  = db.Column(db.String(80), nullable=False, unique=True, index=True)
    payload    = db.Column(db.JSON, nullable=False, default=dict)
    version    = db.Column(db.Integer, nullable=False, default=1)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False,
                           server_default=func.now())
    updated_at = db.Column(db.DateTime(timezone=True), nullable=False,
                           server_default=func.now(), onupdate=func.now())


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


class ImageStorageSetting(db.Model):
    __tablename__ = 'image_storage_settings'
    id                      = db.Column(db.Integer, primary_key=True)
    retention_mode          = db.Column(db.String(20), nullable=False, default='30d')
    retention_days          = db.Column(db.Integer, nullable=False, default=30)
    cleanup_interval_minutes = db.Column(db.Integer, nullable=False, default=60)
    updated_at              = db.Column(db.DateTime(timezone=True), nullable=False,
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


class AuthSession(db.Model):
    __tablename__ = 'auth_sessions'
    id            = db.Column(db.Integer, primary_key=True)
    user_id       = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    role          = db.Column(db.String(20), nullable=False)
    token_hash    = db.Column(db.String(128), nullable=False, unique=True)
    token_hint    = db.Column(db.String(12), nullable=True)
    user_agent    = db.Column(db.String(255), nullable=True)
    ip_addr       = db.Column(db.String(64), nullable=True)
    created_at    = db.Column(db.DateTime(timezone=True), nullable=False,
                              server_default=func.now())
    last_seen_at  = db.Column(db.DateTime(timezone=True), nullable=False,
                              server_default=func.now())
    expires_at    = db.Column(db.DateTime(timezone=True), nullable=False)
    revoked_at    = db.Column(db.DateTime(timezone=True), nullable=True)

    user          = db.relationship('User', backref='auth_sessions', lazy=True)
