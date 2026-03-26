from functools import wraps
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from flask import Blueprint, flash, g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

from db import AuthSession, User, db


auth_bp = Blueprint("auth", __name__)

TOKEN_TTL_HOURS = 12


def _utcnow():
    return datetime.now(timezone.utc)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _extract_bearer_token() -> str | None:
    auth_header = (request.headers.get("Authorization") or "").strip()
    if not auth_header:
        return None
    if not auth_header.lower().startswith("bearer "):
        return None
    token = auth_header[7:].strip()
    return token or None


def _resolve_auth_context() -> dict | None:
    cached = getattr(g, "_auth_ctx_cached", False)
    if cached:
        return getattr(g, "_auth_ctx", None)

    g._auth_ctx_cached = True
    g._auth_ctx = None

    token = _extract_bearer_token()
    if token:
        token_hash = _hash_token(token)
        now = _utcnow()
        auth_row = AuthSession.query.filter_by(token_hash=token_hash).first()

        if auth_row and auth_row.revoked_at is None and auth_row.expires_at > now:
            user = auth_row.user
            if user and user.activo:
                auth_row.last_seen_at = now
                db.session.commit()
                g._auth_ctx = {
                    "mode": "token",
                    "user_id": user.id,
                    "username": user.username,
                    "role": auth_row.role or user.role,
                    "auth_session_id": auth_row.id,
                }
                return g._auth_ctx

    user_id = session.get("user_id")
    if user_id:
        g._auth_ctx = {
            "mode": "cookie",
            "user_id": user_id,
            "username": session.get("username"),
            "role": session.get("role"),
            "auth_session_id": None,
        }
        return g._auth_ctx

    return None


def _create_tab_token_session(user: User) -> tuple[str, AuthSession]:
    raw_token = secrets.token_urlsafe(48)
    now = _utcnow()
    row = AuthSession(
        user_id=user.id,
        role=user.role,
        token_hash=_hash_token(raw_token),
        token_hint=raw_token[:8],
        user_agent=(request.headers.get("User-Agent") or "")[:255],
        ip_addr=(request.headers.get("X-Forwarded-For") or request.remote_addr or "")[:64],
        last_seen_at=now,
        expires_at=now + timedelta(hours=TOKEN_TTL_HOURS),
        revoked_at=None,
    )
    db.session.add(row)
    db.session.commit()
    return raw_token, row


def _is_api_request() -> bool:
    path = request.path or ""
    accept = request.headers.get("Accept", "")
    return path.startswith("/api/") or "application/json" in accept.lower()


def _unauthorized_response(message: str, status: int):
    if _is_api_request():
        return jsonify({"error": message}), status
    return redirect(url_for("auth.login"))


def current_user_role() -> str | None:
    ctx = _resolve_auth_context()
    return ctx.get("role") if ctx else None


def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if not _resolve_auth_context():
            return _unauthorized_response("Debes iniciar sesion", 401)
        return view_func(*args, **kwargs)

    return wrapper


def role_required(*allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(*args, **kwargs):
            ctx = _resolve_auth_context()
            if not ctx:
                return _unauthorized_response("Debes iniciar sesion", 401)

            role = ctx.get("role")
            if role not in allowed_roles:
                if _is_api_request():
                    return jsonify({"error": "No autorizado para este recurso"}), 403
                return redirect(url_for("auth.redirect_by_role"))

            return view_func(*args, **kwargs)

        return wrapper

    return decorator


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if not username or not password:
            flash("Ingresa usuario y contrasena", "error")
            return render_template("login.html"), 400

        user = User.query.filter_by(username=username).first()
        if not user or not user.activo or not check_password_hash(user.password_hash, password):
            flash("Credenciales invalidas", "error")
            return render_template("login.html"), 401

        session.clear()
        session["user_id"] = user.id
        session["username"] = user.username
        session["role"] = user.role

        return redirect(url_for("auth.redirect_by_role"))

    return render_template("login.html")


@auth_bp.route("/api/auth/login", methods=["POST"])
def api_login_tab_scoped():
    data = request.get_json(silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Ingresa usuario y contrasena"}), 400

    user = User.query.filter_by(username=username).first()
    if not user or not user.activo or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Credenciales invalidas"}), 401

    token, auth_row = _create_tab_token_session(user)

    redirect_path = "/admin"
    if user.role == "operador":
        redirect_path = "/operador"
    elif user.role == "cajero":
        redirect_path = "/cajero"

    return jsonify(
        {
            "token": token,
            "expires_at": auth_row.expires_at.isoformat(),
            "user": {
                "id": user.id,
                "username": user.username,
                "role": user.role,
            },
            "redirect": redirect_path,
        }
    ), 200


@auth_bp.route("/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    return redirect(url_for("auth.login"))


@auth_bp.route("/api/auth/logout", methods=["POST"])
@login_required
def api_logout_tab_scoped():
    ctx = _resolve_auth_context() or {}
    if ctx.get("mode") == "token" and ctx.get("auth_session_id"):
        row = db.session.get(AuthSession, ctx.get("auth_session_id"))
        if row and row.revoked_at is None:
            row.revoked_at = _utcnow()
            db.session.commit()
    else:
        session.clear()

    return jsonify({"ok": True}), 200


@auth_bp.route("/api/auth/logout-all", methods=["POST"])
@login_required
def api_logout_all_sessions():
    ctx = _resolve_auth_context() or {}
    user_id = ctx.get("user_id")
    if not user_id:
        return jsonify({"error": "No autenticado"}), 401

    now = _utcnow()
    rows = AuthSession.query.filter(
        AuthSession.user_id == user_id,
        AuthSession.revoked_at.is_(None),
    ).all()
    for row in rows:
        row.revoked_at = now

    session.clear()
    db.session.commit()
    return jsonify({"ok": True, "revocadas": len(rows)}), 200


@auth_bp.route("/me", methods=["GET"])
@login_required
def me():
    ctx = _resolve_auth_context() or {}
    return jsonify(
        {
            "user_id": ctx.get("user_id"),
            "username": ctx.get("username"),
            "role": ctx.get("role"),
            "auth_mode": ctx.get("mode"),
        }
    ), 200


@auth_bp.route("/api/auth/me", methods=["GET"])
@login_required
def api_me():
    return me()


@auth_bp.route("/redirect", methods=["GET"])
@login_required
def redirect_by_role():
    role = current_user_role()
    if role == "admin":
        return redirect(url_for("admin"))
    if role == "operador":
        return redirect(url_for("operador"))
    if role == "cajero":
        return redirect(url_for("cajero"))
    return redirect(url_for("auth.logout"))
