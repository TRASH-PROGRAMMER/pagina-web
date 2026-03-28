import sys
import os
import json
import re
import time
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock, Thread
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
from werkzeug.exceptions import RequestEntityTooLarge
from sqlalchemy.engine.url import make_url
from db import AuthSession, Cliente, ClienteDraft, Foto, FotoTamano, MarcoDiseno, User, db
from auth import auth_bp, login_required, role_required
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
app.config['MAX_CONTENT_LENGTH'] = 150 * 10 * 1024 * 1024  # 150 fotos Ã— 10 MB
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
FRAME_ALLOWED_EXTENSIONS = {'png', 'svg'}
FRAME_ALLOWED_MIMETYPES = {'image/png', 'image/svg+xml'}
MAX_FILES_PER_ORDER = int(os.environ.get("MAX_FILES_PER_ORDER", "150"))
MAX_IMAGE_BYTES_PER_FILE = int(os.environ.get("MAX_IMAGE_BYTES_PER_FILE", str(10 * 1024 * 1024)))

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
PUBLIC_ID_FROM_URL_REGEX = re.compile(r'^v\d+$')

_last_cancelled_cleanup_run_ts = 0.0
_cancelled_cleanup_lock = Lock()
_last_db_backup_run_ts = 0.0
_db_backup_lock = Lock()
_db_backup_thread_started = False


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


def _validar_archivos_cliente(archivos):
    archivos_limpios = [a for a in (archivos or []) if a and getattr(a, "filename", "")]
    if not archivos_limpios:
        return None, "Debes adjuntar al menos una foto."

    if len(archivos_limpios) > MAX_FILES_PER_ORDER:
        return None, f"Maximo permitido: {MAX_FILES_PER_ORDER} fotos por pedido."

    errores = []
    for archivo in archivos_limpios:
        nombre = str(archivo.filename or "").strip() or "archivo_sin_nombre"

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
    """Genera una miniatura pequeÃ±a de Cloudinary y usa fallback si algo falla."""
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
            "UPDATE clientes SET estado='pendiente' WHERE estado IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET pagado=FALSE WHERE pagado IS NULL"))
        conn.execute(db.text(
            "UPDATE clientes SET cancelled_at=NOW() WHERE estado='cancelado' AND cancelled_at IS NULL"))
        conn.execute(db.text(
            "CREATE INDEX IF NOT EXISTS idx_clientes_estado_cancelled_at ON clientes (estado, cancelled_at)"))
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
    default_users = [
        {
            "username": os.environ.get("ADMIN_USERNAME", "admin"),
            "email": os.environ.get("ADMIN_EMAIL", "admin@imagemanager.local"),
            "password": os.environ.get("ADMIN_PASSWORD", "FUEGOtierra65$admin"),
            "role": "admin",
        },
        {
            "username": os.environ.get("OPERADOR_USERNAME", "operador"),
            "email": os.environ.get("OPERADOR_EMAIL", "operador@imagemanager.local"),
            "password": os.environ.get("OPERADOR_PASSWORD", "Cocolimon3455Â·#"),
            "role": "operador",
        },
        {
            "username": os.environ.get("CAJERO_USERNAME", "cajero"),
            "email": os.environ.get("CAJERO_EMAIL", "cajero@imagemanager.local"),
            "password": os.environ.get("CAJERO_PASSWORD", "dloktrukgr345Â£!3"),
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

    try:
        _run_cancelled_cleanup_if_due(force=True)
    except Exception as e:
        print(f"Error en limpieza inicial de pedidos cancelados: {e}")

    try:
        _run_db_backup_if_due(force=False, trigger="startup")
    except Exception as e:
        print(f"Error en backup inicial de base de datos: {e}")

_start_db_backup_worker()

@app.route('/')
def home():
    return render_template('index.html')


@app.route('/seguimiento')
def seguimiento():
    return render_template('seguimiento.html')

# crea una ruta para la pÃ¡gina de administraciÃ³n
@app.route('/admin')
def admin():
    return render_template('admin.html')
# imprime un mensaje en la consola para indicar que el programa estÃ¡ funcionando
print("El programa estÃ¡ funcionando")
@app.route('/operador')
def operador():
    return render_template('operador.html')


@app.route('/cajero')
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


@app.route('/api/clientes', methods=['POST'])
def crear_clientes():
    # Soporta FormData (con fotos) y JSON (sin fotos)
    if request.content_type and 'multipart/form-data' in request.content_type:
        data = request.form.to_dict()
        archivos, error_archivos = _validar_archivos_cliente(request.files.getlist('fotos'))
        if error_archivos:
            return jsonify({"error": error_archivos}), 400
    else:
        data = request.get_json() or {}
        archivos = []

    # ValidaciÃ³n bÃ¡sica backend
    campos = ['nombre', 'apellido', 'correo', 'telefono', 'fechaRegistro']
    for campo in campos:
        if not data.get(campo):
            return jsonify({"error": f"Campo '{campo}' requerido"}), 400

    if not archivos:
        return jsonify({"error": "Debes adjuntar al menos una foto valida."}), 400

    # Verificar si ya existe el correo â†’ agregar fotos al cliente existente
    existe = Cliente.query.filter_by(correo=data["correo"]).first()
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
                "cancelledAt": existe.cancelled_at.isoformat() if existe.cancelled_at else None,
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
            "cancelledAt": nuevo_cliente.cancelled_at.isoformat() if nuevo_cliente.cancelled_at else None,
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
        "cancelledAt":    c.cancelled_at.isoformat() if c.cancelled_at else None,
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

    estado_anterior = (cliente.estado or '').strip().lower()
    if estado == 'cancelado':
        if estado_anterior != 'cancelado' or cliente.cancelled_at is None:
            cliente.cancelled_at = datetime.now(timezone.utc)
    elif estado_anterior == 'cancelado':
        cliente.cancelled_at = None

    cliente.estado = estado
    db.session.commit()
    return jsonify({
        "mensaje": "Estado actualizado",
        "estado": cliente.estado,
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

    detalle = _detalle_pedido(cliente.tamano_keys, cliente.tamano, len(cliente.fotos))
    total = calcular_precio_total(cliente.tamano_keys, len(cliente.fotos), cliente.tamano)

    return jsonify({
        "pedido": {
            "id": cliente.id,
            "nombre": cliente.nombre,
            "apellido": cliente.apellido,
            "correo": cliente.correo,
            "telefono": cliente.telefono,
            "fechaRegistro": cliente.fecha_registro,
            "estado": cliente.estado or "pendiente",
            "cancelledAt": cliente.cancelled_at.isoformat() if cliente.cancelled_at else None,
            "pagado": bool(cliente.pagado),
            "papel": cliente.papel or "No especificado",
            "numFotos": len(cliente.fotos),
            "detalle": detalle,
            "total": round(total, 2),
        }
    }), 200


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
        detalle = _detalle_pedido(pedido.tamano_keys, pedido.tamano, len(pedido.fotos))
        total = calcular_precio_total(pedido.tamano_keys, len(pedido.fotos), pedido.tamano)
        
        resultado.append({
            "id": pedido.id,
            "nombre": pedido.nombre,
            "apellido": pedido.apellido,
            "correo": pedido.correo,
            "telefono": pedido.telefono,
            "fechaRegistro": pedido.fecha_registro,
            "estado": pedido.estado or "pendiente",
            "cancelledAt": pedido.cancelled_at.isoformat() if pedido.cancelled_at else None,
            "pagado": bool(pedido.pagado),
            "papel": pedido.papel or "No especificado",
            "numFotos": len(pedido.fotos),
            "detalle": detalle,
            "total": round(total, 2),
        })
    
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
    return jsonify({
        "version": _catalogo_marcos_version(),
        "marcos": [_marco_to_dict(m) for m in marcos],
    }), 200


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
    archivo = request.files.get('imagen')
    estado_raw = (request.form.get('activo') or 'true').strip().lower()
    activo = estado_raw in {'true', '1', 'on', 'si', 'sÃ­'}

    if not nombre:
        return jsonify({"error": "El nombre del diseÃ±o es requerido"}), 400

    if not archivo or not archivo.filename:
        return jsonify({"error": "La imagen del marco es requerida"}), 400

    if not allowed_frame_file(archivo):
        return jsonify({"error": "Solo se aceptan archivos PNG o SVG con transparencia"}), 400

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
        return jsonify({"error": "No se pudo subir el marco. Intenta de nuevo"}), 500

    imagen_url = resultado.get("secure_url") or ""
    if not imagen_url:
        return jsonify({"error": "Cloudinary no devolvio una URL valida"}), 500

    marco = MarcoDiseno(nombre=nombre, imagen_url=imagen_url, activo=activo)
    db.session.add(marco)
    db.session.commit()

    return jsonify({
        "marco": _marco_to_dict(marco),
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


@app.route('/api/precios', methods=['POST'])
def obtener_precios():
    data = request.get_json() or {}

    tamano = data.get("tamano")
    cantidad = data.get("cantidad")

    try:
        cantidad = int(cantidad)
    except (TypeError, ValueError):
        return jsonify({"error": "cantidad invÃ¡lida"}), 400

    if not tamano or cantidad <= 0:
        return jsonify({"error": "Datos incompletos"}), 400

    precio_base = _precio_base_tamano(tamano)
    if precio_base is None:
        return jsonify({"error": "TamaÃ±o no vÃ¡lido"}), 400

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
        resultado.append({
            "clienteId": cliente.id,
            "fotos": urls_fotos,
            "url": urls_fotos[-1],
            "thumbnail": _thumbnail_url(foto_ultima.public_id, foto_ultima.filename),
            "cliente": f"{cliente.nombre} {cliente.apellido}",
            "fecha": cliente.fecha_registro,
            "numFotos": len(urls_fotos),
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
    app.run(host='0.0.0.0', port=5000, debug=True)





















