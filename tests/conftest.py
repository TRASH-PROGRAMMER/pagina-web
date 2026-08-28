import os
import sys

import pytest
from werkzeug.security import generate_password_hash


os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "test-secret-key-with-at-least-32-characters")
os.environ.setdefault("TESTING", "true")
os.environ.setdefault("DB_BACKUP_ENABLED", "false")
os.environ.setdefault("FLASK_ENV", "testing")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "SEVER"))

from app import app, db  # noqa: E402
from db import Cliente, Foto, User  # noqa: E402


@pytest.fixture()
def client():
    app.config.update(TESTING=True, RATELIMIT_ENABLED=False)
    with app.app_context():
        db.drop_all()
        db.create_all()
        users = [
            User(
                username="admin",
                email="admin@test.local",
                password_hash=generate_password_hash("admin-password"),
                role="admin",
                activo=True,
            ),
            User(
                username="operador",
                email="operador@test.local",
                password_hash=generate_password_hash("operador-password"),
                role="operador",
                activo=True,
            ),
            User(
                username="cajero",
                email="cajero@test.local",
                password_hash=generate_password_hash("cajero-password"),
                role="cajero",
                activo=True,
            ),
        ]
        db.session.add_all(users)
        db.session.commit()
    with app.test_client() as test_client:
        yield test_client
    with app.app_context():
        db.session.remove()


@pytest.fixture()
def order():
    with app.app_context():
        cliente = Cliente(
            nombre="Ana",
            apellido="Prueba",
            correo="ana@example.com",
            telefono="0999999999",
            fecha_registro="28/08/2026",
            tamano="10x15",
            tamano_keys="10x15",
            papel="Brillante",
            estado="pendiente",
            pagado=False,
        )
        db.session.add(cliente)
        db.session.flush()
        db.session.add(Foto(filename="https://example.test/photo.jpg", public_id="photo-1", cliente_id=cliente.id))
        db.session.commit()
        return cliente.id


def authenticate(test_client, username, role):
    with test_client.session_transaction() as session:
        session["user_id"] = 1 if role == "admin" else 2 if role == "operador" else 3
        session["username"] = username
        session["role"] = role