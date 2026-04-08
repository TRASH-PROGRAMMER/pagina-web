from datetime import datetime, timezone

from flask import Blueprint, jsonify

try:
    from auth import login_required, role_required
    from db import Cliente
except ImportError:
    from .auth import login_required, role_required
    from .db import Cliente


order_age_bp = Blueprint("order_age", __name__)

ORDER_AGE_MONTH_DAYS = 30
ORDER_AGE_YEAR_DAYS = 365


def _ensure_utc_datetime(value):
    if not value:
        return None
    if getattr(value, "tzinfo", None) is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _parse_legacy_fecha_registro(fecha_registro):
    raw = str(fecha_registro or "").strip()
    if not raw:
        return None

    try:
        if "T" in raw or "-" in raw:
            parsed_iso = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return _ensure_utc_datetime(parsed_iso)
    except Exception:
        pass

    date_part, _, time_part = raw.partition(",")
    date_part = date_part.strip()
    time_part = time_part.strip() if time_part else "00:00:00"

    formats = [
        "%d/%m/%Y",
        "%m/%d/%Y",
        "%d/%m/%y",
        "%m/%d/%y",
    ]

    parsed_date = None
    for fmt in formats:
        try:
            parsed_date = datetime.strptime(date_part, fmt)
            break
        except Exception:
            continue

    if not parsed_date:
        return None

    h = 0
    m = 0
    s = 0
    if time_part:
        parts = time_part.split(":")
        try:
            if len(parts) >= 1:
                h = int(parts[0])
            if len(parts) >= 2:
                m = int(parts[1])
            if len(parts) >= 3:
                s = int(parts[2])
        except Exception:
            h, m, s = 0, 0, 0

    return datetime(parsed_date.year, parsed_date.month, parsed_date.day, h, m, s, tzinfo=timezone.utc)


def _resolve_created_at(fecha_registro=None, created_at=None):
    canonical = _ensure_utc_datetime(created_at)
    if canonical:
        return canonical
    return _parse_legacy_fecha_registro(fecha_registro)


def _contexto_por_estado(estado, age_days):
    estado_norm = str(estado or "pendiente").strip().lower().replace("-", "_").replace(" ", "_")
    if estado_norm in {"enviado", "listo_para_retirar"}:
        estado_norm = "listo_retiro"
    if estado_norm == "en_proceso":
        estado_norm = "procesando"

    if estado_norm == "cancelado":
        return "archivado"
    if estado_norm == "entregado" and age_days >= ORDER_AGE_YEAR_DAYS:
        return "archivado"
    if estado_norm == "entregado":
        return "entregado"
    return "activo"


def _mensaje_antiguedad(age_days, contexto):
    if age_days >= ORDER_AGE_YEAR_DAYS:
        if contexto == "activo":
            return "Tu pedido tiene mas de 1 ano. Sigue activo y requiere seguimiento."
        if contexto == "entregado":
            return "Tu pedido tiene mas de 1 ano. Ya fue entregado."
        return "Tu pedido tiene mas de 1 ano. Se considera archivado en historial."

    if age_days >= ORDER_AGE_MONTH_DAYS:
        if contexto == "activo":
            return "Tu pedido tiene mas de 1 mes. Sigue en flujo activo."
        if contexto == "entregado":
            return "Tu pedido tiene mas de 1 mes. Ya fue entregado."
        return "Tu pedido tiene mas de 1 mes. Figura como archivado en historial."

    return "Pedido reciente. Aun no alcanza hitos de antiguedad."


def _etiqueta_antiguedad(age_days):
    days = max(0, int(age_days or 0))
    if days >= ORDER_AGE_YEAR_DAYS:
        years = days // ORDER_AGE_YEAR_DAYS
        rem_days = days % ORDER_AGE_YEAR_DAYS
        months = rem_days // ORDER_AGE_MONTH_DAYS
        if months > 0:
            return f"{years} ano{'s' if years != 1 else ''} {months} mes{'es' if months != 1 else ''}"
        return f"{years} ano{'s' if years != 1 else ''}"
    if days >= ORDER_AGE_MONTH_DAYS:
        months = days // ORDER_AGE_MONTH_DAYS
        return f"{months} mes{'es' if months != 1 else ''}"
    return f"{days} dia{'s' if days != 1 else ''}"


def build_order_age_payload(fecha_registro=None, estado=None, created_at=None, cancelled_at=None, now=None):
    now_utc = _ensure_utc_datetime(now) or datetime.now(timezone.utc)
    created = _resolve_created_at(fecha_registro=fecha_registro, created_at=created_at)

    if not created:
        return {
            "createdAtCanonical": None,
            "ageDays": None,
            "passed1Month": False,
            "passed1Year": False,
            "nextMilestoneDays": None,
            "contextoEstado": "activo",
            "mensaje": "No se pudo calcular la antiguedad del pedido.",
            "etiqueta": "No disponible",
            "hitoActual": None,
            "milestones": [
                {"key": "1m", "label": "1 mes", "reached": False},
                {"key": "1y", "label": "1 ano", "reached": False},
            ],
        }

    diff = now_utc - created
    age_days = max(0, int(diff.total_seconds() // 86400))

    passed_1_month = age_days >= ORDER_AGE_MONTH_DAYS
    passed_1_year = age_days >= ORDER_AGE_YEAR_DAYS

    if passed_1_year:
        next_milestone_days = None
        hito_actual = "1y"
    elif passed_1_month:
        next_milestone_days = ORDER_AGE_YEAR_DAYS - age_days
        hito_actual = "1m"
    else:
        next_milestone_days = ORDER_AGE_MONTH_DAYS - age_days
        hito_actual = None

    contexto = _contexto_por_estado(estado, age_days)

    return {
        "createdAtCanonical": created.isoformat(),
        "ageDays": age_days,
        "passed1Month": passed_1_month,
        "passed1Year": passed_1_year,
        "nextMilestoneDays": next_milestone_days,
        "contextoEstado": contexto,
        "mensaje": _mensaje_antiguedad(age_days, contexto),
        "etiqueta": _etiqueta_antiguedad(age_days),
        "hitoActual": hito_actual,
        "milestones": [
            {"key": "1m", "label": "1 mes", "reached": passed_1_month},
            {"key": "1y", "label": "1 ano", "reached": passed_1_year},
        ],
        "cancelledAt": cancelled_at.isoformat() if cancelled_at else None,
    }


def enrich_order_age_payload(base_payload, *, fecha_registro=None, estado=None, created_at=None, cancelled_at=None, now=None):
    base_payload["antiguedad"] = build_order_age_payload(
        fecha_registro=fecha_registro,
        estado=estado,
        created_at=created_at,
        cancelled_at=cancelled_at,
        now=now,
    )
    return base_payload


@order_age_bp.route("/api/admin/order-age-milestones", methods=["GET"])
@login_required
@role_required("admin")
def admin_order_age_milestones():
    clientes = Cliente.query.order_by(Cliente.id.desc()).all()

    items = []
    over_1m = 0
    over_1y = 0
    active_with_milestone = 0
    delivered_with_milestone = 0
    archived_with_milestone = 0

    for c in clientes:
        age = build_order_age_payload(
            fecha_registro=c.fecha_registro,
            estado=c.estado,
            created_at=getattr(c, "created_at", None),
            cancelled_at=c.cancelled_at,
        )

        age_days = age.get("ageDays")
        if age_days is None:
            continue

        passed_1m = bool(age.get("passed1Month"))
        passed_1y = bool(age.get("passed1Year"))
        has_milestone = passed_1m or passed_1y

        if passed_1m:
            over_1m += 1
        if passed_1y:
            over_1y += 1

        contexto = age.get("contextoEstado") or "activo"
        if has_milestone:
            if contexto == "activo":
                active_with_milestone += 1
            elif contexto == "entregado":
                delivered_with_milestone += 1
            else:
                archived_with_milestone += 1

        if has_milestone:
            items.append({
                "id": c.id,
                "nombre": c.nombre,
                "apellido": c.apellido,
                "correo": c.correo,
                "estado": str(c.estado or "pendiente"),
                "fechaRegistro": c.fecha_registro,
                "antiguedad": age,
            })

    items.sort(key=lambda i: int(i.get("antiguedad", {}).get("ageDays") or 0), reverse=True)

    oldest_days = int(items[0]["antiguedad"]["ageDays"]) if items else None

    return jsonify({
        "summary": {
            "totalEvaluated": len(clientes),
            "over1Month": over_1m,
            "over1Year": over_1y,
            "activeWithMilestone": active_with_milestone,
            "deliveredWithMilestone": delivered_with_milestone,
            "archivedWithMilestone": archived_with_milestone,
            "oldestDays": oldest_days,
        },
        "items": items[:50],
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }), 200
