import io

from PIL import Image

from app import app, db
from db import Cliente, ClienteDraft
from conftest import authenticate
import app as app_module


def test_login_requires_csrf_and_accepts_valid_csrf(client):
    page = client.get("/login")
    assert page.status_code == 200

    missing = client.post("/login", data={"username": "admin", "password": "admin-password"})
    assert missing.status_code == 400

    with client.session_transaction() as session:
        csrf_token = session["csrf_token"]
    response = client.post(
        "/login",
        data={"username": "admin", "password": "admin-password", "csrf_token": csrf_token},
    )
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/redirect")


def test_role_required_rejects_wrong_role(client):
    authenticate(client, "cajero", "cajero")
    response = client.get("/api/pedidos-semana")
    assert response.status_code == 403


def test_payment_boolean_parser_handles_strings_and_rejects_ambiguous_values(client, order):
    authenticate(client, "cajero", "cajero")
    false_response = client.patch(f"/api/clientes/{order}/pago", json={"pagado": "false"})
    assert false_response.status_code == 200
    assert false_response.get_json()["pagado"] is False

    true_response = client.patch(f"/api/clientes/{order}/pago", json={"pagado": "true"})
    assert true_response.status_code == 200
    assert true_response.get_json()["pagado"] is True

    invalid_response = client.patch(f"/api/clientes/{order}/pago", json={"pagado": "maybe"})
    assert invalid_response.status_code == 400


def test_tracking_and_my_orders_verify_identity(client, order):
    tracking = client.get(f"/api/seguimiento/{order}?correo=ana@example.com")
    assert tracking.status_code == 200
    assert tracking.get_json()["pedido"]["id"] == order

    forbidden = client.get(f"/api/seguimiento/{order}?correo=other@example.com")
    assert forbidden.status_code == 403

    orders = client.post("/api/mis-pedidos", json={"correo": "ana@example.com"})
    assert orders.status_code == 200
    assert orders.get_json()["total"] == 1


def test_autosave_creates_updates_and_detects_conflicts(client):
    payload = {"nombre": "Borrador"}
    created = client.put("/api/autosave/test-draft", json={"payload": payload})
    assert created.status_code == 201
    assert created.get_json()["draft"]["version"] == 1

    updated = client.put(
        "/api/autosave/test-draft",
        json={"payload": {"nombre": "Actualizado"}, "baseVersion": 1},
    )
    assert updated.status_code == 200
    assert updated.get_json()["draft"]["version"] == 2

    conflict = client.put(
        "/api/autosave/test-draft",
        json={"payload": payload, "baseVersion": 1},
    )
    assert conflict.status_code == 409

    with app.app_context():
        assert ClienteDraft.query.filter_by(draft_key="test-draft").count() == 1


def test_prices_validate_input_and_apply_quantity(client):
    valid = client.post("/api/precios", json={"tamano": "10x15", "cantidad": 2})
    assert valid.status_code == 200
    assert valid.get_json()["total"] > 0

    invalid = client.post("/api/precios", json={"tamano": "10x15", "cantidad": 0})
    assert invalid.status_code == 400


def test_upload_validates_content_and_returns_cloudinary_result(client, monkeypatch):
    image_stream = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(image_stream, format="PNG")
    image = image_stream.getvalue()
    invalid = client.post(
        "/api/upload-temporal",
        data={"foto": (io.BytesIO(b"not-an-image"), "photo.png")},
        content_type="multipart/form-data",
    )
    assert invalid.status_code == 400

    class FakeUploader:
        @staticmethod
        def upload(stream, folder, resource_type):
            assert stream.name == "photo.png"
            assert folder == "image_manager/draft_test"
            assert resource_type == "image"
            return {"secure_url": "https://cdn.test/photo.png", "public_id": "photo"}

    monkeypatch.setattr(app_module.cloudinary.uploader, "upload", FakeUploader.upload)
    valid = client.post(
        "/api/upload-temporal",
        data={"draftKey": "test", "foto": (io.BytesIO(image), "photo.png")},
        content_type="multipart/form-data",
    )
    assert valid.status_code == 200
    assert valid.get_json()["public_id"] == "photo"


def test_delete_order_removes_order_and_calls_cloudinary(client, order, monkeypatch):
    authenticate(client, "operador", "operador")
    destroyed = []
    monkeypatch.setattr("app._destroy_cloudinary_image", lambda public_id: destroyed.append(public_id) or True)

    response = client.delete(f"/api/clientes/{order}")
    assert response.status_code == 200
    assert destroyed == ["photo-1"]

    with app.app_context():
        assert db.session.get(Cliente, order) is None