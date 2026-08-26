"""감사로그 미들웨어 — `api-contract.md` §6 / NFR-S-04 (SF-AD2 FR-SY-02).

**보관 1년.** 기록 대상: 모든 데이터 변경 + 로그인 + ML 예측.

### 왜 미들웨어 한 곳인가
95개 엔드포인트에 `AuditLog(...)` 를 흩뿌리면 관리가 불가능하다 (§6.1).
**라우터 핸들러 안에서 `AuditLog(...)` 를 직접 만들지 마라.**
대신 `set_audit(request, ...)` 로 이 미들웨어에 힌트만 남긴다.

### 기록 조건 (§6.2)
| 조건 | `action` | `target_table` |
|---|---|---|
| `POST`/`PUT`/`PATCH`/`DELETE` 이고 2xx | `CREATE`/`UPDATE`/`DELETE` | 경로에서 유도 |
| `POST /auth/login` 성공 | `LOGIN` | `users` |
| `POST /predict` · `/recommend` · `/doe/simulate` · `/doe/optimize` | `PREDICT` | `ml_models` |
| 그 외 `GET` | 기록 안 함 (조회까지 남기면 1년 보관이 감당 안 된다) | — |

### 컬럼 매핑 (§6.3 / SF-TD5 §3.9)
`user_id` JWT `uid` (미인증이면 **NULL** — `audit_logs.user_id` 는 `ON DELETE SET NULL`) ·
`detail` JSONB `{"before":…, "after":…}` — **`password_hash` 는 절대 넣지 마라** ·
`ip_address` INET `X-Forwarded-For` 첫 값 → 없으면 `request.client.host`

감사 기록 실패가 업무 요청을 실패시키지 않는다. 별도 세션에서 쓰고 예외를 삼킨다.
"""
from __future__ import annotations

import datetime as dt
import ipaddress
import logging
from typing import Any

from fastapi import FastAPI, Request
from sqlalchemy import delete

from src.api.deps import peek_token_payload
from src.db.models import AuditLog
from src.db.session import SessionLocal

log = logging.getLogger("koryo.audit")

#: SF-TD5 §3.9 `audit_logs.action` 허용값 (ts-types.md §6 `AuditAction`)
AUDIT_ACTIONS = ("CREATE", "UPDATE", "DELETE", "LOGIN", "PREDICT")

#: NFR-S-04 — 감사로그 보관 1년
AUDIT_RETENTION_DAYS = 365

_METHOD_ACTION = {"POST": "CREATE", "PUT": "UPDATE", "PATCH": "UPDATE", "DELETE": "DELETE"}

#: `PREDICT` 로 기록할 경로 (§6.2). `/api/v1` 접두사를 벗긴 형태로 적는다.
_PREDICT_PATHS = frozenset({"/predict", "/recommend", "/doe/simulate", "/doe/optimize"})

#: 쓰기 메서드지만 **데이터를 바꾸지 않는** 경로 — 기록하지 않는다.
_NO_AUDIT_PREFIXES = (
    "/auth/logout",
    "/auth/refresh",
    "/doe/methods",
    "/doe/design",
    "/doe/analyze",
    "/doe/compare",
    "/doe/sample",
    "/agents/",          # 전부 501 이라 2xx 가 나오지 않지만 명시해 둔다
)

#: 경로 → `target_table`. 가장 긴 접두사가 이긴다 (§6.2 "라우터에서 유도").
_TABLE_BY_PREFIX: dict[str, str] = {
    "/auth/login": "users",
    "/users": "users",
    "/receipts": "receipts",
    "/claims": "claims",
    "/suppliers": "suppliers",
    "/lots": "lots",
    "/components": "components",
    "/quality": "quality",
    "/shipments": "shipments",
    "/equipment": "equipment",
    "/alerts": "alerts",
    "/process/conditions": "process_conditions",
    "/process/history": "condition_history",
    "/master/": "master_codes",
    "/notification-rules": "notification_rules",
    "/settings": "system_settings",
    "/integrations": "system_settings",
    "/kpi/targets": "kpi_targets",
    "/training-data": "lots",
    "/predict": "ml_models",
    "/recommend": "ml_models",
    "/doe/": "ml_models",
}

#: `detail` 에서 통째로 지울 키 (§6.3). 비교는 소문자 부분일치다.
_REDACT_KEY_FRAGMENTS = ("password", "secret", "token", "api_key", "apikey", "credential")
_REDACTED = "***"


# ══════════════════════════════════════════════════════════════════════════
# 라우터가 쓰는 힌트 API
# ══════════════════════════════════════════════════════════════════════════
def set_audit(
    request: Request,
    *,
    target_table: str | None = None,
    target_id: int | None = None,
    before: Any = None,
    after: Any = None,
    action: str | None = None,
    user_id: int | None = None,
    skip: bool = False,
) -> None:
    """감사로그에 남길 값을 미들웨어에 넘긴다.

    핸들러 안에서 `AuditLog(...)` 를 만들지 말고 이걸 써라.

        @router.patch("/lots/{lot_id}/status")
        def patch_status(lot_id: str, request: Request, ...):
            before = _dump(lot)
            lot.status = body.status
            db.commit()
            set_audit(request, target_id=lot.id, before=before, after=_dump(lot))
            return _dump(lot)

    `target_table` 을 생략하면 경로에서 유도한다.
    `skip=True` 로 이 요청의 기록을 끌 수 있다 (부작용 없는 쓰기 메서드).
    """
    state = request.scope.setdefault("state", {})
    hint: dict[str, Any] = state.setdefault("audit", {})
    if target_table is not None:
        hint["target_table"] = target_table
    if target_id is not None:
        hint["target_id"] = int(target_id)
    if before is not None:
        hint["before"] = before
    if after is not None:
        hint["after"] = after
    if action is not None:
        hint["action"] = action
    if user_id is not None:
        hint["user_id"] = int(user_id)
    if skip:
        hint["skip"] = True


# ══════════════════════════════════════════════════════════════════════════
# 내부 유틸
# ══════════════════════════════════════════════════════════════════════════
def _canonical_path(path: str) -> str:
    """`/api/v1` 접두사를 벗긴다 — 정본 경로와 deprecated 별칭을 같은 규칙으로 다룬다."""
    if path.startswith("/api/v1"):
        path = path[len("/api/v1"):]
    return path or "/"


def _table_for(path: str) -> str | None:
    best: tuple[int, str | None] = (0, None)
    for prefix, table in _TABLE_BY_PREFIX.items():
        if path == prefix.rstrip("/") or path.startswith(prefix):
            if len(prefix) > best[0]:
                best = (len(prefix), table)
    return best[1]


def _target_id_from_path(path: str) -> int | None:
    for part in reversed(path.strip("/").split("/")):
        if part.isdigit():
            return int(part)
    return None


def _client_ip(request: Request) -> str | None:
    """`X-Forwarded-For` 첫 값 → 없으면 `request.client.host` (§6.3).

    `audit_logs.ip_address` 는 **INET** 이므로 형식이 틀리면 INSERT 가 통째로 실패한다.
    반드시 검증해서 넣는다.
    """
    raw = request.headers.get("x-forwarded-for")
    candidate = raw.split(",")[0].strip() if raw else (request.client.host if request.client else None)
    if not candidate:
        return None
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def _redact(value: Any, depth: int = 0) -> Any:
    """`password_hash` 등 비밀 값을 제거한다 (§6.3). 깊이 6에서 잘라 폭주를 막는다."""
    if depth > 6:
        return _REDACTED
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            key = str(k)
            if any(frag in key.lower() for frag in _REDACT_KEY_FRAGMENTS):
                out[key] = _REDACTED
            else:
                out[key] = _redact(v, depth + 1)
        return out
    if isinstance(value, (list, tuple)):
        return [_redact(v, depth + 1) for v in value[:200]]
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat()
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _resolve(request: Request, status_code: int) -> dict | None:
    """이 요청을 기록할지 판정하고 기록할 행을 만든다. 대상이 아니면 `None`."""
    if not (200 <= status_code < 300):
        return None

    method = request.method.upper()
    path = _canonical_path(request.url.path)
    hint: dict[str, Any] = (request.scope.get("state") or {}).get("audit", {}) or {}

    if hint.get("skip"):
        return None

    # PREDICT — POST 이지만 데이터 변경이 아니다 (§6.2)
    if path in _PREDICT_PATHS and method == "POST":
        action = "PREDICT"
        table = "ml_models"
    elif path == "/auth/login" and method == "POST":
        action = "LOGIN"
        table = "users"
    elif method in _METHOD_ACTION:
        if any(path.startswith(p) for p in _NO_AUDIT_PREFIXES):
            return None
        if path.endswith("/test"):        # `/integrations/{system}/test` — 연결 확인일 뿐이다
            return None
        action = _METHOD_ACTION[method]
        table = hint.get("target_table") or _table_for(path)
    else:
        return None  # GET/HEAD/OPTIONS 는 기록하지 않는다

    action = hint.get("action", action)
    if action not in AUDIT_ACTIONS:
        log.warning("알 수 없는 audit action=%r (경로 %s) — 기록하지 않는다", action, path)
        return None

    user_id = hint.get("user_id")
    if user_id is None:
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth[:7].lower() == "bearer " else None
        payload = peek_token_payload(token)
        user_id = payload.get("uid") if payload else None

    detail: dict[str, Any] | None = None
    if "before" in hint or "after" in hint:
        detail = {"before": _redact(hint.get("before")), "after": _redact(hint.get("after"))}
    elif action in ("CREATE", "UPDATE", "DELETE"):
        detail = {"before": None, "after": None, "note": "핸들러가 set_audit() 로 값을 남기지 않았다"}

    return {
        "user_id": int(user_id) if user_id is not None else None,
        "action": action,
        "target_table": hint.get("target_table") or table,
        "target_id": hint.get("target_id") if hint.get("target_id") is not None
                     else _target_id_from_path(path),
        "detail": detail,
        "ip_address": _client_ip(request),
    }


def _write(row: dict) -> None:
    """별도 세션. **실패해도 요청은 성공시킨다** (§6.1)."""
    db = SessionLocal()
    try:
        db.add(AuditLog(**row))
        db.commit()
    except Exception as exc:  # noqa: BLE001 — 감사 실패로 업무를 막지 않는다
        db.rollback()
        log.error("감사로그 기록 실패 (%s %s): %s", row.get("action"), row.get("target_table"), exc)
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════
# 보관 정책 — NFR-S-04
# ══════════════════════════════════════════════════════════════════════════
def purge_expired_audit_logs(retention_days: int = AUDIT_RETENTION_DAYS) -> int:
    """1년이 지난 감사로그를 지운다. 삭제 건수를 반환한다.

    `app.py` 의 lifespan 이 기동 시 1회 호출한다. 상시 운영에서는 cron 으로 옮겨라
    (SF-TD5 §3.9 는 월별 파티셔닝을 권고하나 v1 은 단일 테이블이다 — `db-schema.md` §5).
    """
    cutoff = dt.datetime.now() - dt.timedelta(days=retention_days)
    db = SessionLocal()
    try:
        result = db.execute(delete(AuditLog).where(AuditLog.created_at < cutoff))
        db.commit()
        return int(result.rowcount or 0)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("감사로그 정리 건너뜀: %s", exc)
        return 0
    finally:
        db.close()


# ══════════════════════════════════════════════════════════════════════════
# 등록
# ══════════════════════════════════════════════════════════════════════════
#: deprecated 별칭 응답에 붙일 헤더 (§2.2). 정본 경로를 `Link` 로 알려준다.
#: `_LEGACY_EXACT` 는 정확히 일치할 때만, `_LEGACY_PREFIXES` 는 접두사로 판정한다.
#: `GET /` 를 접두사로 다루면 **모든 경로**가 deprecated 로 표시된다.
_LEGACY_EXACT = {"/", "/models", "/predict", "/recommend", "/eda/stats"}
_LEGACY_PREFIXES = ("/doe/",)

#: 별칭 → 정본 경로. 표기가 다른 2건만 명시하고 나머지는 `/api/v1` 을 앞에 붙인다 (§1.4).
_SUCCESSOR = {"/": "/api/v1/health", "/eda/stats": "/api/v1/eda-stats"}


def register_middleware(app: FastAPI) -> None:
    """`app.py` 에서 한 번만 호출한다."""

    @app.middleware("http")
    async def audit_and_deprecation(request: Request, call_next):
        response = await call_next(request)

        path = request.url.path
        # ── deprecated 별칭 헤더 (§2.2) ────────────────────────────────
        if path in _LEGACY_EXACT or path.startswith(_LEGACY_PREFIXES):
            successor = _SUCCESSOR.get(path, f"/api/v1{path}")
            response.headers["Deprecation"] = "true"
            response.headers["Link"] = f'<{successor}>; rel="successor-version"'

        # ── 감사로그 (§6) ──────────────────────────────────────────────
        try:
            row = _resolve(request, response.status_code)
        except Exception as exc:  # noqa: BLE001
            log.error("감사로그 판정 실패: %s", exc)
            row = None
        if row is not None:
            _write(row)

        return response


__all__ = [
    "AUDIT_ACTIONS",
    "AUDIT_RETENTION_DAYS",
    "purge_expired_audit_logs",
    "register_middleware",
    "set_audit",
]
