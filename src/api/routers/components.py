"""G2 성분 데이터 — FE-RT-08 (`api-contract.md` §8.3).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/components` | GET | 전 역할 R |
| `/components` | POST | admin·manufacture·quality W |
| `/components/{lot_id}` | GET | 전 역할 R |

> **편차는 클라이언트가 계산해서 보내지 않는다.** `POST` 는 `sn/ag/cu/pb` 만 받고
> 서버가 `sn - SN_TARGET` … 를 계산해 저장한다 (SF-TD5 §3.2, FR-R-03).
> 목표값은 `src/features/engineering.py` 를 임포트해서 쓴다 —
> **숫자 62.0 을 API 코드에 다시 쓰지 마라** (`api-contract.md` §8.3).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from src.api.deps import get_current_user, get_db, require_roles
from src.api.dto import component_dto
from src.api.middleware import set_audit
from src.api.routers._schemas import ComponentIn, ComponentOut
from src.api.routers._shared import date_filters, lot_or_404, not_found
from src.api.schemas import Page, PageParams, paginate
from src.db.models import Component, Lot, Supplier
from src.features.engineering import AG_TARGET, CU_TARGET, SN_TARGET

router = APIRouter(tags=["G2 입고관리"])

_SORTABLE = {"date": Component.date, "created_at": Component.created_at, "sn": Component.sn}


def _dec(value: float, digits: int = 3) -> Decimal:
    return Decimal(f"{float(value):.{digits}f}")


@router.get("/components", response_model=Page[ComponentOut],
            dependencies=[Depends(get_current_user)])
def list_components(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    lot_id: str | None = Query(None, description="LOT ID 부분 일치 (ILIKE)"),
    supplier: str | None = Query(None, description="공급사 코드"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    stmt = select(Component).options(joinedload(Component.lot))
    if lot_id or supplier:
        stmt = stmt.join(Lot, Lot.id == Component.lot_id)
    if lot_id:
        stmt = stmt.where(Lot.lot_id.ilike(f"%{lot_id}%"))
    if supplier:
        stmt = stmt.where(Lot.supplier_id == select(Supplier.id)
                          .where(Supplier.code == supplier).scalar_subquery())
    for cond in date_filters(Component.date, date_from, date_to):
        stmt = stmt.where(cond)
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Component.date.desc()), Component.id.desc())
    return paginate(db, stmt, pg, component_dto)


@router.get("/components/{lot_id}", response_model=ComponentOut,
            dependencies=[Depends(get_current_user)])
def get_component(lot_id: str, db: Session = Depends(get_db)):
    """해당 LOT 의 **최신** 성분 1건. 성분 기록이 없으면 404."""
    lot = lot_or_404(db, lot_id)
    comp = db.execute(
        select(Component)
        .where(Component.lot_id == lot.id)
        .order_by(Component.date.desc(), Component.id.desc())
    ).scalars().first()
    if comp is None:
        raise not_found(f"{lot_id} 의 성분 데이터")
    return component_dto(comp, lot.lot_id)


@router.post("/components", response_model=ComponentOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "manufacture", "quality"))])
def create_component(body: ComponentIn, request: Request, db: Session = Depends(get_db)):
    """성분 등록 — **편차 3종은 서버가 계산한다.**

    * `lot_id` 가 `lots` 에 없으면 **404**
    * 합계가 100% 가 아니면 **422** (`ComponentIn` 의 `model_validator`)
    """
    lot = lot_or_404(db, body.lot_id)
    comp = Component(
        lot_id=lot.id,
        date=body.date,
        sn=_dec(body.sn), ag=_dec(body.ag), cu=_dec(body.cu), pb=_dec(body.pb),
        sn_deviation=_dec(body.sn - SN_TARGET),
        ag_deviation=_dec(body.ag - AG_TARGET),
        cu_deviation=_dec(body.cu - CU_TARGET),
        analysis_method=body.analysis_method,
    )
    db.add(comp)
    db.commit()
    db.refresh(comp)
    out = component_dto(comp, lot.lot_id)
    set_audit(request, target_id=comp.id, after=out)
    return out
