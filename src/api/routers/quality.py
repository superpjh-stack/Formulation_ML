"""G4 품질 검사 — FE-RT-18 (`api-contract.md` §8.5).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/quality` | GET | 전 역할 R |
| `/quality` | POST | admin·quality W |
| `/quality/{lot_id}/certificate` | GET | 전 역할 R |

`passed` 는 **서버가 계산한다** — 클라이언트가 보낸 값을 믿지 마라 (SF-TD5 §3.4).
합격선은 하드코딩하지 않고 `system_settings.quality.pass_score` 에서 읽는다
(기본 70 — goal.md 2.3).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.api import settings_store
from src.api.deps import get_current_user, get_db, require_roles
from src.api.dto import component_dto, quality_dto
from src.api.middleware import set_audit
from src.api.routers._schemas import QualityCertificate, QualityIn, QualityOut
from src.api.routers._shared import datetime_filters, lot_or_404
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import iso, safe_float
from src.db.models import Component, Lot, Quality

router = APIRouter(tags=["G4 포장출하관리"])

_SORTABLE = {"tested_at": Quality.tested_at, "score": Quality.score, "id": Quality.id}


def _pass_score(db: Session) -> float:
    return float(settings_store.get(db, settings_store.K_PASS_SCORE, 70))


@router.get("/quality", response_model=Page[QualityOut],
            dependencies=[Depends(get_current_user)])
def list_quality(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    lot_id: str | None = Query(None, description="LOT ID 부분 일치 (ILIKE)"),
    passed: bool | None = Query(None, description="합격 여부"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    stmt = select(Quality).options(joinedload(Quality.lot))
    if lot_id:
        stmt = stmt.join(Lot, Lot.id == Quality.lot_id).where(Lot.lot_id.ilike(f"%{lot_id}%"))
    if passed is not None:
        stmt = stmt.where(Quality.passed.is_(passed))
    for cond in datetime_filters(Quality.tested_at, date_from, date_to):
        stmt = stmt.where(cond)
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Quality.tested_at.desc()), Quality.id.desc())
    return paginate(db, stmt, pg, quality_dto)


@router.post("/quality", response_model=QualityOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "quality"))])
def create_quality(body: QualityIn, request: Request, db: Session = Depends(get_db)):
    """검사 결과 등록. `lot_id` 가 없으면 **404**."""
    lot = lot_or_404(db, body.lot_id)
    row = Quality(
        lot_id=lot.id,
        score=Decimal(f"{body.score:.2f}"),
        passed=body.score >= _pass_score(db),          # 서버 판정
        model_used=body.model_used,
        predicted_score=(None if body.predicted_score is None
                         else Decimal(f"{body.predicted_score:.2f}")),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    out = quality_dto(row, lot.lot_id)
    set_audit(request, target_id=row.id, after=out)
    return out


@router.get("/quality/{lot_id}/certificate", response_model=QualityCertificate,
            dependencies=[Depends(get_current_user)])
def certificate(lot_id: str, db: Session = Depends(get_db)):
    """품질 성적서 — **JSON 만** 반환한다.

    PDF 생성은 `ISS-001` 로 v1.1 범위 밖이다 (goal.md 2.7).
    """
    lot = db.execute(
        select(Lot).options(joinedload(Lot.supplier)).where(Lot.lot_id == lot_id)
    ).scalar_one_or_none()
    if lot is None:
        from src.api.routers._shared import not_found
        raise not_found(lot_id)

    latest = db.execute(
        select(Quality).where(Quality.lot_id == lot.id)
        .order_by(Quality.tested_at.desc(), Quality.id.desc())
    ).scalars().first()
    comp = db.execute(
        select(Component).where(Component.lot_id == lot.id)
        .order_by(Component.date.desc(), Component.id.desc())
    ).scalars().first()

    if latest is not None:
        score, passed = safe_float(latest.score, 2), bool(latest.passed)
    else:
        # 검사 행이 없으면 `lots.quality_score` 로 대체하고 합격선으로 판정한다.
        score = safe_float(lot.quality_score, 2)
        passed = None if score is None else score >= _pass_score(db)

    return {
        "lot_id": lot.lot_id,
        "date": iso(lot.date),
        "supplier": lot.supplier.code if lot.supplier else None,
        "components": component_dto(comp, lot.lot_id) if comp else None,
        "score": score,
        "passed": passed,
        "issued_at": iso(dt.datetime.now()),
    }
