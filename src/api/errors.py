"""오류 계약 전역 핸들러 — `api-contract.md` §5 / SF-TD4 §5.

QA 가 §5 의 6줄을 그대로 테스트 케이스로 쓴다. **새 오류 코드를 발명하지 마라.**

| 오류 | HTTP | 응답 본문 | 구현 위치 |
|---|---|---|---|
| 성분 합계 ≠ 100% | 422 | FastAPI 기본 `{"detail":[{...}]}` | Pydantic `model_validator` |
| 모델 파일 없음 | 404 | `{"detail":"모델을 찾을 수 없습니다"}` | `src/api/model_cache.py` |
| 최적화 수렴 실패 | **200** | `{"optimization_success": false, ...}` | `src/models/optimize.py` — **4xx/5xx 로 바꾸지 마라** |
| DB 연결 실패 | 503 | `{"detail":"서비스 일시 중단"}` | **이 파일** (전역 한 곳. 라우터마다 try/except 금지) |
| 인증 실패 | 401 | `{"detail":"로그인이 필요합니다"}` | `src/api/deps.py` |
| 권한 없음 | 403 | `{"detail":"접근 권한이 없습니다"}` | `src/api/deps.py` |

§5.1 확장 3종:
    리소스 없음 404 · 저장 테이블 없는 화면 **501** · UK 중복 **409**
"""
from __future__ import annotations

import logging
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, InterfaceError, OperationalError

log = logging.getLogger("koryo.api")

SERVICE_UNAVAILABLE_DETAIL = "서비스 일시 중단"
NOT_IMPLEMENTED_DETAIL = "미구현 — v1 범위 밖"

#: 제약 이름 → 사용자에게 보여줄 필드명. 실측 UK 는 `db-schema.md` §6.11 참조.
_UNIQUE_FIELDS = {
    "lots_lot_id_key": "lot_id",
    "suppliers_code_key": "code",
    "equipment_eq_id_key": "eq_id",
    "users_username_key": "username",
    "users_email_key": "email",
    "receipts_receipt_no_key": "receipt_no",
    "claims_claim_no_key": "claim_no",
    "uq_master_codes_group_code_version": "group_code+code+version",
    "uq_master_codes_active_code": "group_code+code (활성)",
    "uq_notification_rules_event_channel": "event_type+channel",
    "uq_kpi_targets_key_period": "kpi_key+period",
    "uq_process_conditions_product_version": "product_code+version",
}

_CONSTRAINT_RE = re.compile(r'"([^"]+)"')


def _constraint_name(exc: IntegrityError) -> str | None:
    orig = getattr(exc, "orig", None)
    diag = getattr(orig, "diag", None)
    name = getattr(diag, "constraint_name", None)
    if name:
        return name
    match = _CONSTRAINT_RE.search(str(orig or exc))
    return match.group(1) if match else None


def register_exception_handlers(app: FastAPI) -> None:
    """`app.py` 에서 한 번만 호출한다."""

    @app.exception_handler(OperationalError)
    async def _db_unavailable(request: Request, exc: OperationalError):  # noqa: ARG001
        # 연결 끊김·서버 다운·풀 고갈. `pool_pre_ping=True` 가 끊긴 커넥션을 잡아
        # 여기로 보낸다 (`src/db/session.py`).
        log.error("DB unavailable: %s", exc)
        return JSONResponse(status_code=503, content={"detail": SERVICE_UNAVAILABLE_DETAIL})

    @app.exception_handler(InterfaceError)
    async def _db_interface(request: Request, exc: InterfaceError):  # noqa: ARG001
        log.error("DB interface error: %s", exc)
        return JSONResponse(status_code=503, content={"detail": SERVICE_UNAVAILABLE_DETAIL})

    @app.exception_handler(IntegrityError)
    async def _integrity(request: Request, exc: IntegrityError):  # noqa: ARG001
        # §5.1 — UK 중복은 409. FK 위반 등 그 외 무결성 오류는 422 로 내린다.
        name = _constraint_name(exc)
        text = str(getattr(exc, "orig", exc))
        if name in _UNIQUE_FIELDS or "duplicate key" in text or "UniqueViolation" in text:
            field = _UNIQUE_FIELDS.get(name or "", name or "값")
            return JSONResponse(status_code=409, content={"detail": f"중복된 값입니다 ({field})"})
        log.warning("IntegrityError: %s", text)
        return JSONResponse(status_code=422, content={"detail": "데이터 무결성 제약 위반"})
