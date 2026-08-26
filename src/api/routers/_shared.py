"""라우터 공용 헬퍼 — 오류 계약(§5) · 기간 필터 · 조회 보조.

`_` 로 시작하는 내부 모듈이다. 엔드포인트를 여기 두지 마라.

오류 계약 (`api-contract.md` §5 / §5.1)
    404  리소스 없음        `{"detail":"LOT-2026-999 을(를) 찾을 수 없습니다"}`
    409  UK 중복            `src/api/errors.py` 전역 `IntegrityError` 핸들러가 만든다
    422  업무 규칙 위반      Pydantic `model_validator` 또는 명시적 `HTTPException(422)`
    503  DB 연결 실패        `src/api/errors.py` 전역 `OperationalError` 핸들러 (라우터에서 잡지 마라)
"""
from __future__ import annotations

import datetime as dt

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.db.models import Lot, Supplier


def not_found(ident: object) -> HTTPException:
    """§5.1 — `{"detail":"LOT-2026-999 을(를) 찾을 수 없습니다"}`."""
    return HTTPException(status_code=404, detail=f"{ident} 을(를) 찾을 수 없습니다")


def unprocessable(detail: str) -> HTTPException:
    """§5 — 업무 규칙 위반 422. 문구는 계약에 적힌 것을 그대로 쓴다."""
    return HTTPException(status_code=422, detail=detail)


def date_filters(column, date_from: dt.date | None, date_to: dt.date | None) -> list:
    """`DATE` 컬럼용 기간 조건 (양끝 포함)."""
    conds = []
    if date_from is not None:
        conds.append(column >= date_from)
    if date_to is not None:
        conds.append(column <= date_to)
    return conds


def datetime_filters(column, date_from: dt.date | None, date_to: dt.date | None) -> list:
    """`TIMESTAMP` 컬럼용 기간 조건.

    `date_to` 는 **그날 24시까지 포함**한다 — `<= date_to` 로 비교하면
    `2026-06-27 10:00` 이 `date_to=2026-06-27` 필터에서 빠진다.
    """
    conds = []
    if date_from is not None:
        conds.append(column >= dt.datetime.combine(date_from, dt.time.min))
    if date_to is not None:
        conds.append(column < dt.datetime.combine(date_to + dt.timedelta(days=1), dt.time.min))
    return conds


def lot_or_404(db: Session, lot_code: str) -> Lot:
    """문자열 `lot_id` (`LOT-2026-001`) → `lots` 행. 없으면 404.

    ⚠ 내부 BIGINT `lots.id` 를 API 로 노출하지 마라 (`db-schema.md` §3.1).
    """
    lot = db.execute(select(Lot).where(Lot.lot_id == lot_code)).scalar_one_or_none()
    if lot is None:
        raise not_found(lot_code)
    return lot


def supplier_or_404(db: Session, code: str) -> Supplier:
    sup = db.execute(select(Supplier).where(Supplier.code == code)).scalar_one_or_none()
    if sup is None:
        raise not_found(code)
    return sup
