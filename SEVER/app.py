import sys
import os
import json
import re
import secrets
import shlex
import time
import shutil
import subprocess
import importlib
import tempfile
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Condition, Lock, Thread
import io
from concurrent.futures import ThreadPoolExecutor, as_completed
# Cargar variables de entorno desde .ENV
from dotenv import load_dotenv
from flask_sqlalchemy import extension
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
for env_candidate in [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.ENV'),
    os.path.join(os.getcwd(), '.ENV'),
    '.ENV',
]:
    if os.path.isfile(env_candidate):
        load_dotenv(env_candidate)
        break

from flask import Flask, Response, render_template, request, jsonify, session, redirect, stream_with_context, url_for
from flask_session import Session
from werkzeug.security import generate_password_hash
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy import or_
from db import AuthSession, Cliente, ClienteDraft, Foto, FotoTamano, ImageStorageSetting, MarcoDiseno, User, db
from auth import auth_bp, current_user_role, login_required, role_required
try:
    from order_age_blueprint import order_age_bp, enrich_order_age_payload
except ImportError:
    from .order_age_blueprint import order_age_bp, enrich_order_age_payload
import cloudinary
import cloudinary.uploader
import cloudinary.api
import cloudinary.utils

# Crea la app Flask
app = Flask(__name__)

# ConfiguraciÃ³n de PostgreSQL â€” usa psycopg (v3) en vez de psycopg2
DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+psycopg://postgres:postgres@localhost:5434/postgres"
)
app.config['SQLALCHEMY_DATABASE_URI'] = DB_URL
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAX_CONTENT_LENGTH'] = int(os.environ.get('MAX_CONTENT_LENGTH', str(100 * 20 * 1024 * 1024)))
_default_secret = secrets.token_hex(32)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', _default_secret)
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


@app.errorhandler(RequestEntityTooLarge)
def handle_request_too_large(_error):
    max_content_length = app.config.get('MAX_CONTENT_LENGTH')
    limite_mb = int(max_content_length / (1024 * 1024)) if max_content_length else None
    mensaje = (
        f"Carga demasiado grande. Limite total por pedido: {limite_mb} MB."
        if limite_mb else
        "Carga demasiado grande."
    )

    if (request.path or "").startswith("/api/"):
        return jsonify({"error": mensaje}), 413
    return mensaje, 413

# ConfiguraciÃ³n de Cloudinary
cloudinary.config(
    cloud_name=os.environ.get('CLOUDINARY_CLOUD_NAME'),
    api_key=os.environ.get('CLOUDINARY_API_KEY'),
    api_secret=os.environ.get('CLOUDINARY_API_SECRET'),
    secure=True
)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
ALLOWED_IMAGE_MIMETYPES = {'image/png', 'image/jpeg', 'image/gif', 'image/pjpeg', 'image/jpg'}
ALLOWED_IMAGE_MIME_NORMALIZED = {'image/png', 'image/jpeg', 'image/gif'}
PIL_FORMAT_TO_MIME = {
    'PNG': 'image/png',
    'JPEG': 'image/jpeg',
    'GIF': 'image/gif',
}
MIME_TO_ALLOWED_EXTENSIONS = {
    'image/png': {'png'},
    'image/jpeg': {'jpg', 'jpeg'},
    'image/gif': {'gif'},
}
FRAME_ALLOWED_EXTENSIONS = {'png', 'svg'}
FRAME_ALLOWED_MIMETYPES = {'image/png', 'image/svg+xml'}
MAX_FILES_PER_ORDER = int(os.environ.get("MAX_FILES_PER_ORDER", "100"))
MAX_IMAGE_BYTES_PER_FILE = int(os.environ.get("MAX_IMAGE_BYTES_PER_FILE", str(20 * 1024 * 1024)))
SUSPICIOUS_FILE_MARKERS = [
    b"<?php",
    b"<script",
    b"#!/bin/",
    b"<html",
    b"powershell",
]

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

def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on", "si"}


FILE_SCAN_ENABLED = _env_bool("FILE_SCAN_ENABLED", False)
FILE_SCAN_STRICT = _env_bool("FILE_SCAN_STRICT", False)
FILE_SCAN_COMMAND = str(os.environ.get("FILE_SCAN_COMMAND", "")).strip()
FILE_SCAN_TIMEOUT_SECONDS = int(os.environ.get("FILE_SCAN_TIMEOUT_SECONDS", "20"))
FILE_SCAN_BYTES_LIMIT = int(os.environ.get("FILE_SCAN_BYTES_LIMIT", str(1024 * 1024)))
IMAGE_VALIDATION_REQUIRE_PIL = _env_bool("IMAGE_VALIDATION_REQUIRE_PIL", False)


ESTADOS_PEDIDO_VALIDOS = {'pendiente', 'procesando', 'listo_retiro', 'entregado', 'cancelado'}
ESTADOS_PEDIDO_ALIAS = {
    'enviado': 'listo_retiro',
    'listo_para_retirar': 'listo_retiro',
    'en_proceso': 'procesando',
}


def _normalizar_estado_pedido(estado, default='pendiente'):
    raw = str(estado or '').strip().lower()
    if not raw:
        return default
    normalized = raw.replace('-', '_').replace(' ', '_')
    canonical = ESTADOS_PEDIDO_ALIAS.get(normalized, normalized)
    if canonical in ESTADOS_PEDIDO_VALIDOS:
        return canonical
    return default


DRAFT_KEY_REGEX = re.compile(r'^[A-Za-z0-9_-]{8,80}$')
MAX_DRAFT_PAYLOAD_BYTES = 700_000
CLOUDINARY_CANCELLED_RETENTION_DAYS = int(os.environ.get("CLOUDINARY_CANCELLED_RETENTION_DAYS", "10"))
CLOUDINARY_CANCELLED_CLEANUP_INTERVAL_SECONDS = int(
    os.environ.get("CLOUDINARY_CANCELLED_CLEANUP_INTERVAL_SECONDS", str(6 * 60 * 60))
)
DB_BACKUP_ENABLED = _env_bool("DB_BACKUP_ENABLED", True)
DB_BACKUP_INTERVAL_SECONDS = int(os.environ.get("DB_BACKUP_INTERVAL_SECONDS", str(24 * 60 * 60)))
DB_BACKUP_RETENTION_DAYS = int(os.environ.get("DB_BACKUP_RETENTION_DAYS", "15"))
DB_BACKUP_DIR = os.environ.get(
    "DB_BACKUP_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "backups"),
)
DB_BACKUP_COMMAND = os.environ.get("DB_BACKUP_COMMAND", "pg_dump")
IMAGE_STORAGE_DEFAULT_RETENTION_DAYS = int(os.environ.get("IMAGE_STORAGE_DEFAULT_RETENTION_DAYS", "30"))
IMAGE_STORAGE_DEFAULT_CLEANUP_INTERVAL_MINUTES = int(
    os.environ.get("IMAGE_STORAGE_DEFAULT_CLEANUP_INTERVAL_MINUTES", "60")
)
IMAGE_STORAGE_WORKER_POLL_SECONDS = int(os.environ.get("IMAGE_STORAGE_WORKER_POLL_SECONDS", "90"))
IMAGE_STORAGE_RETENTION_PRESETS = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
    "custom": None,
}
PUBLIC_ID_FROM_URL_REGEX = re.compile(r'^v\d+$')

_last_cancelled_cleanup_run_ts = 0.0
_cancelled_cleanup_lock = Lock()
_last_db_backup_run_ts = 0.0
_db_backup_lock = Lock()
_db_backup_thread_started = False
_last_expired_images_cleanup_run_ts = 0.0
_expired_images_cleanup_lock = Lock()
_expired_images_cleanup_thread_started = False

REALTIME_SSE_RETRY_MS = int(os.environ.get("REALTIME_SSE_RETRY_MS", "3000"))
REALTIME_SSE_HEARTBEAT_SECONDS = int(os.environ.get("REALTIME_SSE_HEARTBEAT_SECONDS", "20"))
REALTIME_SSE_HISTORY_SIZE = int(os.environ.get("REALTIME_SSE_HISTORY_SIZE", "300"))
_realtime_event_condition = Condition()
_realtime_event_state = {
    "seq": 0,
    "event": "sync_needed",
    "payload": {
        "event": "sync_needed",
        "reason": "bootstrap",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    },
}
_realtime_event_history = deque([
    {
        "seq": 0,
        "event": "sync_needed",
        "payload": dict(_realtime_event_state["payload"]),
    }
], maxlen=max(30, REALTIME_SSE_HISTORY_SIZE))


def _utc_iso_now():
    return datetime.now(timezone.utc).isoformat()


def _format_sse_event(event_name, payload=None, event_id=None, retry_ms=None):
    lines = []
    if retry_ms is not None:
        lines.append(f"retry: {int(retry_ms)}")
    if event_name:
        lines.append(f"event: {event_name}")
    if event_id is not None:
        lines.append(f"id: {event_id}")

    data_str = json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":"))
    data_lines = data_str.splitlines() or [data_str]
    for line in data_lines:
        lines.append(f"data: {line}")

    return "\n".join(lines) + "\n\n"


def _emit_realtime_event(event_type, order_id=None, **extra):
    event_name = str(event_type or "sync_needed").strip().lower().replace(" ", "_")
    payload = {
        "event": event_name,
        "timestamp": _utc_iso_now(),
    }
    if order_id is not None:
        payload["order_id"] = int(order_id)

    for key, value in extra.items():
        if value is not None:
            payload[key] = value

    with _realtime_event_condition:
        next_seq = int(_realtime_event_state.get("seq", 0)) + 1
        _realtime_event_state["seq"] = next_seq
        _realtime_event_state["event"] = event_name
        _realtime_event_state["payload"] = payload
        _realtime_event_history.append({
            "seq": next_seq,
            "event": event_name,
            "payload": dict(payload),
        })
        _realtime_event_condition.notify_all()


def _snapshot_realtime_events_since(last_seen_seq):
    history = list(_realtime_event_history)
    if not history:
        return {
            "events": [],
            "oldest_seq": last_seen_seq,
            "latest_seq": last_seen_seq,
            "gap": False,
        }

    oldest_seq = int(history[0].get("seq", 0))
    latest_seq = int(history[-1].get("seq", 0))
    last_seq = max(0, int(last_seen_seq))
    gap = last_seq < (oldest_seq - 1)

    pending = [e for e in history if int(e.get("seq", 0)) > last_seq]
    return {
        "events": pending,
        "oldest_seq": oldest_seq,
        "latest_seq": latest_seq,
        "gap": gap,
    }

try:
    PILImageModule = importlib.import_module('PIL.Image')
    PILModule = importlib.import_module('PIL')
    PILUnidentifiedImageError = getattr(PILModule, 'UnidentifiedImageError', Exception)
except Exception:
    PILImageModule = None
    PILUnidentifiedImageError = Exception


def _asegurar_validador_pillow():
    global PILImageModule, PILUnidentifiedImageError
    if PILImageModule is not None:
        return True

    try:
        PILImageModule = importlib.import_module('PIL.Image')
        PILModule = importlib.import_module('PIL')
        PILUnidentifiedImageError = getattr(PILModule, 'UnidentifiedImageError', Exception)
        return True
    except Exception:
        PILImageModule = None
        PILUnidentifiedImageError = Exception
        return False


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _file_size_bytes(file_obj):
    try:
        stream = file_obj.stream
        current_pos = stream.tell()
        stream.seek(0, os.SEEK_END)
        size = int(stream.tell())
        stream.seek(current_pos, os.SEEK_SET)
        return size
    except Exception:
        return None


def _sanitizar_nombre_archivo(filename):
    raw = str(filename or '').strip()
    sanitized = secure_filename(raw)

    if not sanitized:
        sanitized = f"upload_{secrets.token_hex(6)}.jpg"

    base, ext = os.path.splitext(sanitized)
    base = re.sub(r'[^A-Za-z0-9._-]+', '_', (base or '').strip())[:80] or f"upload_{secrets.token_hex(4)}"
    ext = (ext or '').lower().lstrip('.')
    if ext not in ALLOWED_EXTENSIONS:
        ext = 'jpg'

    return f"{base}.{ext}"


def _mime_normalizado(mime):
    m = (str(mime or '').strip().lower() or '').split(';')[0].strip()
    if m in {'image/pjpeg', 'image/jpg'}:
        return 'image/jpeg'
    return m


def _detectar_mime_por_firma(file_obj):
    stream = getattr(file_obj, 'stream', None)
    if stream is None:
        return ''

    current_pos = None
    try:
        current_pos = stream.tell()
        stream.seek(0)
        head = stream.read(16) or b''
    except Exception:
        return ''
    finally:
        try:
            if current_pos is not None:
                stream.seek(current_pos)
        except Exception:
            pass

    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if head.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if head.startswith(b'GIF87a') or head.startswith(b'GIF89a'):
        return 'image/gif'
    return ''


def _inspeccion_contenido_sospechoso(file_obj):
    stream = getattr(file_obj, 'stream', None)
    if stream is None:
        return False

    current_pos = None
    try:
        current_pos = stream.tell()
        stream.seek(0)
        sample = stream.read(max(64, FILE_SCAN_BYTES_LIMIT)) or b''
    except Exception:
        return False
    finally:
        try:
            if current_pos is not None:
                stream.seek(current_pos)
        except Exception:
            pass

    lowered = sample.lower()
    return any(marker in lowered for marker in SUSPICIOUS_FILE_MARKERS)


def _ejecutar_scan_externo(file_obj):
    if not FILE_SCAN_ENABLED:
        return True, ''

    if not FILE_SCAN_COMMAND:
        if FILE_SCAN_STRICT:
            return False, 'Escaneo de seguridad no configurado en el servidor.'
        return True, ''

    stream = getattr(file_obj, 'stream', None)
    if stream is None:
        return False, 'No se pudo preparar el archivo para escaneo.'

    current_pos = None
    tmp_path = None
    try:
        current_pos = stream.tell()
        stream.seek(0)
        payload = stream.read()

        suffix = f".{str(file_obj.filename or '').split('.')[-1].lower()}" if '.' in str(file_obj.filename or '') else '.bin'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(payload)
            tmp_path = tmp.name

        if '{file}' in FILE_SCAN_COMMAND:
            cmd = FILE_SCAN_COMMAND.format(file=tmp_path)
            result = subprocess.run(
                cmd,
                shell=True,
                timeout=FILE_SCAN_TIMEOUT_SECONDS,
                capture_output=True,
                text=True,
            )
        else:
            cmd_parts = shlex.split(FILE_SCAN_COMMAND, posix=False)
            cmd_parts.append(tmp_path)
            result = subprocess.run(
                cmd_parts,
                shell=False,
                timeout=FILE_SCAN_TIMEOUT_SECONDS,
                capture_output=True,
                text=True,
            )

        if result.returncode != 0:
            detalle = (result.stderr or result.stdout or '').strip()
            return False, detalle or 'Archivo rechazado por el escaneo de seguridad.'

        return True, ''
    except subprocess.TimeoutExpired:
        return False, 'Tiempo de escaneo agotado.'
    except Exception:
        return False, 'No se pudo completar el escaneo de seguridad.'
    finally:
        try:
            if current_pos is not None:
                stream.seek(current_pos)
        except Exception:
            pass
        if tmp_path:
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def _validar_contenido_imagen_seguro(file_obj):
    stream = getattr(file_obj, 'stream', None)
    if stream is None:
        return False, 'No se pudo leer el archivo.'

    mime_firma = _detectar_mime_por_firma(file_obj)
    if mime_firma not in ALLOWED_IMAGE_MIME_NORMALIZED:
        return False, 'Contenido de imagen invalido o no permitido.'

    if not _asegurar_validador_pillow():
        if IMAGE_VALIDATION_REQUIRE_PIL:
            return False, 'Validador de imagen no disponible en el servidor.'
        # Fallback seguro: ya se valido firma/mime, el resto de controles de
        # extension, inspeccion sospechosa y escaneo externo siguen activos.
        return True, ''

    current_pos = None
    try:
        current_pos = stream.tell()

        stream.seek(0)
        with PILImageModule.open(stream) as img:
            formato = (img.format or '').upper().strip()
            mime_formato = PIL_FORMAT_TO_MIME.get(formato, '')
            if not mime_formato:
                return False, 'Formato de imagen no soportado.'
            img.verify()

        stream.seek(0)
        with PILImageModule.open(stream) as img_segura:
            img_segura.load()
            if int(getattr(img_segura, 'width', 0) or 0) <= 0 or int(getattr(img_segura, 'height', 0) or 0) <= 0:
                return False, 'Imagen corrupta o sin dimensiones validas.'
            formato_seguro = (img_segura.format or '').upper().strip()
            mime_decodificado = PIL_FORMAT_TO_MIME.get(formato_seguro, '')

        if mime_decodificado != mime_firma:
            return False, 'El contenido no coincide con el tipo de imagen esperado.'

        return True, ''
    except PILUnidentifiedImageError:
        return False, 'No se pudo decodificar la imagen.'
    except Exception:
        return False, 'No se pudo validar de forma segura la imagen.'
    finally:
        try:
            if current_pos is not None:
                stream.seek(current_pos)
        except Exception:
            pass


def _validar_seguridad_archivo_imagen(file_obj, nombre):
    mime_firma = _detectar_mime_por_firma(file_obj)
    if mime_firma not in ALLOWED_IMAGE_MIME_NORMALIZED:
        return False, 'Contenido de imagen invalido o no permitido.'

    ok_img, motivo_img = _validar_contenido_imagen_seguro(file_obj)
    if not ok_img:
        return False, motivo_img

    ext = str(nombre or '').lower().rsplit('.', 1)[-1] if '.' in str(nombre or '') else ''
    allowed_ext_by_mime = MIME_TO_ALLOWED_EXTENSIONS.get(mime_firma, set())
    if ext and allowed_ext_by_mime and ext not in allowed_ext_by_mime:
        return False, 'La extension no coincide con el contenido real de la imagen.'

    if _inspeccion_contenido_sospechoso(file_obj):
        return False, 'Se detecto contenido sospechoso en el archivo.'

    ok_scan, motivo_scan = _ejecutar_scan_externo(file_obj)
    if not ok_scan:
        return False, f'Escaneo de seguridad fallido: {motivo_scan}'

    return True, ''


def _validar_archivos_cliente(archivos):
    archivos_limpios = [a for a in (archivos or []) if a and getattr(a, "filename", "")]
    if not archivos_limpios:
        return None, "Debes adjuntar al menos una foto."

    if len(archivos_limpios) > MAX_FILES_PER_ORDER:
        return None, f"Maximo permitido: {MAX_FILES_PER_ORDER} fotos por pedido."

    errores = []
    for archivo in archivos_limpios:
        nombre_original = str(archivo.filename or "").strip() or "archivo_sin_nombre"
        nombre = _sanitizar_nombre_archivo(nombre_original)
        archivo.filename = nombre

        if not allowed_file(nombre):
            errores.append(f"Formato no permitido: {nombre}")
            continue

        mime = (archivo.mimetype or "").lower().split(";")[0].strip()
        if mime and mime not in ALLOWED_IMAGE_MIMETYPES:
            errores.append(f"Tipo de archivo no permitido: {nombre}")
            continue

        size_bytes = _file_size_bytes(archivo)
        if size_bytes is None:
            errores.append(f"No se pudo validar el tamano: {nombre}")
            continue

        if size_bytes <= 0:
            errores.append(f"Archivo vacio: {nombre}")
            continue

        if size_bytes > MAX_IMAGE_BYTES_PER_FILE:
            limite_mb = int(MAX_IMAGE_BYTES_PER_FILE / (1024 * 1024))
            errores.append(f"{nombre} supera {limite_mb} MB")
            continue

        ok_seguridad, motivo_seguridad = _validar_seguridad_archivo_imagen(archivo, nombre)
        if not ok_seguridad:
            errores.append(f"{nombre}: {motivo_seguridad}")
            continue

        mime_firma = _detectar_mime_por_firma(archivo)
        mime_cliente = _mime_normalizado(mime)
        if mime_cliente and mime_firma and mime_cliente != mime_firma:
            errores.append(f"{nombre}: el tipo MIME enviado no coincide con el contenido real.")
            continue

        try:
            archivo.stream.seek(0)
        except Exception:
            pass

    if errores:
        resumen = "; ".join(errores[:3])
        if len(errores) > 3:
            resumen += f"; y {len(errores) - 3} archivo(s) mas"
        return None, f"Archivos invalidos: {resumen}"

    for archivo in archivos_limpios:
        try:
            archivo.stream.seek(0)
        except Exception:
            pass

    return archivos_limpios, None


def allowed_frame_file(file_obj):
    """
    Validate frame file by extension and mimetype.
    """
    if not file_obj or not file_obj.filename:
        return False

    if '.' not in file_obj.filename:
        return False

    extension = file_obj.filename.rsplit('.', 1)[1].lower()
    if extension not in FRAME_ALLOWED_EXTENSIONS:
        return False

    mime = (file_obj.mimetype or '').lower().strip()
    if mime and mime not in FRAME_ALLOWED_MIMETYPES:
        return False

    return True


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


def _marco_to_dict(marco):
    return {
        "id": marco.id,
        "nombre": marco.nombre,
        "imagen_url": marco.imagen_url,
        "activo": bool(marco.activo),
        "created_at": marco.created_at.isoformat() if marco.created_at else None,
        "updated_at": marco.updated_at.isoformat() if marco.updated_at else None,
    }


def _validar_draft_key(draft_key):
    return bool(draft_key and DRAFT_KEY_REGEX.match(draft_key))


def _payload_size_ok(payload):
    try:
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    except Exception:
        return False
    return len(encoded) <= MAX_DRAFT_PAYLOAD_BYTES


def _draft_to_dict(draft):
    return {
        "draftKey": draft.draft_key,
        "payload": draft.payload or {},
        "version": int(draft.version or 1),
        "updatedAt": draft.updated_at.isoformat() if draft.updated_at else None,
    }


def _clamp_retention_days(value, default_value=30):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = int(default_value)
    return max(1, min(parsed, 3650))


def _clamp_cleanup_interval_minutes(value, default_value=60):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = int(default_value)
    return max(5, min(parsed, 24 * 60))


def _normalize_retention_mode(mode, retention_days):
    raw_mode = str(mode or "").strip().lower()
    if raw_mode in IMAGE_STORAGE_RETENTION_PRESETS:
        return raw_mode
    reverse = {1: "1d", 7: "7d", 30: "30d"}
    return reverse.get(int(retention_days or 0), "custom")


def _ensure_utc_datetime(value):
    if not value:
        return None
    if getattr(value, "tzinfo", None) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _get_or_create_image_storage_settings():
    settings = ImageStorageSetting.query.order_by(ImageStorageSetting.id.asc()).first()
    if settings:
        changed = False
        settings.retention_days = _clamp_retention_days(
            settings.retention_days,
            IMAGE_STORAGE_DEFAULT_RETENTION_DAYS,
        )
        normalized_mode = _normalize_retention_mode(settings.retention_mode, settings.retention_days)
        if settings.retention_mode != normalized_mode:
            settings.retention_mode = normalized_mode
            changed = True

        normalized_interval = _clamp_cleanup_interval_minutes(
            settings.cleanup_interval_minutes,
            IMAGE_STORAGE_DEFAULT_CLEANUP_INTERVAL_MINUTES,
        )
        if settings.cleanup_interval_minutes != normalized_interval:
            settings.cleanup_interval_minutes = normalized_interval
            changed = True

        if changed:
            db.session.commit()
        return settings

    default_days = _clamp_retention_days(IMAGE_STORAGE_DEFAULT_RETENTION_DAYS, 30)
    settings = ImageStorageSetting(
        retention_mode=_normalize_retention_mode("", default_days),
        retention_days=default_days,
        cleanup_interval_minutes=_clamp_cleanup_interval_minutes(
            IMAGE_STORAGE_DEFAULT_CLEANUP_INTERVAL_MINUTES,
            60,
        ),
    )
    db.session.add(settings)
    db.session.commit()
    return settings


def _expiration_for_new_image(retention_days):
    days = _clamp_retention_days(retention_days, IMAGE_STORAGE_DEFAULT_RETENTION_DAYS)
    return datetime.now(timezone.utc) + timedelta(days=days)


def _storage_settings_to_dict(settings):
    mode = _normalize_retention_mode(settings.retention_mode, settings.retention_days)
    presets = [
        {"key": "1d", "label": "1 día", "days": 1},
        {"key": "7d", "label": "7 días", "days": 7},
        {"key": "30d", "label": "30 días", "days": 30},
        {"key": "custom", "label": "Personalizado", "days": None},
    ]
    return {
        "retentionMode": mode,
        "retentionDays": int(settings.retention_days or 30),
        "cleanupIntervalMinutes": int(settings.cleanup_interval_minutes or 60),
        "updatedAt": settings.updated_at.isoformat() if settings.updated_at else None,
        "presets": presets,
        "policyText": f"Las imágenes nuevas vencen a los {int(settings.retention_days or 30)} día(s).",
    }


def _photo_storage_item_to_dict(foto, cliente):
    now_utc = datetime.now(timezone.utc)
    expires_at = _ensure_utc_datetime(foto.expires_at)
    remaining_seconds = None
    is_expired = False

    if expires_at:
        remaining_seconds = int((expires_at - now_utc).total_seconds())
        is_expired = remaining_seconds <= 0

    status = "active"
    if bool(foto.exclude_auto_delete):
        status = "excluded"
    elif not expires_at:
        status = "without_expiration"
    elif is_expired:
        status = "expired"

    cliente_nombre = ""
    if cliente:
        cliente_nombre = f"{str(cliente.nombre or '').strip()} {str(cliente.apellido or '').strip()}".strip()

    return {
        "id": foto.id,
        "clienteId": foto.cliente_id,
        "clienteNombre": cliente_nombre,
        "clienteCorreo": (cliente.correo if cliente else "") or "",
        "url": foto.filename,
        "publicId": foto.public_id,
        "excludeAutoDelete": bool(foto.exclude_auto_delete),
        "expiresAt": expires_at.isoformat() if expires_at else None,
        "remainingSeconds": remaining_seconds,
        "isExpired": is_expired,
        "status": status,
        "createdAt": foto.created_at.isoformat() if foto.created_at else None,
    }


def _infer_public_id_from_url(url):
    if not url:
        return None

    try:
        url_text = str(url)
        marker = "/upload/"
        if marker not in url_text:
            return None

        path_after_upload = url_text.split(marker, 1)[1].strip("/")
        if not path_after_upload:
            return None

        segments = [seg for seg in path_after_upload.split("/") if seg]
        if not segments:
            return None

        version_idx = -1
        for idx, segment in enumerate(segments):
            if PUBLIC_ID_FROM_URL_REGEX.match(segment):
                version_idx = idx
                break

        public_id_segments = segments[(version_idx + 1) if version_idx >= 0 else 0:]
        if not public_id_segments:
            return None

        public_id_segments[-1] = re.sub(r'\.[A-Za-z0-9]+$', '', public_id_segments[-1])
        public_id = "/".join(public_id_segments).strip("/")
        return public_id or None
    except Exception:
        return None


def _destroy_cloudinary_image(public_id):
    if not public_id:
        return False
    try:
        result = cloudinary.uploader.destroy(public_id, resource_type="image")
        status = str((result or {}).get("result", "")).lower()
        # Cloudinary reporta "not found" si el recurso ya fue eliminado.
        return status in {"ok", "not found"}
    except Exception as e:
        print(f"Error eliminando recurso Cloudinary {public_id}: {e}")
        return False


def _cleanup_expired_cloudinary_images(limit=250):
    now_utc = datetime.now(timezone.utc)
    fotos = (
        Foto.query
        .filter(
            Foto.exclude_auto_delete.is_(False),
            Foto.expires_at.isnot(None),
            Foto.expires_at <= now_utc,
        )
        .order_by(Foto.expires_at.asc(), Foto.id.asc())
        .limit(max(1, int(limit)))
        .all()
    )

    eliminadas = 0
    fallos = 0

    for foto in fotos:
        public_id = (foto.public_id or "").strip() or _infer_public_id_from_url(foto.filename)
        if not public_id:
            fallos += 1
            continue

        if _destroy_cloudinary_image(public_id):
            db.session.delete(foto)
            eliminadas += 1
        else:
            fallos += 1

    if eliminadas > 0:
        db.session.commit()

    return {
        "evaluadas": len(fotos),
        "eliminadas": eliminadas,
        "fallos": fallos,
    }


def _run_expired_images_cleanup_if_due(force=False, trigger="request"):
    global _last_expired_images_cleanup_run_ts

    settings = _get_or_create_image_storage_settings()
    interval_seconds = max(300, int(settings.cleanup_interval_minutes or 60) * 60)
    now_ts = time.time()
    if not force and (now_ts - _last_expired_images_cleanup_run_ts) < interval_seconds:
        return {"ok": False, "skipped": "interval", "trigger": trigger}

    acquired = _expired_images_cleanup_lock.acquire(blocking=False)
    if not acquired:
        return {"ok": False, "skipped": "busy", "trigger": trigger}

    try:
        settings = _get_or_create_image_storage_settings()
        interval_seconds = max(300, int(settings.cleanup_interval_minutes or 60) * 60)
        now_ts = time.time()
        if not force and (now_ts - _last_expired_images_cleanup_run_ts) < interval_seconds:
            return {"ok": False, "skipped": "interval", "trigger": trigger}

        resumen = _cleanup_expired_cloudinary_images(limit=250)
        _last_expired_images_cleanup_run_ts = time.time()

        if resumen["eliminadas"] > 0 or resumen["fallos"] > 0:
            print(
                "[cleanup] expiracion imagenes: "
                f"evaluadas={resumen['evaluadas']}, "
                f"eliminadas={resumen['eliminadas']}, "
                f"fallos={resumen['fallos']}, "
                f"trigger={trigger}"
            )

        return {"ok": True, "trigger": trigger, **resumen}
    finally:
        _expired_images_cleanup_lock.release()


def _expired_images_cleanup_worker():
    poll_seconds = max(45, min(int(IMAGE_STORAGE_WORKER_POLL_SECONDS), 5 * 60))
    while True:
        try:
            with app.app_context():
                _run_expired_images_cleanup_if_due(force=False, trigger="worker")
        except Exception as e:
            print(f"[cleanup] error en worker de expiracion: {e}")
        time.sleep(poll_seconds)


def _start_expired_images_cleanup_worker():
    global _expired_images_cleanup_thread_started
    if _expired_images_cleanup_thread_started:
        return

    is_debug_reloader_parent = (
        os.environ.get("WERKZEUG_RUN_MAIN") is None and _env_bool("FLASK_DEBUG", False)
    )
    if is_debug_reloader_parent:
        return

    worker = Thread(target=_expired_images_cleanup_worker, name="expired-images-cleanup", daemon=True)
    worker.start()
    _expired_images_cleanup_thread_started = True
    print("[cleanup] worker de expiracion de imagenes iniciado")


def _cleanup_cancelled_order_photos(retention_days=CLOUDINARY_CANCELLED_RETENTION_DAYS):
    if retention_days <= 0:
        return {"clientes": 0, "fotos_eliminadas": 0, "fallos": 0}

    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    clientes = Cliente.query.filter(
        Cliente.estado == "cancelado",
        Cliente.cancelled_at.isnot(None),
        Cliente.cancelled_at <= cutoff,
    ).all()

    fotos_eliminadas = 0
    fallos = 0

    for cliente in clientes:
        fotos_cliente = list(cliente.fotos or [])
        for foto in fotos_cliente:
            public_id = (foto.public_id or "").strip() or _infer_public_id_from_url(foto.filename)

            if not public_id:
                fallos += 1
                continue

            if _destroy_cloudinary_image(public_id):
                db.session.delete(foto)
                fotos_eliminadas += 1
            else:
                fallos += 1

    if fotos_eliminadas > 0:
        db.session.commit()

    return {
        "clientes": len(clientes),
        "fotos_eliminadas": fotos_eliminadas,
        "fallos": fallos,
    }


def _run_cancelled_cleanup_if_due(force=False):
    global _last_cancelled_cleanup_run_ts

    now_ts = time.time()
    if not force and (now_ts - _last_cancelled_cleanup_run_ts) < CLOUDINARY_CANCELLED_CLEANUP_INTERVAL_SECONDS:
        return

    acquired = _cancelled_cleanup_lock.acquire(blocking=False)
    if not acquired:
        return

    try:
        now_ts = time.time()
        if not force and (now_ts - _last_cancelled_cleanup_run_ts) < CLOUDINARY_CANCELLED_CLEANUP_INTERVAL_SECONDS:
            return

        resumen = _cleanup_cancelled_order_photos(CLOUDINARY_CANCELLED_RETENTION_DAYS)
        _last_cancelled_cleanup_run_ts = time.time()

        if resumen["fotos_eliminadas"] > 0 or resumen["fallos"] > 0:
            print(
                "[cleanup] pedidos cancelados: "
                f"clientes={resumen['clientes']}, "
                f"fotos_eliminadas={resumen['fotos_eliminadas']}, "
                f"fallos={resumen['fallos']}"
            )
    finally:
        _cancelled_cleanup_lock.release()


def _backup_dir_path():
    return Path(DB_BACKUP_DIR)


def _initialize_db_backup_last_run_from_disk():
    global _last_db_backup_run_ts
    if _last_db_backup_run_ts > 0:
        return

    backup_dir = _backup_dir_path()
    if not backup_dir.exists():
        return

    try:
        backups = sorted(
            backup_dir.glob("db_backup_*.sql"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if backups:
            _last_db_backup_run_ts = backups[0].stat().st_mtime
    except Exception:
        return


def _build_pg_dump_command(output_file):
    db_url = make_url(DB_URL)
    if not str(db_url.drivername or "").startswith("postgresql"):
        raise RuntimeError("Backup automatico soporta solo PostgreSQL.")

    if not db_url.database:
        raise RuntimeError("DATABASE_URL no contiene nombre de base de datos.")

    cmd = [
        DB_BACKUP_COMMAND,
        "--format=plain",
        "--no-owner",
        "--no-privileges",
        "--encoding=UTF8",
        "--file",
        str(output_file),
    ]

    if db_url.host:
        cmd.extend(["--host", str(db_url.host)])
    if db_url.port:
        cmd.extend(["--port", str(db_url.port)])
    if db_url.username:
        cmd.extend(["--username", str(db_url.username)])

    cmd.append(str(db_url.database))

    env = os.environ.copy()
    if db_url.password is not None:
        env["PGPASSWORD"] = str(db_url.password)

    return cmd, env


def _prune_old_db_backups():
    deleted = 0
    backup_dir = _backup_dir_path()
    if not backup_dir.exists():
        return deleted

    cutoff = datetime.now(timezone.utc) - timedelta(days=max(DB_BACKUP_RETENTION_DAYS, 1))
    for backup_file in backup_dir.glob("db_backup_*.sql"):
        try:
            file_mtime = datetime.fromtimestamp(backup_file.stat().st_mtime, tz=timezone.utc)
            if file_mtime < cutoff:
                backup_file.unlink()
                deleted += 1
        except Exception as e:
            print(f"Error eliminando backup antiguo {backup_file}: {e}")

    return deleted


def _perform_db_backup(trigger="scheduled"):
    backup_dir = _backup_dir_path()
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    output_file = backup_dir / f"db_backup_{timestamp}.sql"

    if shutil.which(DB_BACKUP_COMMAND) is None:
        return {
            "ok": False,
            "trigger": trigger,
            "error": f"No se encontro el comando '{DB_BACKUP_COMMAND}' en PATH.",
        }

    cmd, env = _build_pg_dump_command(output_file)
    result = subprocess.run(
        cmd,
        env=env,
        capture_output=True,
        text=True,
        timeout=15 * 60,
    )

    if result.returncode != 0:
        if output_file.exists():
            output_file.unlink()
        return {
            "ok": False,
            "trigger": trigger,
            "error": (result.stderr or result.stdout or "Fallo de pg_dump").strip(),
        }

    pruned = _prune_old_db_backups()
    return {
        "ok": True,
        "trigger": trigger,
        "path": str(output_file),
        "pruned": pruned,
    }


def _run_db_backup_if_due(force=False, trigger="scheduled"):
    global _last_db_backup_run_ts

    if not DB_BACKUP_ENABLED:
        return {"ok": False, "skipped": "disabled", "trigger": trigger}

    _initialize_db_backup_last_run_from_disk()

    interval = max(DB_BACKUP_INTERVAL_SECONDS, 60)
    now_ts = time.time()
    if not force and (now_ts - _last_db_backup_run_ts) < interval:
        return {"ok": False, "skipped": "interval", "trigger": trigger}

    acquired = _db_backup_lock.acquire(blocking=False)
    if not acquired:
        return {"ok": False, "skipped": "busy", "trigger": trigger}

    try:
        now_ts = time.time()
        if not force and (now_ts - _last_db_backup_run_ts) < interval:
            return {"ok": False, "skipped": "interval", "trigger": trigger}

        backup_result = _perform_db_backup(trigger=trigger)
        _last_db_backup_run_ts = time.time()

        if backup_result.get("ok"):
            print(f"[backup] respaldo creado: {backup_result.get('path')}")
        else:
            print(f"[backup] error: {backup_result.get('error')}")

        return backup_result
    finally:
        _db_backup_lock.release()


def _db_backup_worker():
    poll_seconds = max(30, min(max(DB_BACKUP_INTERVAL_SECONDS, 60), 15 * 60))
    while True:
        try:
            _run_db_backup_if_due(force=False, trigger="worker")
        except Exception as e:
            print(f"[backup] error en worker: {e}")
        time.sleep(poll_seconds)


def _start_db_backup_worker():
    global _db_backup_thread_started
    if not DB_BACKUP_ENABLED or _db_backup_thread_started:
        return

    is_debug_reloader_parent = (
        os.environ.get("WERKZEUG_RUN_MAIN") is None and _env_bool("FLASK_DEBUG", False)
    )
    if is_debug_reloader_parent:
        return

    worker = Thread(target=_db_backup_worker, name="db-backup-worker", daemon=True)
    worker.start()
    _db_backup_thread_started = True
    print("[backup] worker automatico iniciado")

db.init_app(app)
app.register_blueprint(auth_bp)
app.register_blueprint(order_age_bp)

# Crea las tablas si no existen + migraciÃ³n ligera
with app.app_context():
    db.create_all()
    # Agregar columnas nuevas si la tabla ya existÃ­a sin ellas
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
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ"))
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "ALTER TABLE clientes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "UPDATE clientes SET estado='pendiente' WHERE estado IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET estado='listo_retiro' "
            "WHERE lower(replace(trim(estado), ' ', '_')) IN ('enviado', 'listo_para_retirar')"))
        conn.execute(db.text(
            "UPDATE clientes SET pagado=FALSE WHERE pagado IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET cancelled_at=NOW() WHERE estado='cancelado' AND cancelled_at IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET created_at=NOW() WHERE created_at IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET updated_at=NOW() WHERE updated_at IS NULL"))
        conn.execute(db.text(
            "ALTER TABLE clientes ALTER COLUMN created_at SET NOT NULL"))
        conn.execute(db.text(
            "ALTER TABLE clientes ALTER COLUMN updated_at SET NOT NULL"))
        # Permite multiples pedidos por correo: elimina cualquier UNIQUE legado en clientes.correo.
        conn.execute(db.text(
            "DO $$ "
            "DECLARE item RECORD; "
            "BEGIN "
            "  FOR item IN "
            "    SELECT c.conname AS object_name "
            "    FROM pg_constraint c "
            "    JOIN pg_class t ON t.oid = c.conrelid "
            "    JOIN pg_namespace n ON n.oid = t.relnamespace "
            "    WHERE c.contype = 'u' "
            "      AND t.relname = 'clientes' "
            "      AND n.nspname = current_schema() "
            "      AND pg_get_constraintdef(c.oid) ILIKE '%(correo)%' "
            "  LOOP "
            "    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', current_schema(), 'clientes', item.object_name); "
            "  END LOOP; "
            " "
            "  FOR item IN "
            "    SELECT idx.relname AS object_name "
            "    FROM pg_class t "
            "    JOIN pg_namespace n ON n.oid = t.relnamespace "
            "    JOIN pg_index i ON i.indrelid = t.oid "
            "    JOIN pg_class idx ON idx.oid = i.indexrelid "
            "    LEFT JOIN pg_constraint c ON c.conindid = i.indexrelid "
            "    WHERE t.relname = 'clientes' "
            "      AND n.nspname = current_schema() "
            "      AND i.indisunique "
            "      AND NOT i.indisprimary "
            "      AND c.oid IS NULL "
            "      AND i.indnatts = 1 "
            "      AND ( "
            "        SELECT a.attname "
            "        FROM pg_attribute a "
            "        WHERE a.attrelid = t.oid AND a.attnum = i.indkey[0] "
            "      ) = 'correo' "
            "  LOOP "
            "    EXECUTE format('DROP INDEX IF EXISTS %I.%I', current_schema(), item.object_name); "
            "  END LOOP; "
            "END $$;"))
        conn.execute(db.text(
            "CREATE INDEX IF NOT EXISTS idx_clientes_estado_cancelled_at ON clientes (estado, cancelled_at)"))
        conn.execute(db.text(
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS public_id VARCHAR(255)"))
        conn.execute(db.text(
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS cantidad INTEGER NOT NULL DEFAULT 1"))
        conn.execute(db.text(
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ"))
        conn.execute(db.text(
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS exclude_auto_delete BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(db.text(
            "ALTER TABLE fotos ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"))
        conn.execute(db.text(
            "CREATE INDEX IF NOT EXISTS idx_fotos_expires_at ON fotos (expires_at)"))
        conn.execute(db.text(
            "CREATE INDEX IF NOT EXISTS idx_fotos_expires_active ON fotos (expires_at) WHERE exclude_auto_delete = FALSE"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS nombre VARCHAR(100)"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS precio_base FLOAT"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE"))
        conn.execute(db.text(
            "ALTER TABLE foto_tamanos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "ALTER TABLE marcos_diseno ADD COLUMN IF NOT EXISTS nombre VARCHAR(120)"))
        conn.execute(db.text(
            "ALTER TABLE marcos_diseno ADD COLUMN IF NOT EXISTS imagen_url VARCHAR(500)"))
        conn.execute(db.text(
            "ALTER TABLE marcos_diseno ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT TRUE"))
        conn.execute(db.text(
            "ALTER TABLE marcos_diseno ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "ALTER TABLE marcos_diseno ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "CREATE TABLE IF NOT EXISTS cliente_drafts ("
            "id SERIAL PRIMARY KEY, "
            "draft_key VARCHAR(80) NOT NULL UNIQUE, "
            "payload JSONB NOT NULL DEFAULT '{}'::jsonb, "
            "version INTEGER NOT NULL DEFAULT 1, "
            "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), "
            "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
            ")"))
        conn.execute(db.text(
            "ALTER TABLE cliente_drafts ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb"))
        conn.execute(db.text(
            "ALTER TABLE cliente_drafts ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1"))
        conn.execute(db.text(
            "ALTER TABLE cliente_drafts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "ALTER TABLE cliente_drafts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "CREATE INDEX IF NOT EXISTS idx_cliente_drafts_draft_key ON cliente_drafts (draft_key)"))
        conn.execute(db.text(
            "CREATE TABLE IF NOT EXISTS image_storage_settings ("
            "id SERIAL PRIMARY KEY, "
            "retention_mode VARCHAR(20) NOT NULL DEFAULT '30d', "
            "retention_days INTEGER NOT NULL DEFAULT 30, "
            "cleanup_interval_minutes INTEGER NOT NULL DEFAULT 60, "
            "updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
            ")"))
        conn.execute(db.text(
            "ALTER TABLE image_storage_settings ADD COLUMN IF NOT EXISTS retention_mode VARCHAR(20) DEFAULT '30d'"))
        conn.execute(db.text(
            "ALTER TABLE image_storage_settings ADD COLUMN IF NOT EXISTS retention_days INTEGER DEFAULT 30"))
        conn.execute(db.text(
            "ALTER TABLE image_storage_settings ADD COLUMN IF NOT EXISTS cleanup_interval_minutes INTEGER DEFAULT 60"))
        conn.execute(db.text(
            "ALTER TABLE image_storage_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
        conn.execute(db.text(
            "INSERT INTO image_storage_settings (retention_mode, retention_days, cleanup_interval_minutes) "
            "SELECT '30d', 30, 60 "
            "WHERE NOT EXISTS (SELECT 1 FROM image_storage_settings)"))
        conn.commit()

    # Seed inicial de tamanos si la tabla estÃ¡ vacÃ­a
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
    # Las contraseñas DEBEN estar configuradas en variables de entorno
    _admin_pw = os.environ.get("ADMIN_PASSWORD")
    _operador_pw = os.environ.get("OPERADOR_PASSWORD")
    _cajero_pw = os.environ.get("CAJERO_PASSWORD")
    if not _admin_pw or not _operador_pw or not _cajero_pw:
        print("ADVERTENCIA: Faltan variables de entorno ADMIN_PASSWORD, OPERADOR_PASSWORD o CAJERO_PASSWORD. "
              "Los usuarios no se crearan sin contraseñas seguras configuradas.")
    default_users = []
    if _admin_pw:
        default_users.append({
            "username": os.environ.get("ADMIN_USERNAME", "admin"),
            "email": os.environ.get("ADMIN_EMAIL", "admin@imagemanager.local"),
            "password": _admin_pw,
            "role": "admin",
        })
    if _operador_pw:
        default_users.append({
            "username": os.environ.get("OPERADOR_USERNAME", "operador"),
            "email": os.environ.get("OPERADOR_EMAIL", "operador@imagemanager.local"),
            "password": _operador_pw,
            "role": "operador",
        })
    if _cajero_pw:
        default_users.append({
            "username": os.environ.get("CAJERO_USERNAME", "cajero"),
            "email": os.environ.get("CAJERO_EMAIL", "cajero@imagemanager.local"),
            "password": _cajero_pw,
            "role": "cajero",
        })

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

    try:
        _run_cancelled_cleanup_if_due(force=True)
    except Exception as e:
        print(f"Error en limpieza inicial de pedidos cancelados: {e}")

    try:
        _run_db_backup_if_due(force=False, trigger="startup")
    except Exception as e:
        print(f"Error en backup inicial de base de datos: {e}")

    try:
        _run_expired_images_cleanup_if_due(force=False, trigger="startup")
    except Exception as e:
        print(f"Error en limpieza inicial de imagenes expiradas: {e}")

_start_db_backup_worker()
_start_expired_images_cleanup_worker()

@app.route('/')
def home():
    return render_template('index.html')


@app.route('/seguimiento')
def seguimiento():
    return render_template('seguimiento.html')

# crea una ruta para la pÃ¡gina de administraciÃ³n
@app.route('/admin')
@login_required
@role_required('admin')
def admin():
    return render_template('admin.html')
# imprime un mensaje en la consola para indicar que el programa estÃ¡ funcionando
print("El programa estÃ¡ funcionando")
@app.route('/operador')
@login_required
@role_required('operador')
def operador():
    return render_template('operador.html')


@app.route('/cajero')
@login_required
@role_required('cajero')
def cajero():
    return render_template('cajero.html')


@app.before_request
def _background_cancelled_cleanup():
    try:
        _run_cancelled_cleanup_if_due(force=False)
    except Exception as e:
        print(f"Error en limpieza programada de pedidos cancelados: {e}")

    try:
        _run_db_backup_if_due(force=False, trigger="request")
    except Exception as e:
        print(f"Error en backup programado de base de datos: {e}")

    try:
        _run_expired_images_cleanup_if_due(force=False, trigger="request")
    except Exception as e:
        print(f"Error en limpieza programada de imagenes expiradas: {e}")


@app.route('/api/admin/db-backup', methods=['POST'])
@login_required
@role_required('admin')
def admin_db_backup_now():
    result = _run_db_backup_if_due(force=True, trigger="manual")
    if result.get("ok") or result.get("skipped"):
        return jsonify(result), 200
    return jsonify(result), 500


@app.route('/api/autosave/<string:draft_key>', methods=['GET', 'PUT', 'DELETE'])
def autosave_draft(draft_key):
    if not _validar_draft_key(draft_key):
        return jsonify({"error": "Clave de borrador invalida"}), 400

    draft = ClienteDraft.query.filter_by(draft_key=draft_key).first()

    if request.method == 'GET':
        if not draft:
            return jsonify({"draft": None}), 404
        return jsonify({"draft": _draft_to_dict(draft)}), 200

    if request.method == 'DELETE':
        if draft:
            db.session.delete(draft)
            db.session.commit()
        return jsonify({"ok": True}), 200

    data = request.get_json(silent=True) or {}
    payload = data.get("payload")
    base_version = data.get("baseVersion")
    force_write = bool(data.get("force"))

    if not isinstance(payload, dict):
        return jsonify({"error": "Payload de borrador invalido"}), 400

    if not _payload_size_ok(payload):
        return jsonify({"error": "Borrador demasiado grande"}), 413

    if draft:
        if base_version is not None and not force_write:
            try:
                base_version = int(base_version)
            except (TypeError, ValueError):
                return jsonify({"error": "baseVersion invalido"}), 400

            if base_version != int(draft.version or 1):
                return jsonify({
                    "error": "conflict",
                    "draft": _draft_to_dict(draft),
                }), 409

        draft.payload = payload
        draft.version = int(draft.version or 1) + 1
    else:
        draft = ClienteDraft(
            draft_key=draft_key,
            payload=payload,
            version=1,
        )
        db.session.add(draft)

    db.session.commit()

    status_code = 200 if draft and draft.version > 1 else 201
    return jsonify({
        "ok": True,
        "draft": _draft_to_dict(draft),
    }), status_code


@app.route('/api/autosave/<string:draft_key>/beacon', methods=['POST'])
def autosave_draft_beacon(draft_key):
    if not _validar_draft_key(draft_key):
        return jsonify({"error": "Clave de borrador invalida"}), 400

    data = request.get_json(silent=True) or {}
    payload = data.get("payload")

    if not isinstance(payload, dict):
        return jsonify({"error": "Payload de borrador invalido"}), 400

    if not _payload_size_ok(payload):
        return jsonify({"error": "Borrador demasiado grande"}), 413

    draft = ClienteDraft.query.filter_by(draft_key=draft_key).first()
    if draft:
        draft.payload = payload
        draft.version = int(draft.version or 1) + 1
    else:
        draft = ClienteDraft(
            draft_key=draft_key,
            payload=payload,
            version=1,
        )
        db.session.add(draft)

    db.session.commit()
    return jsonify({"ok": True, "draft": _draft_to_dict(draft)}), 200

@app.route('/api/upload-temporal', methods=['POST'])
def upload_temporal():
    if 'foto' not in request.files:
        return jsonify({"error": "No has enviado ninguna foto"}), 400
    
    file = request.files['foto']
    if not file or not file.filename:
        return jsonify({"error": "Archivo vacio"}), 400

    file.filename = _sanitizar_nombre_archivo(file.filename)
        
    if not allowed_file(file.filename):
        return jsonify({"error": f"Formato no permitido: {file.filename}"}), 400
        
    mime = (file.mimetype or "").lower().split(";")[0].strip()
    if mime and mime not in ALLOWED_IMAGE_MIMETYPES:
        return jsonify({"error": f"Tipo de archivo no permitido: {file.filename}"}), 400

    ok_seguridad, motivo_seguridad = _validar_seguridad_archivo_imagen(file, file.filename)
    if not ok_seguridad:
        return jsonify({"error": f"Imagen invalida: {motivo_seguridad}"}), 400

    mime_firma = _detectar_mime_por_firma(file)
    mime_cliente = _mime_normalizado(mime)
    if mime_cliente and mime_firma and mime_cliente != mime_firma:
        return jsonify({"error": f"Tipo MIME no coincide con el contenido real: {file.filename}"}), 400
        
    size_bytes = _file_size_bytes(file)
    if size_bytes is not None and size_bytes > MAX_IMAGE_BYTES_PER_FILE:
        return jsonify({"error": f"Supera limite {MAX_IMAGE_BYTES_PER_FILE/(1024*1024)}MB"}), 413
        
    draft_key_or_session = request.form.get("draftKey", "temp_anon")
    folder = f"image_manager/draft_{draft_key_or_session}"
    
    try:
        data = file.stream.read()
        stream = io.BytesIO(data)
        stream.name = file.filename
        
        resultado = cloudinary.uploader.upload(
            stream,
            folder=folder,
            resource_type="image",
        )
        return jsonify({
            "secure_url": resultado["secure_url"],
            "public_id": resultado["public_id"],
            "filename": file.filename
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 502

@app.route('/api/clientes', methods=['POST'])
def crear_clientes():
    fotos_precargadas = []

    def _normalizar_fotos_precargadas(items):
        if not isinstance(items, list):
            return []

        normalizadas = []
        for pre in items:
            if not isinstance(pre, dict):
                continue

            secure_url = str(pre.get('secure_url') or '').strip()
            public_id = str(pre.get('public_id') or '').strip()
            if not secure_url or not public_id:
                continue

            try:
                cantidad = max(1, int(pre.get('cantidad', 1)))
            except (TypeError, ValueError):
                cantidad = 1

            normalizadas.append({
                'secure_url': secure_url,
                'public_id': public_id,
                'cantidad': cantidad,
            })

        return normalizadas
    
    # Soporta FormData (con fotos) y JSON (sin fotos)
    if request.content_type and 'multipart/form-data' in request.content_type:
        data = request.form.to_dict()

        precargadas_json_str = data.get('fotosPreCargadas', '[]')
        try:
            fotos_precargadas = _normalizar_fotos_precargadas(json.loads(precargadas_json_str))
        except Exception:
            fotos_precargadas = []

        archivos_entrantes = request.files.getlist('fotos')
        archivos_contenido = [a for a in (archivos_entrantes or []) if a and getattr(a, 'filename', '')]
        if archivos_contenido:
            archivos, error_archivos = _validar_archivos_cliente(archivos_contenido)
            if error_archivos:
                return jsonify({"error": error_archivos}), 400
        else:
            archivos = []
    else:
        data = request.get_json() or {}
        archivos = []
        fotos_precargadas = _normalizar_fotos_precargadas(data.get("fotosPreCargadas", []))

    # ValidaciÃ³n bÃ¡sica backend
    campos = ['nombre', 'apellido', 'correo', 'telefono', 'fechaRegistro']
    for campo in campos:
        if not data.get(campo):
            return jsonify({"error": f"Campo '{campo}' requerido"}), 400

    if not archivos and not fotos_precargadas:
        return jsonify({"error": "Debes adjuntar al menos una foto valida."}), 400

    # Parsear cantidades por foto (viene como "2,1,3" en el mismo orden que los archivos)
    cantidades_raw = (data.get("cantidades") or "").strip()
    if cantidades_raw:
        try:
            cantidades_lista = [max(1, int(c.strip())) for c in cantidades_raw.split(',') if c.strip()]
        except (TypeError, ValueError):
            cantidades_lista = []
    else:
        cantidades_lista = []
    # Asegurar que haya una cantidad por cada archivo (default 1)
    while len(cantidades_lista) < len(archivos):
        cantidades_lista.append(1)

    # El flujo se decide por accion explicita + pedido_id.
    # No se agrupa por correo para evitar ambiguedades entre pedidos.
    correo_normalizado = str(data.get("correo") or "").strip().lower()
    append_existing_raw = str(data.get("append_existing") or "").strip().lower()
    append_existing = append_existing_raw in {"1", "true", "yes", "si", "sí", "on"}
    pedido_id_raw = str(data.get("pedido_id") or data.get("cliente_id") or "").strip()

    pedido_objetivo_id = None
    if append_existing:
        try:
            pedido_objetivo_id = int(pedido_id_raw)
        except (TypeError, ValueError):
            return jsonify({"error": "Para anexar fotos debes indicar un pedido_id valido."}), 400

    existe = None
    if append_existing and pedido_objetivo_id:
        existe = db.session.get(Cliente, pedido_objetivo_id)
        if not existe:
            return jsonify({"error": "El pedido seleccionado no existe o ya no esta disponible."}), 404

        # Validacion defensiva: el pedido objetivo debe pertenecer al mismo correo.
        if correo_normalizado and (str(existe.correo or "").strip().lower() != correo_normalizado):
            return jsonify({"error": "El pedido seleccionado no coincide con el correo indicado."}), 409

    storage_settings = _get_or_create_image_storage_settings()
    expires_at_for_new_images = _expiration_for_new_image(storage_settings.retention_days)

    if existe:
        # Actualizar datos del pedido (tamaÃ±o, papel, fecha)
        existe.tamano       = data.get("tamano", existe.tamano)
        existe.tamano_keys  = data.get("tamano_keys", existe.tamano_keys)

        
        existe.papel        = data.get("papel", existe.papel)
        existe.fecha_registro = data["fechaRegistro"]
        if not existe.estado or (existe.estado or '').strip().lower() == 'cancelado':
            existe.estado = 'pendiente'
            existe.cancelled_at = None
        if existe.pagado is None:
            existe.pagado = False

        # Subir nuevas fotos a Cloudinary (en paralelo para acelerar el submit)
        fotos_guardadas = []
        thumbnails_guardadas = []
        cantidades_guardadas = []
        folder = f"image_manager/cliente_{existe.id}"

        indices_validos = [
            (idx, archivo)
            for idx, archivo in enumerate(archivos)
            if archivo and archivo.filename and allowed_file(archivo.filename)
        ]

        resultados_por_idx = {}

        def _upload_cloudinary(idx, archivo):
            ultimo_error = None
            for intento in range(2):
                try:
                    try:
                        archivo.stream.seek(0)
                    except Exception:
                        pass

                    # Leer bytes para evitar que el stream compartido cause problemas al paralelizar.
                    data = archivo.stream.read()
                    stream = io.BytesIO(data)
                    stream.name = archivo.filename

                    resultado = cloudinary.uploader.upload(
                        stream,
                        folder=folder,
                        resource_type="image",
                    )
                    return idx, resultado, None
                except Exception as e:
                    ultimo_error = str(e)
                    if intento == 0:
                        time.sleep(0.35)
            return idx, None, ultimo_error

        max_workers = min(4, len(indices_validos)) if indices_validos else 1
        if indices_validos:
            with ThreadPoolExecutor(max_workers=max_workers) as executor:
                futures = [executor.submit(_upload_cloudinary, idx, archivo) for idx, archivo in indices_validos]
                for fut in as_completed(futures):
                    idx, resultado, err = fut.result()
                    if resultado:
                        resultados_por_idx[idx] = resultado
                    else:
                        print(f"Error subiendo a Cloudinary (idx={idx}): {err}")

        # Manejo mejorado de errores: informar imágenes fallidas y evitar agregar si todas fallan
        fallos_upload = []
        for idx, archivo in indices_validos:
            if idx not in resultados_por_idx:
                fallos_upload.append(archivo.filename)

        if indices_validos and not resultados_por_idx:
            db.session.rollback()
            return jsonify({
                "error": "No se pudieron subir las fotos a Cloudinary. Intenta nuevamente.",
                "fallos": fallos_upload
            }), 502

        for idx in sorted(resultados_por_idx.keys()):
            resultado = resultados_por_idx[idx]
            foto = Foto(
                filename=resultado["secure_url"],
                public_id=resultado["public_id"],
                cantidad=cantidades_lista[idx] if idx < len(cantidades_lista) else 1,
                expires_at=expires_at_for_new_images,
                exclude_auto_delete=False,
                cliente_id=existe.id,
            )
            db.session.add(foto)
            fotos_guardadas.append(resultado["secure_url"])
            thumbnails_guardadas.append(
                _thumbnail_url(resultado.get("public_id"), resultado.get("secure_url", ""))  # fallback seguro
            )
            cantidades_guardadas.append(cantidades_lista[idx] if idx < len(cantidades_lista) else 1)

        # Añadir fotos que ya fueron subidas en segundo plano
        if isinstance(fotos_precargadas, list):
            for pre in fotos_precargadas:
                if not isinstance(pre, dict) or 'secure_url' not in pre or 'public_id' not in pre:
                    continue
                try:
                    cant_foto = max(1, int(pre.get('cantidad', 1) or 1))
                except (TypeError, ValueError):
                    cant_foto = 1
                foto = Foto(
                    filename=pre['secure_url'],
                    public_id=pre['public_id'],
                    cantidad=cant_foto,
                    expires_at=expires_at_for_new_images,
                    exclude_auto_delete=False,
                    cliente_id=existe.id,
                )
                db.session.add(foto)
                fotos_guardadas.append(pre['secure_url'])
                thumbnails_guardadas.append(_thumbnail_url(pre['public_id'], pre['secure_url']))
                cantidades_guardadas.append(cant_foto)

        if not fotos_guardadas:
            db.session.rollback()
            return jsonify({
                "error": "No se pudo guardar ninguna foto. Intenta nuevamente.",
                "fallos": fallos_upload
            }), 502

        db.session.commit()
        _emit_realtime_event(
            "order_updated",
            order_id=existe.id,
            source="append_existing",
            num_fotos=len(fotos_guardadas),
        )
        # Calcular total de copias sumando cantidades de todas las fotos del cliente
        total_copias = sum(f.cantidad or 1 for f in existe.fotos)
        estado_normalizado = _normalizar_estado_pedido(existe.estado)
        cliente_payload = {
            "id": existe.id,
            "nombre": existe.nombre,
            "apellido": existe.apellido,
            "correo": existe.correo,
            "telefono": existe.telefono,
            "fechaRegistro": existe.fecha_registro,
            "tamano": existe.tamano,
            "papel": existe.papel,
            "estado": estado_normalizado,
            "cancelledAt": existe.cancelled_at.isoformat() if existe.cancelled_at else None,
            "pagado": bool(existe.pagado),
            "numFotos": len(fotos_guardadas),
            "fotos": fotos_guardadas,
            "thumbnails": thumbnails_guardadas,
            "precioTotal": calcular_precio_total(
                existe.tamano_keys, total_copias, existe.tamano)
        }
        enrich_order_age_payload(
            cliente_payload,
            fecha_registro=existe.fecha_registro,
            estado=estado_normalizado,
            created_at=existe.created_at,
            cancelled_at=existe.cancelled_at,
        )
        respuesta = {
            "mensaje": "Fotos agregadas al pedido existente" if not fallos_upload else "Algunas imágenes no se pudieron agregar.",
            "operacion": "append_existing",
            "cliente": cliente_payload,
            "pedidoActivo": {
                "id": existe.id,
                "modo": "append_existing",
            },
            "fallos": fallos_upload if fallos_upload else None
        }
        return jsonify(respuesta), 200

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
    try:
        db.session.flush()  # Obtener el ID antes de guardar fotos
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            "error": "No se pudo crear un nuevo pedido con ese correo porque la base de datos mantiene una restriccion unica. Ejecuta la migracion para permitir multiples pedidos por correo.",
            "codigo": "correo_unique_constraint",
        }), 409

    # Subir fotos a Cloudinary
    fotos_guardadas = []
    thumbnails_guardadas = []
    cantidades_guardadas = []
    folder = f"image_manager/cliente_{nuevo_cliente.id}"

    indices_validos = [
        (idx, archivo)
        for idx, archivo in enumerate(archivos)
        if archivo and archivo.filename and allowed_file(archivo.filename)
    ]

    resultados_por_idx = {}

    def _upload_cloudinary(idx, archivo):
        ultimo_error = None
        for intento in range(2):
            try:
                try:
                    archivo.stream.seek(0)
                except Exception:
                    pass

                data = archivo.stream.read()
                stream = io.BytesIO(data)
                stream.name = archivo.filename

                resultado = cloudinary.uploader.upload(
                    stream,
                    folder=folder,
                    resource_type="image",
                )
                return idx, resultado, None
            except Exception as e:
                ultimo_error = str(e)
                if intento == 0:
                    time.sleep(0.35)
        return idx, None, ultimo_error

    max_workers = min(4, len(indices_validos)) if indices_validos else 1
    if indices_validos:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(_upload_cloudinary, idx, archivo) for idx, archivo in indices_validos]
            for fut in as_completed(futures):
                idx, resultado, err = fut.result()
                if resultado:
                    resultados_por_idx[idx] = resultado
                else:
                    print(f"Error subiendo a Cloudinary (idx={idx}): {err}")

    # Manejo mejorado de errores: informar imágenes fallidas y evitar pedidos incompletos
    fallos_upload = []
    for idx, archivo in indices_validos:
        if idx not in resultados_por_idx:
            fallos_upload.append(archivo.filename)

    if indices_validos and not resultados_por_idx:
        # Todas fallaron, no crear pedido
        db.session.rollback()
        return jsonify({
            "error": "No se pudieron subir las fotos a Cloudinary. Intenta nuevamente.",
            "fallos": fallos_upload
        }), 502

    # Si algunas subieron y otras no, informar detalle
    for idx in sorted(resultados_por_idx.keys()):
        resultado = resultados_por_idx[idx]
        url_segura = resultado["secure_url"]
        public_id = resultado["public_id"]
        cant_foto = cantidades_lista[idx] if idx < len(cantidades_lista) else 1

        foto = Foto(
            filename=url_segura,
            public_id=public_id,
            cantidad=cant_foto,
            expires_at=expires_at_for_new_images,
            exclude_auto_delete=False,
            cliente_id=nuevo_cliente.id,
        )
        db.session.add(foto)
        fotos_guardadas.append(url_segura)
        thumbnails_guardadas.append(_thumbnail_url(public_id, url_segura))
        cantidades_guardadas.append(cant_foto)

    # Añadir las fotos que ya fueron subidas en segundo plano
    if isinstance(fotos_precargadas, list):
        start_idx = len(resultados_por_idx)
        for pre in fotos_precargadas:
            if not isinstance(pre, dict) or 'secure_url' not in pre or 'public_id' not in pre:
                continue
            cant_foto = pre.get('cantidad', 1)
            # si en JS usamos cantidades_raw, asimilamos eso; si no, cantidad viaja en el obj
            foto = Foto(
                filename=pre['secure_url'],
                public_id=pre['public_id'],
                cantidad=cant_foto,
                expires_at=expires_at_for_new_images,
                exclude_auto_delete=False,
                cliente_id=nuevo_cliente.id,
            )
            db.session.add(foto)
            fotos_guardadas.append(pre['secure_url'])
            thumbnails_guardadas.append(_thumbnail_url(pre['public_id'], pre['secure_url']))
            cantidades_guardadas.append(cant_foto)

    if not fotos_guardadas:
        db.session.rollback()
        return jsonify({
            "error": "No se pudo guardar ninguna foto. Intenta nuevamente.",
            "fallos": fallos_upload
        }), 502

    db.session.commit()
    _emit_realtime_event(
        "new_order",
        order_id=nuevo_cliente.id,
        estado=_normalizar_estado_pedido(nuevo_cliente.estado),
        pagado=bool(nuevo_cliente.pagado),
        num_fotos=len(fotos_guardadas),
    )
    total_copias = sum(cantidades_guardadas) if cantidades_guardadas else len(fotos_guardadas)
    estado_normalizado = _normalizar_estado_pedido(nuevo_cliente.estado)
    cliente_payload = {
        "id": nuevo_cliente.id,
        "nombre": nuevo_cliente.nombre,
        "apellido": nuevo_cliente.apellido,
        "correo": nuevo_cliente.correo,
        "telefono": nuevo_cliente.telefono,
        "fechaRegistro": nuevo_cliente.fecha_registro,
        "tamano": nuevo_cliente.tamano,
        "papel": nuevo_cliente.papel,
        "estado": estado_normalizado,
        "cancelledAt": nuevo_cliente.cancelled_at.isoformat() if nuevo_cliente.cancelled_at else None,
        "pagado": bool(nuevo_cliente.pagado),
        "numFotos": len(fotos_guardadas),
        "fotos": fotos_guardadas,
        "thumbnails": thumbnails_guardadas,
        "precioTotal": calcular_precio_total(
            nuevo_cliente.tamano_keys, total_copias,
            nuevo_cliente.tamano)
    }
    enrich_order_age_payload(
        cliente_payload,
        fecha_registro=nuevo_cliente.fecha_registro,
        estado=estado_normalizado,
        created_at=nuevo_cliente.created_at,
        cancelled_at=nuevo_cliente.cancelled_at,
    )

    respuesta = {
        "mensaje": "Pedido guardado correctamente" if not fallos_upload else "Pedido guardado parcialmente. Algunas imágenes fallaron.",
        "operacion": "create_new",
        "cliente": cliente_payload,
        "pedidoActivo": {
            "id": nuevo_cliente.id,
            "modo": "create_new",
        },
        "fallos": fallos_upload if fallos_upload else None
    }
    return jsonify(respuesta), 201

@app.route('/api/clientes', methods=['GET'])
@login_required
@role_required('admin', 'operador', 'cajero')
def obtener_clientes():
    clientes = Cliente.query.order_by(Cliente.id.desc()).all()
    respuesta = []
    for c in clientes:
        estado_normalizado = _normalizar_estado_pedido(c.estado)
        payload_cliente = {
            "id": c.id,
            "nombre": c.nombre,
            "apellido": c.apellido,
            "correo": c.correo,
            "telefono": c.telefono,
            "fechaRegistro": c.fecha_registro,
            "tamano": c.tamano or "",
            "papel": c.papel or "",
            "estado": estado_normalizado,
            "cancelledAt": c.cancelled_at.isoformat() if c.cancelled_at else None,
            "pagado": bool(c.pagado),
            "numFotos": len(c.fotos),
            "totalCopias": sum(f.cantidad or 1 for f in c.fotos),
            "fotos": [f.filename for f in c.fotos],
            "cantidades": [f.cantidad or 1 for f in c.fotos],
            "thumbnails": [_thumbnail_url(f.public_id, f.filename) for f in c.fotos],
            "precioTotal": calcular_precio_total(
                c.tamano_keys, sum(f.cantidad or 1 for f in c.fotos), c.tamano)
        }
        enrich_order_age_payload(
            payload_cliente,
            fecha_registro=c.fecha_registro,
            estado=estado_normalizado,
            created_at=c.created_at,
            cancelled_at=c.cancelled_at,
        )
        respuesta.append(payload_cliente)

    return jsonify(respuesta), 200


@app.route('/api/realtime/pedidos/stream', methods=['GET'])
@login_required
@role_required('admin', 'operador', 'cajero')
def realtime_pedidos_stream():
    last_event_id_raw = request.headers.get("Last-Event-ID") or request.args.get("lastEventId") or "0"
    try:
        last_event_id = int(str(last_event_id_raw).strip())
    except (TypeError, ValueError):
        last_event_id = 0

    role = current_user_role() or "desconocido"

    @stream_with_context
    def _stream():
        heartbeat_seconds = max(10, int(REALTIME_SSE_HEARTBEAT_SECONDS))
        seen_seq = max(0, int(last_event_id))

        yield _format_sse_event(
            "connected",
            {
                "event": "connected",
                "role": role,
                "timestamp": _utc_iso_now(),
            },
            event_id=seen_seq,
            retry_ms=REALTIME_SSE_RETRY_MS,
        )

        if seen_seq <= 0:
            yield _format_sse_event(
                "sync_needed",
                {
                    "event": "sync_needed",
                    "reason": "initial_sync",
                    "timestamp": _utc_iso_now(),
                },
            )

        while True:
            snapshot = None

            with _realtime_event_condition:
                snapshot = _snapshot_realtime_events_since(seen_seq)
                if not snapshot["events"] and not snapshot["gap"]:
                    _realtime_event_condition.wait(timeout=heartbeat_seconds)
                    snapshot = _snapshot_realtime_events_since(seen_seq)

            if snapshot["gap"]:
                seen_seq = int(snapshot["latest_seq"])
                yield _format_sse_event(
                    "sync_needed",
                    {
                        "event": "sync_needed",
                        "reason": "replay_gap",
                        "oldest_available_seq": int(snapshot["oldest_seq"]),
                        "latest_available_seq": int(snapshot["latest_seq"]),
                        "timestamp": _utc_iso_now(),
                    },
                    event_id=seen_seq,
                )
                continue

            events = snapshot["events"] if snapshot else []
            if not events:
                yield ": keep-alive\n\n"
                continue

            for item in events:
                ev_seq = int(item.get("seq", seen_seq))
                ev_name = str(item.get("event") or "sync_needed")
                ev_payload = dict(item.get("payload") or {})
                seen_seq = ev_seq
                yield _format_sse_event(ev_name, ev_payload, event_id=ev_seq)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return Response(_stream(), headers=headers)

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
    _emit_realtime_event("order_deleted", order_id=id)
    return jsonify({"mensaje": "Cliente eliminado correctamente"}), 200


@app.route('/api/clientes/<int:id>/estado', methods=['PATCH'])
@login_required
@role_required('admin', 'operador')
def actualizar_estado_cliente(id):
    cliente = db.session.get(Cliente, id)
    if not cliente:
        return jsonify({"error": "Cliente no encontrado"}), 404

    data = request.get_json() or {}
    estado = _normalizar_estado_pedido(data.get('estado'))

    if estado not in ESTADOS_PEDIDO_VALIDOS:
        return jsonify({"error": "Estado invalido"}), 400

    estado_anterior = _normalizar_estado_pedido(cliente.estado, default='')
    if estado == 'cancelado':
        if estado_anterior != 'cancelado' or cliente.cancelled_at is None:
            cliente.cancelled_at = datetime.now(timezone.utc)
    elif estado_anterior == 'cancelado':
        cliente.cancelled_at = None

    cliente.estado = estado
    db.session.commit()
    _emit_realtime_event(
        "status_changed",
        order_id=cliente.id,
        estado=_normalizar_estado_pedido(cliente.estado),
        cancelled=bool(cliente.cancelled_at),
    )
    return jsonify({
        "mensaje": "Estado actualizado",
        "estado": _normalizar_estado_pedido(cliente.estado),
        "cancelledAt": cliente.cancelled_at.isoformat() if cliente.cancelled_at else None,
    }), 200


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
    cliente.estado = _normalizar_estado_pedido(cliente.estado)
    # Si se marca como pagado, cambiar estado a "procesando"
    if cliente.pagado:
        cliente.estado = 'procesando'
    db.session.commit()
    _emit_realtime_event(
        "payment_confirmed" if bool(cliente.pagado) else "payment_reverted",
        order_id=cliente.id,
        pagado=bool(cliente.pagado),
        estado=_normalizar_estado_pedido(cliente.estado),
    )
    return jsonify({
        "mensaje": "Pago actualizado",
        "pagado": bool(cliente.pagado),
        "estado": _normalizar_estado_pedido(cliente.estado),
    }), 200

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


def _catalogo_marcos_version():
    row = db.session.query(db.func.max(MarcoDiseno.updated_at)).scalar()
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
    """
    Aplica descuentos escalonados según la clave y cantidad.
    Si no hay descuento, retorna el precio_unitario original.
    """
    pu = precio_unitario
    try:
        cantidad = int(cantidad)
    except (TypeError, ValueError):
        return pu

    # Descuentos para 10x15
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
    # Descuentos para 15x15
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
    # Aquí puedes agregar más reglas de descuento para otros tamaños
    # elif clave == "otro_tamano":
    #     ...

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


def _nombre_tamano_por_clave(clave):
    t = FotoTamano.query.filter_by(clave=clave).first()
    if t and t.nombre:
        return t.nombre
    return clave


def _detalle_pedido(tamano_keys_str, tamano_texto, cantidad_total):
    detalle = []
    tokens = [k.strip() for k in str(tamano_keys_str or "").split(',') if k.strip()]

    if tokens and any(':' in token for token in tokens):
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
            detalle.append({
                "clave": clave,
                "nombre": _nombre_tamano_por_clave(clave),
                "cantidad": cantidad_clave,
                "precio_unitario": round(pu, 2),
                "subtotal": round(pu * cantidad_clave, 2),
            })
        return detalle

    claves = []
    if tokens:
        claves = tokens
    elif tamano_texto:
        claves = _extraer_claves_desde_texto(tamano_texto)

    for clave in claves:
        precio_base = _precio_base_tamano(clave)
        if precio_base is None:
            continue
        pu = _aplicar_descuentos(clave, cantidad_total, precio_base)
        detalle.append({
            "clave": clave,
            "nombre": _nombre_tamano_por_clave(clave),
            "cantidad": cantidad_total,
            "precio_unitario": round(pu, 2),
            "subtotal": round(pu * cantidad_total, 2),
        })

    return detalle


@app.route('/api/seguimiento/<int:cliente_id>', methods=['GET'])
def api_seguimiento_cliente(cliente_id):
    correo = (request.args.get('correo') or '').strip().lower()
    if not correo:
        return jsonify({"error": "correo requerido"}), 400

    cliente = db.session.get(Cliente, cliente_id)
    if not cliente:
        return jsonify({"error": "Pedido no encontrado"}), 404

    if (cliente.correo or '').strip().lower() != correo:
        return jsonify({"error": "Datos de verificacion invalidos"}), 403

    total_copias = sum(f.cantidad or 1 for f in cliente.fotos)
    detalle = _detalle_pedido(cliente.tamano_keys, cliente.tamano, total_copias)
    total = calcular_precio_total(cliente.tamano_keys, total_copias, cliente.tamano)

    estado_normalizado = _normalizar_estado_pedido(cliente.estado)
    pedido_payload = {
        "id": cliente.id,
        "nombre": cliente.nombre,
        "apellido": cliente.apellido,
        "correo": cliente.correo,
        "telefono": cliente.telefono,
        "fechaRegistro": cliente.fecha_registro,
        "estado": estado_normalizado,
        "cancelledAt": cliente.cancelled_at.isoformat() if cliente.cancelled_at else None,
        "pagado": bool(cliente.pagado),
        "papel": cliente.papel or "No especificado",
        "numFotos": len(cliente.fotos),
        "totalCopias": total_copias,
        "detalle": detalle,
        "total": round(total, 2),
    }
    enrich_order_age_payload(
        pedido_payload,
        fecha_registro=cliente.fecha_registro,
        estado=estado_normalizado,
        created_at=cliente.created_at,
        cancelled_at=cliente.cancelled_at,
    )

    return jsonify({"pedido": pedido_payload}), 200


@app.route('/api/mis-pedidos', methods=['POST'])
def api_mis_pedidos():
    """
    Endpoint para obtener todos los pedidos de un usuario por su correo.
    Requiere verificación de correo para seguridad.
    """
    data = request.get_json() or {}
    correo = (data.get('correo') or '').strip().lower()
    
    if not correo:
        return jsonify({"error": "Correo electronico requerido"}), 400
    
    if not re.match(r'^[^\s@]+@[^\s@]+\.[^\s@]+$', correo):
        return jsonify({"error": "Formato de correo invalido"}), 400
    
    # Buscar todos los pedidos del correo
    pedidos = Cliente.query.filter(
        db.func.lower(Cliente.correo) == correo
    ).order_by(Cliente.id.desc()).all()
    
    if not pedidos:
        return jsonify({
            "pedidos": [],
            "mensaje": "No se encontraron pedidos para este correo"
        }), 200
    
    resultado = []
    for pedido in pedidos:
        total_copias_pedido = sum(f.cantidad or 1 for f in pedido.fotos)
        detalle = _detalle_pedido(pedido.tamano_keys, pedido.tamano, total_copias_pedido)
        total = calcular_precio_total(pedido.tamano_keys, total_copias_pedido, pedido.tamano)
        estado_normalizado = _normalizar_estado_pedido(pedido.estado)

        pedido_payload = {
            "id": pedido.id,
            "nombre": pedido.nombre,
            "apellido": pedido.apellido,
            "correo": pedido.correo,
            "telefono": pedido.telefono,
            "fechaRegistro": pedido.fecha_registro,
            "estado": estado_normalizado,
            "cancelledAt": pedido.cancelled_at.isoformat() if pedido.cancelled_at else None,
            "pagado": bool(pedido.pagado),
            "papel": pedido.papel or "No especificado",
            "numFotos": len(pedido.fotos),
            "totalCopias": total_copias_pedido,
            "detalle": detalle,
            "total": round(total, 2),
        }
        enrich_order_age_payload(
            pedido_payload,
            fecha_registro=pedido.fecha_registro,
            estado=estado_normalizado,
            created_at=pedido.created_at,
            cancelled_at=pedido.cancelled_at,
        )
        resultado.append(pedido_payload)
    
    return jsonify({
        "pedidos": resultado,
        "total": len(resultado)
    }), 200


@app.route('/mis-pedidos')
def mis_pedidos_page():
    """Página para ver todos los pedidos del usuario."""
    return render_template('mis_pedidos.html')


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
        return jsonify({"error": "precio_base debe ser numÃ©rico"}), 400

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
        return jsonify({"error": "TamaÃ±o no encontrado"}), 404

    data = request.get_json() or {}

    if "clave" in data:
        nueva_clave = (data.get("clave") or "").strip().lower()
        if not nueva_clave:
            return jsonify({"error": "clave invÃ¡lida"}), 400
        existe = FotoTamano.query.filter(FotoTamano.clave == nueva_clave, FotoTamano.id != tamano_id).first()
        if existe:
            return jsonify({"error": "La clave ya existe"}), 409
        t.clave = nueva_clave

    if "nombre" in data:
        nuevo_nombre = (data.get("nombre") or "").strip()
        if not nuevo_nombre:
            return jsonify({"error": "nombre invÃ¡lido"}), 400
        t.nombre = nuevo_nombre

    if "precio_base" in data:
        try:
            nuevo_precio = float(data.get("precio_base"))
        except (TypeError, ValueError):
            return jsonify({"error": "precio_base debe ser numÃ©rico"}), 400
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
        return jsonify({"error": "TamaÃ±o no encontrado"}), 404

    t.activo = False
    db.session.commit()
    return jsonify({"tamano": _tamano_to_dict(t), "version": _catalogo_version()}), 200


@app.route('/api/marcos', methods=['GET'])
def obtener_marcos_publicos():
    marcos = MarcoDiseno.query.filter_by(activo=True).order_by(MarcoDiseno.id.desc()).all()
    response = jsonify({
        "version": _catalogo_marcos_version(),
        "marcos": [_marco_to_dict(m) for m in marcos],
    })
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response, 200


@app.route('/api/admin/marcos', methods=['GET'])
@login_required
@role_required('admin')
def admin_listar_marcos():
    marcos = MarcoDiseno.query.order_by(MarcoDiseno.id.desc()).all()
    return jsonify({
        "version": _catalogo_marcos_version(),
        "marcos": [_marco_to_dict(m) for m in marcos],
    }), 200


@app.route('/api/admin/marcos', methods=['POST'])
@login_required
@role_required('admin')
def admin_crear_marco():
    nombre = (request.form.get('nombre') or '').strip()
    archivos = [a for a in (request.files.getlist('imagen') or []) if a and getattr(a, 'filename', '')]
    if not archivos:
        archivo_unico = request.files.get('imagen')
        if archivo_unico and archivo_unico.filename:
            archivos = [archivo_unico]

    estado_raw = (request.form.get('activo') or 'true').strip().lower()
    activo = estado_raw in {'true', '1', 'on', 'si', 'sÃ­'}

    if not nombre:
        return jsonify({"error": "El nombre del diseÃ±o es requerido"}), 400

    if not archivos:
        return jsonify({"error": "Debes subir al menos una imagen de marco"}), 400

    errores_archivos = []
    for archivo in archivos:
        if not allowed_frame_file(archivo):
            errores_archivos.append(str(archivo.filename or 'archivo'))

    if errores_archivos:
        top = ', '.join(errores_archivos[:3])
        extra = f" y {len(errores_archivos) - 3} mas" if len(errores_archivos) > 3 else ''
        return jsonify({"error": f"Formato no permitido en: {top}{extra}. Usa PNG o SVG."}), 400

    marcos_creados = []
    for idx, archivo in enumerate(archivos):
        nombre_base = os.path.splitext(str(archivo.filename or '').strip())[0].replace('_', ' ').strip()
        nombre_resuelto = nombre if len(archivos) == 1 else (nombre_base or f"{nombre} {idx + 1}")

        try:
            resultado = cloudinary.uploader.upload(
                archivo,
                folder="image_manager/frames",
                resource_type="image",
                use_filename=False,
                unique_filename=True,
                overwrite=False,
            )
        except Exception as e:
            print(f"Error subiendo marco a Cloudinary: {e}")
            db.session.rollback()
            return jsonify({"error": "No se pudo subir uno de los marcos. Intenta de nuevo"}), 500

        imagen_url = resultado.get("secure_url") or ""
        if not imagen_url:
            db.session.rollback()
            return jsonify({"error": "Cloudinary no devolvio una URL valida"}), 500

        marco = MarcoDiseno(nombre=nombre_resuelto, imagen_url=imagen_url, activo=activo)
        db.session.add(marco)
        marcos_creados.append(marco)

    db.session.commit()

    return jsonify({
        "marco": _marco_to_dict(marcos_creados[0]),
        "marcos": [_marco_to_dict(m) for m in marcos_creados],
        "total": len(marcos_creados),
        "version": _catalogo_marcos_version(),
    }), 201


@app.route('/api/admin/marcos/<int:marco_id>/estado', methods=['PATCH'])
@login_required
@role_required('admin')
def admin_actualizar_estado_marco(marco_id):
    marco = db.session.get(MarcoDiseno, marco_id)
    if not marco:
        return jsonify({"error": "Marco no encontrado"}), 404

    data = request.get_json() or {}
    if 'activo' not in data:
        return jsonify({"error": "Campo activo requerido"}), 400

    marco.activo = bool(data.get('activo'))
    db.session.commit()

    return jsonify({
        "marco": _marco_to_dict(marco),
        "version": _catalogo_marcos_version(),
    }), 200


@app.route('/api/admin/storage-settings', methods=['GET'])
@login_required
@role_required('admin')
def admin_storage_settings_get():
    settings = _get_or_create_image_storage_settings()
    now_utc = datetime.now(timezone.utc)

    total_imagenes = Foto.query.count()
    excluidas = Foto.query.filter(Foto.exclude_auto_delete.is_(True)).count()
    sin_expiracion = Foto.query.filter(Foto.expires_at.is_(None)).count()
    vencidas = Foto.query.filter(
        Foto.exclude_auto_delete.is_(False),
        Foto.expires_at.isnot(None),
        Foto.expires_at <= now_utc,
    ).count()

    return jsonify({
        "config": _storage_settings_to_dict(settings),
        "resumen": {
            "totalImagenes": total_imagenes,
            "excluidas": excluidas,
            "sinExpiracion": sin_expiracion,
            "vencidas": vencidas,
        },
        "reglas": {
            "aplicaNuevasImagenes": True,
            "aplicaExistentesSoloSiSeSolicita": True,
        },
    }), 200


@app.route('/api/admin/storage-settings', methods=['PUT'])
@login_required
@role_required('admin')
def admin_storage_settings_update():
    settings = _get_or_create_image_storage_settings()
    data = request.get_json(silent=True) or {}

    mode_raw = str(data.get("retention_mode", data.get("retentionMode", settings.retention_mode)) or "").strip().lower()
    if mode_raw not in IMAGE_STORAGE_RETENTION_PRESETS:
        return jsonify({"error": "retention_mode invalido. Usa 1d, 7d, 30d o custom."}), 400

    if mode_raw == "custom":
        retention_days = _clamp_retention_days(
            data.get("retention_days", data.get("retentionDays", settings.retention_days)),
            settings.retention_days,
        )
    else:
        retention_days = int(IMAGE_STORAGE_RETENTION_PRESETS[mode_raw])

    cleanup_minutes = _clamp_cleanup_interval_minutes(
        data.get("cleanup_interval_minutes", data.get("cleanupIntervalMinutes", settings.cleanup_interval_minutes)),
        settings.cleanup_interval_minutes,
    )

    apply_existing_raw = data.get("apply_existing", data.get("applyExisting", False))
    apply_existing = str(apply_existing_raw).strip().lower() in {"1", "true", "yes", "si", "sí", "on"}

    settings.retention_mode = _normalize_retention_mode(mode_raw, retention_days)
    settings.retention_days = retention_days
    settings.cleanup_interval_minutes = cleanup_minutes

    updated_existing = 0
    if apply_existing:
        nueva_expiracion = _expiration_for_new_image(retention_days)
        updated_existing = (
            Foto.query
            .filter(Foto.exclude_auto_delete.is_(False))
            .update({Foto.expires_at: nueva_expiracion}, synchronize_session=False)
        )

    db.session.commit()

    return jsonify({
        "ok": True,
        "config": _storage_settings_to_dict(settings),
        "updatedExisting": int(updated_existing or 0),
        "message": (
            f"Configuracion guardada. La expiracion para imagenes nuevas es de {retention_days} dia(s)."
            if not apply_existing else
            f"Configuracion guardada y aplicada a {int(updated_existing or 0)} imagen(es) existente(s)."
        ),
    }), 200


@app.route('/api/admin/storage-images', methods=['GET'])
@login_required
@role_required('admin')
def admin_storage_images_list():
    try:
        page = int(request.args.get("page", "1"))
    except (TypeError, ValueError):
        page = 1
    page = max(1, page)

    try:
        page_size = int(request.args.get("page_size", request.args.get("pageSize", "10")))
    except (TypeError, ValueError):
        page_size = 10
    page_size = max(1, min(page_size, 50))

    search = str(request.args.get("q", "") or "").strip().lower()
    only_excluded_raw = str(request.args.get("onlyExcluded", "") or "").strip().lower()
    only_excluded = only_excluded_raw in {"1", "true", "yes", "si", "sí", "on"}

    query = db.session.query(Foto, Cliente).join(Cliente, Cliente.id == Foto.cliente_id)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                db.func.lower(Cliente.nombre).like(pattern),
                db.func.lower(Cliente.apellido).like(pattern),
                db.func.lower(Cliente.correo).like(pattern),
            )
        )
    if only_excluded:
        query = query.filter(Foto.exclude_auto_delete.is_(True))

    filtered_total = query.count()
    total_pages = max(1, (filtered_total + page_size - 1) // page_size)
    page = min(page, total_pages)
    offset = (page - 1) * page_size

    rows = (
        query
        .order_by(Foto.expires_at.is_(None).asc(), Foto.expires_at.asc(), Foto.id.desc())
        .offset(offset)
        .limit(page_size)
        .all()
    )

    now_utc = datetime.now(timezone.utc)
    resumen = {
        "totalImagenes": Foto.query.count(),
        "excluidas": Foto.query.filter(Foto.exclude_auto_delete.is_(True)).count(),
        "sinExpiracion": Foto.query.filter(Foto.expires_at.is_(None)).count(),
        "vencidas": Foto.query.filter(
            Foto.exclude_auto_delete.is_(False),
            Foto.expires_at.isnot(None),
            Foto.expires_at <= now_utc,
        ).count(),
    }

    return jsonify({
        "imagenes": [_photo_storage_item_to_dict(foto, cliente) for foto, cliente in rows],
        "resumen": resumen,
        "page": page,
        "pageSize": page_size,
        "total": int(filtered_total),
        "totalPages": int(total_pages),
        "hasNext": page < total_pages,
        "hasPrev": page > 1,
    }), 200


@app.route('/api/admin/storage-images/<int:foto_id>/exclude', methods=['PATCH'])
@login_required
@role_required('admin')
def admin_storage_image_toggle_exclude(foto_id):
    foto = db.session.get(Foto, foto_id)
    if not foto:
        return jsonify({"error": "Imagen no encontrada"}), 404

    data = request.get_json(silent=True) or {}
    if "exclude_auto_delete" not in data and "excludeAutoDelete" not in data:
        return jsonify({"error": "Debes indicar exclude_auto_delete"}), 400

    raw = data.get("exclude_auto_delete", data.get("excludeAutoDelete"))
    exclude = str(raw).strip().lower() in {"1", "true", "yes", "si", "sí", "on"}

    foto.exclude_auto_delete = bool(exclude)
    if not foto.exclude_auto_delete and not foto.expires_at:
        settings = _get_or_create_image_storage_settings()
        foto.expires_at = _expiration_for_new_image(settings.retention_days)

    db.session.commit()
    cliente = db.session.get(Cliente, foto.cliente_id)
    return jsonify({
        "ok": True,
        "imagen": _photo_storage_item_to_dict(foto, cliente),
    }), 200


@app.route('/api/admin/storage-images/cleanup', methods=['POST'])
@login_required
@role_required('admin')
def admin_storage_images_cleanup_now():
    result = _run_expired_images_cleanup_if_due(force=True, trigger="manual_admin")
    status_code = 200 if result.get("ok") else 409
    return jsonify(result), status_code


@app.route('/api/precios', methods=['POST'])
def obtener_precios():
    data = request.get_json() or {}

    tamano = data.get("tamano")
    cantidad = data.get("cantidad")

    try:
        cantidad = int(cantidad)
    except (TypeError, ValueError):
        return jsonify({"error": "cantidad invalida"}), 400

    if not tamano or cantidad <= 0:
        return jsonify({"error": "Datos incompletos"}), 400

    precio_base = _precio_base_tamano(tamano)
    if precio_base is None:
        return jsonify({"error": "TamaÃ±o no valido"}), 400

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
    nombres_dias = ['Lun', 'Mar', 'MiÃ©', 'Jue', 'Vie', 'SÃ¡b', 'Dom']
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
    ultimas_fotos_por_cliente = (
        db.session.query(
            Foto.cliente_id.label("cliente_id"),
            db.func.max(Foto.id).label("ultima_foto_id")
        )
        .group_by(Foto.cliente_id)
        .subquery()
    )

    clientes = (
        Cliente.query
        .join(
            ultimas_fotos_por_cliente,
            ultimas_fotos_por_cliente.c.cliente_id == Cliente.id
        )
        .order_by(ultimas_fotos_por_cliente.c.ultima_foto_id.desc())
        .limit(5)
        .all()
    )

    resultado = []
    for cliente in clientes:
        fotos_cliente = sorted(list(cliente.fotos or []), key=lambda item: item.id or 0)
        urls_fotos = [f.filename for f in fotos_cliente if f.filename]
        if not urls_fotos:
            continue

        foto_ultima = fotos_cliente[-1]
        total_copias_cliente = sum(f.cantidad or 1 for f in fotos_cliente)
        resultado.append({
            "clienteId": cliente.id,
            "fotos": urls_fotos,
            "url": urls_fotos[-1],
            "thumbnail": _thumbnail_url(foto_ultima.public_id, foto_ultima.filename),
            "cliente": f"{cliente.nombre} {cliente.apellido}",
            "fecha": cliente.fecha_registro,
            "numFotos": len(urls_fotos),
            "totalCopias": total_copias_cliente,
        })

    return jsonify(resultado), 200

@app.route('/api/cloudinary-stats', methods=['GET'])
@login_required
@role_required('admin')
def cloudinary_stats():
    """Obtiene estadisticas de uso de Cloudinary, priorizando almacenamiento real."""
    try:
        stats = cloudinary.api.usage()

        def _to_float(value):
            try:
                if value is None:
                    return None
                return float(value)
            except (TypeError, ValueError):
                return None

        def _extract_storage_bytes(payload):
            storage_node = payload.get('storage')
            used = None
            limit = None

            if isinstance(storage_node, dict):
                for key in ('usage', 'used', 'bytes', 'value', 'consumed'):
                    parsed = _to_float(storage_node.get(key))
                    if parsed is not None:
                        used = parsed
                        break
                for key in ('limit', 'max', 'quota'):
                    parsed = _to_float(storage_node.get(key))
                    if parsed is not None:
                        limit = parsed
                        break
            elif storage_node is not None:
                used = _to_float(storage_node)

            if used is None:
                for key in ('storage_usage', 'storage_used', 'storage_bytes', 'storage'):
                    parsed = _to_float(payload.get(key))
                    if parsed is not None:
                        used = parsed
                        break

            if limit is None:
                for key in ('storage_limit', 'storage_quota', 'storage_bytes_limit'):
                    parsed = _to_float(payload.get(key))
                    if parsed is not None:
                        limit = parsed
                        break

            return used, limit

        storage_used_bytes, storage_limit_bytes = _extract_storage_bytes(stats)
        storage_source = 'storage' if storage_used_bytes is not None else 'transformations_fallback'

        return jsonify({
            'bandwidth': stats.get('bandwidth', 0),
            'bandwidth_limit': stats.get('bandwidth_limit', 0),
            'context': stats.get('context', {}),
            'derived_resources': stats.get('derived_resources', 0),
            'derived_resources_limit': stats.get('derived_resources_limit', 0),
            'media_limit': stats.get('media_limit', 0),
            'media_duration': stats.get('media_duration', 0),
            'media_duration_limit': stats.get('media_duration_limit', 0),
            'transformation_count': stats.get('transformation_count', 0),
            'transformation_count_limit': stats.get('transformation_count_limit', 0),
            'requests': stats.get('requests', 0),
            'storage_used_bytes': storage_used_bytes,
            'storage_limit_bytes': storage_limit_bytes,
            'storage_source': storage_source,
        }), 200
    except Exception as e:
        print(f'Error obteniendo stats de Cloudinary: {e}')
        return jsonify({'error': str(e)}), 500
if __name__ == '__main__':
    _debug = os.environ.get('FLASK_DEBUG', '1').lower() in ('1', 'true', 'yes')
    app.run(host='0.0.0.0', port=5000, debug=_debug)





















