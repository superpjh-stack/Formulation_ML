"""G4 LOT — FE-RT-17 (`api-contract.md` §8.5).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/lots` | GET | 전 역할 R |
| `/lots/{lot_id}` | GET | 전 역할 R |
| `/lots/{lot_id}/status` | PATCH | admin·manufacture·quality W |

`{lot_id}` 는 **문자열** `LOT-2026-001` 이다 (`lots.lot_id` UK).
내부 BIGINT `id` 를 노출하지 마라.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.api.deps import get_current_user, get_db, require_roles
from src.api.dto import component_dto, lot_dto, quality_dto, shipment_dto
from src.api.middleware import set_audit
from src.api.routers._schemas import LotDetailOut, LotOut, LotStatusPatch
from src.api.routers._shared import date_filters, lot_or_404
from src.api.schemas import Page, PageParams, paginate
from src.db.models import Component, Lot, Quality, Shipment, Supplier

router = APIRouter(tags=["G4 포장출하관리"])

_SORTABLE = {
    "date": Lot.date,
    "lot_id": Lot.lot_id,
    "quality_score": Lot.quality_score,
    "status": Lot.status,
    "created_at": Lot.created_at,
}


@router.get("/lots", response_model=Page[LotOut], dependencies=[Depends(get_current_user)])
def list_lots(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    status: str | None = Query(None, description="pass|fail|warning|pending"),
    supplier: str | None = Query(None, description="공급사 코드 (SUP_A …)"),
    lot_id: str | None = Query(None, description="LOT ID 부분 일치 (ILIKE)"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    """`?lot_id=` 는 **부분 일치**다 — FE-RT-17 검색창이 이것 없이는 동작하지 않는다."""
    stmt = select(Lot).options(joinedload(Lot.supplier))
    if status:
        stmt = stmt.where(Lot.status == status)
    if supplier:
        stmt = stmt.where(Lot.supplier_id == select(Supplier.id)
                          .where(Supplier.code == supplier).scalar_subquery())
    if lot_id:
        stmt = stmt.where(Lot.lot_id.ilike(f"%{lot_id}%"))
    for cond in date_filters(Lot.date, date_from, date_to):
        stmt = stmt.where(cond)
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Lot.date.desc()), Lot.lot_id.desc())
    return paginate(db, stmt, pg, lot_dto)


@router.get("/lots/{lot_id}", response_model=LotDetailOut,
            dependencies=[Depends(get_current_user)])
def get_lot(lot_id: str, db: Session = Depends(get_db)):
    """성분·품질·출하를 조인해서 돌려준다."""
    lot = lot_or_404(db, lot_id)
    components = db.execute(
        select(Component).where(Component.lot_id == lot.id).order_by(Component.date.desc())
    ).scalars().all()
    qualities = db.execute(
        select(Quality).where(Quality.lot_id == lot.id).order_by(Quality.tested_at.desc())
    ).scalars().all()
    shipments = db.execute(
        select(Shipment).where(Shipment.lot_id == lot.id).order_by(Shipment.shipped_at.desc())
    ).scalars().all()

    return {
        **lot_dto(lot),
        "components": [component_dto(c, lot.lot_id) for c in components],
        "quality": [quality_dto(q, lot.lot_id) for q in qualities],
        "shipments": [shipment_dto(s, lot.lot_id) for s in shipments],
    }


@router.patch("/lots/{lot_id}/status", response_model=LotOut,
              dependencies=[Depends(require_roles("admin", "manufacture", "quality"))])
def patch_lot_status(
    lot_id: str, body: LotStatusPatch, request: Request, db: Session = Depends(get_db)
):
    """LOT 상태 수동 변경.

    ⚠ `lots.status` 의 점수 경계(≥80 pass / ≥70 warning)는 시드·집계 규칙이고
    (`db-schema.md` §3.1), 이 엔드포인트는 담당자의 **수동 판정**을 받는다.
    서버가 점수로 되돌려 덮어쓰지 않는다.
    """
    lot = lot_or_404(db, lot_id)
    before = {"status": lot.status}
    lot.status = body.status
    db.commit()
    db.refresh(lot)
    set_audit(request, target_table="lots", target_id=lot.id,
              before=before, after={"status": lot.status})
    return lot_dto(lot)
