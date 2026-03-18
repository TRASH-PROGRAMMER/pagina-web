from functools import wraps

from flask import Blueprint, flash, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

from db import User


auth_bp = Blueprint("auth", __name__)


def _is_api_request() -> bool:
    path = request.path or ""
    accept = request.headers.get("Accept", "")
    return path.startswith("/api/") or "application/json" in accept.lower()


def _unauthorized_response(message: str, status: int):
    if _is_api_request():
        return jsonify({"error": message}), status
    return redirect(url_for("auth.login"))


def current_user_role() -> str | None:
    return session.get("role")


def login_required(view_func):
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return _unauthorized_response("Debes iniciar sesion", 401)
        return view_func(*args, **kwargs)

    return wrapper


def role_required(*allowed_roles):
    def decorator(view_func):
        @wraps(view_func)
        def wrapper(*args, **kwargs):
            if "user_id" not in session:
                return _unauthorized_response("Debes iniciar sesion", 401)

            role = session.get("role")
            if role not in allowed_roles:
                if _is_api_request():
                    return jsonify({"error": "No autorizado para este recurso"}), 403
                return redirect(url_for("auth.redirect_by_role"))

            return view_func(*args, **kwargs)

        return wrapper

    return decorator


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if session.get("user_id"):
        return redirect(url_for("auth.redirect_by_role"))

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


@auth_bp.route("/logout", methods=["GET", "POST"])
def logout():
    session.clear()
    return redirect(url_for("auth.login"))


@auth_bp.route("/me", methods=["GET"])
@login_required
def me():
    return jsonify(
        {
            "user_id": session.get("user_id"),
            "username": session.get("username"),
            "role": session.get("role"),
        }
    ), 200


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
