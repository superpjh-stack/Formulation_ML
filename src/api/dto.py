"""테이블 행 → 응답 DTO 변환 — `ts-types.md` §5.

프론트 타입과 **1:1**이다. 필드명·null 허용 여부를 임의로 바꾸지 마라.

공통 규칙
  * `lot_id` 는 **문자열** `LOT-2026-001` (`lots.lot_id` UK). 내부 BIGINT `id` 를 노출하지 마라.
  * `supplier_code` 는 `suppliers.code` (BIGINT `supplier_id` 를 노출하지 마라).
  * `Decimal` → `float`, `NaN`/`Inf` → `null` (§4.1 — `DEF-IT-002`).
  * `UserDto` 에 **`password_hash` 를 절대 포함하지 마라** (§8.7).

개발1도 자기 라우터에서 **이 함수들을 임포트해서 쓴다.** 같은 테이블의 DTO 를
두 벌 만들면 프론트가 화면마다 다른 필드를 받는다.
"""
from __future__ import annotations

from typing import Any

from src.api.serialization import iso, safe_float, safe_int
from src.db.models import (
    Alert,
    AuditLog,
    Component,
    Equipment,
    Lot,
    Quality,
    Shipment,
    Supplier,
    User,
)


def lot_dto(lot: Lot, supplier_code: str | None = None) -> dict:
    return {
        "lot_id": lot.lot_id,
        "date": iso(lot.date),
        "supplier_code": supplier_code if supplier_code is not None
                         else (lot.supplier.code if lot.supplier else None),
        "sn_ratio": safe_float(lot.sn_ratio, 3),
        "ag_ratio": safe_float(lot.ag_ratio, 3),
        "cu_ratio": safe_float(lot.cu_ratio, 3),
        "pb_ratio": safe_float(lot.pb_ratio, 3),
        "temperature": safe_float(lot.temperature, 1),
        "time_min": safe_int(lot.time_min),
        "quality_score": safe_float(lot.quality_score, 2),
        "status": lot.status,
        "created_at": iso(lot.created_at),
        "updated_at": iso(lot.updated_at),
    }


def component_dto(comp: Component, lot_code: str | None = None) -> dict:
    return {
        "id": comp.id,
        "lot_id": lot_code if lot_code is not None else (comp.lot.lot_id if comp.lot else None),
        "date": iso(comp.date),
        "sn": safe_float(comp.sn, 3),
        "ag": safe_float(comp.ag, 3),
        "cu": safe_float(comp.cu, 3),
        "pb": safe_float(comp.pb, 3),
        "sn_deviation": safe_float(comp.sn_deviation, 3),
        "ag_deviation": safe_float(comp.ag_deviation, 3),
        "cu_deviation": safe_float(comp.cu_deviation, 3),
        "analysis_method": comp.analysis_method,
        "created_at": iso(comp.created_at),
    }


def supplier_dto(sup: Supplier) -> dict:
    return {
        "id": sup.id,
        "code": sup.code,
        "name": sup.name,
        "contact": sup.contact,
        "primary_material": sup.primary_material,
        "active": bool(sup.active),
        "created_at": iso(sup.created_at),
    }


def quality_dto(q: Quality, lot_code: str | None = None) -> dict:
    return {
        "id": q.id,
        "lot_id": lot_code if lot_code is not None else (q.lot.lot_id if q.lot else None),
        "score": safe_float(q.score, 2),
        "passed": bool(q.passed),
        "model_used": q.model_used,
        "predicted_score": safe_float(q.predicted_score, 2),
        "tested_at": iso(q.tested_at),
    }


def equipment_dto(eq: Equipment, temp_warn_c: float = 255.0) -> dict:
    """`temp_warning` 은 **서버가 판정한다** (§8.6) — 프론트가 255 를 하드코딩하지 않게 한다.

    임계값은 `system_settings` 의 `equipment.temp_warn_c` 에서 온다.
    """
    temp = safe_float(eq.temperature, 1)
    return {
        "id": eq.id,
        "eq_id": eq.eq_id,
        "name": eq.name,
        "status": eq.status,
        "temperature": temp,
        "uptime": safe_int(eq.uptime),
        "last_maintenance": iso(eq.last_maintenance),
        "temp_warning": bool(temp is not None and temp > temp_warn_c),
        "updated_at": iso(eq.updated_at),
    }


def alert_dto(alert: Alert, lot_code: str | None = None) -> dict:
    return {
        "id": alert.id,
        "level": alert.level,
        "message": alert.message,
        "source": alert.source,
        "lot_id": lot_code if lot_code is not None else (alert.lot.lot_id if alert.lot else None),
        "resolved": bool(alert.resolved),
        "resolved_at": iso(alert.resolved_at),
        "created_at": iso(alert.created_at),
    }


def shipment_dto(ship: Shipment, lot_code: str | None = None) -> dict:
    return {
        "id": ship.id,
        "lot_id": lot_code if lot_code is not None else (ship.lot.lot_id if ship.lot else None),
        "customer": ship.customer,
        "product": ship.product,
        "quantity": safe_float(ship.quantity, 2),
        "unit": ship.unit,
        "shipped_at": iso(ship.shipped_at),
    }


def user_dto(user: User) -> dict:
    """⚠ `password_hash` 는 절대 포함하지 않는다 (§8.7)."""
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "active": bool(user.active),
        "last_login": iso(user.last_login),
        "created_at": iso(user.created_at),
    }


def auth_user_dto(user: User) -> dict:
    """`GET /auth/me` — `AuthUser` (`ts-types.md` §6). `created_at` 이 없다."""
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "active": bool(user.active),
        "last_login": iso(user.last_login),
    }


def audit_log_dto(row: AuditLog, username: str | None = None) -> dict:
    """`ip_address` 를 포함한다. `GET /claims/{claim_no}/history` 는 **제외**한다 (§8.5.1)."""
    return {
        "id": row.id,
        "user_id": row.user_id,
        "username": username if username is not None else (row.user.username if row.user else None),
        "action": row.action,
        "target_table": row.target_table,
        "target_id": row.target_id,
        "detail": row.detail,
        "ip_address": str(row.ip_address) if row.ip_address else None,
        "created_at": iso(row.created_at),
    }


def dump_for_audit(obj: Any, fields: tuple[str, ...]) -> dict:
    """감사로그 `detail.before/after` 용 얕은 스냅샷.

    `set_audit(request, before=dump_for_audit(lot, ("status", "quality_score")))`
    """
    out: dict[str, Any] = {}
    for name in fields:
        value = getattr(obj, name, None)
        out[name] = iso(value) if hasattr(value, "isoformat") else (
            safe_float(value) if type(value).__name__ == "Decimal" else value
        )
    return out
