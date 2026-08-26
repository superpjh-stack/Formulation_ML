"""G2 공급사 — FE-RT-09 (`api-contract.md` §8.3).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/suppliers` | GET | 전 역할 R |
| `/suppliers` | POST | admin·manufacture W |
| `/suppliers/{id}` | PATCH | admin·manufacture W |
| `/suppliers/{code}/stats` | GET | 전 역할 R |
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.api.deps import get_current_user, get_db, require_roles
from src.api.dto import supplier_dto
from src.api.middleware import set_audit
from src.api.routers._schemas import (
    SupplierIn,
    SupplierOut,
    SupplierPatch,
    SupplierStats,
)
from src.api.routers._shared import not_found
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import pct, safe_float
from src.db.models import Component, Lot, Quality, Supplier

router = APIRouter(tags=["G2 입고관리"])

_SORTABLE = {"code": Supplier.code, "name": Supplier.name, "created_at": Supplier.created_at}


@router.get("/suppliers", response_model=Page[SupplierOut],
            dependencies=[Depends(get_current_user)])
def list_suppliers(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    active: bool | None = Query(None, description="활성 여부 필터"),
):
    stmt = select(Supplier)
    if active is not None:
        stmt = stmt.where(Supplier.active.is_(active))
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Supplier.code.asc()))
    return paginate(db, stmt, pg, supplier_dto)


@router.post("/suppliers", response_model=SupplierOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "manufacture"))])
def create_supplier(body: SupplierIn, request: Request, db: Session = Depends(get_db)):
    """`code` 중복은 **409** (`suppliers_code_key`) — 전역 핸들러가 만든다."""
    sup = Supplier(**body.model_dump())
    db.add(sup)
    db.commit()
    db.refresh(sup)
    out = supplier_dto(sup)
    set_audit(request, target_id=sup.id, after=out)
    return out


@router.patch("/suppliers/{supplier_id}", response_model=SupplierOut,
              dependencies=[Depends(require_roles("admin", "manufacture"))])
def patch_supplier(
    supplier_id: int, body: SupplierPatch, request: Request, db: Session = Depends(get_db)
):
    sup = db.get(Supplier, supplier_id)
    if sup is None:
        raise not_found(f"공급사 {supplier_id}")
    before = supplier_dto(sup)
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(sup, field, value)
    db.commit()
    db.refresh(sup)
    out = supplier_dto(sup)
    set_audit(request, target_id=sup.id, before=before, after=out)
    return out


@router.get("/suppliers/{code}/stats", response_model=SupplierStats,
            dependencies=[Depends(get_current_user)])
def supplier_stats(
    code: str,
    db: Session = Depends(get_db),
    days: int = Query(90, ge=1, le=1095, description="조회 기간 (일)"),
):
    """공급사별 성분 안정성 — FE-RT-09·12.

    `sn_std`/`ag_std`/`cu_std` 는 `components` 의 **표본 표준편차**다.
    표본이 1건이면 `NULL` 이므로 그대로 `null` 로 내보낸다 (`DEF-IT-002` 규약).
    """
    sup = db.execute(select(Supplier).where(Supplier.code == code)).scalar_one_or_none()
    if sup is None:
        raise not_found(code)

    since = dt.date.today() - dt.timedelta(days=days)
    # 합격률의 정의는 **품질 합격선 70점**(goal.md 2.3) 하나뿐이다.
    #
    # 초판은 `Lot.status == 'pass'` 를 셌는데 그 경계는 **80점**이라
    # (`generate_sample.py` 가 `mock-data.ts` 에서 역산한 값: ≥80 pass / 70~80 warning),
    # 같은 공급사를 두고 `/kpi/quality`(≥70, `Quality.passed`)와 수치가 갈렸다.
    # 2차 QA 실측 — SUP_C: 이 API 30.51% vs `/kpi/quality` 월별 88~95%.
    # **두 화면이 서로를 반박했다.** `Quality.passed` 로 통일한다.
    lot_row = db.execute(
        select(
            func.count(func.distinct(Lot.id)),
            func.avg(Lot.quality_score),
            func.sum(case((Quality.passed.is_(True), 1), else_=0)),
        )
        .select_from(Lot)
        .outerjoin(Quality, Quality.lot_id == Lot.id)  # FK 는 lots.id (BIGINT) 다
        .where(Lot.supplier_id == sup.id, Lot.date >= since)
    ).one()
    lot_count, avg_quality, pass_count = int(lot_row[0] or 0), lot_row[1], lot_row[2]

    dev_row = db.execute(
        select(
            func.stddev_samp(Component.sn),
            func.stddev_samp(Component.ag),
            func.stddev_samp(Component.cu),
        )
        .select_from(Component)
        .join(Lot, Lot.id == Component.lot_id)
        .where(Lot.supplier_id == sup.id, Lot.date >= since)
    ).one()

    return {
        "lot_count": lot_count,
        "avg_quality": safe_float(avg_quality, 2),
        "pass_rate": pct(pass_count, lot_count, 2),
        "sn_std": safe_float(dev_row[0], 4),
        "ag_std": safe_float(dev_row[1], 4),
        "cu_std": safe_float(dev_row[2], 4),
    }
