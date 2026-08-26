"""G4 출하 — FE-RT-16 (`api-contract.md` §8.5).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/shipments` | GET | 전 역할 R |
| `/shipments` | POST | admin·sales W |
| `/shipments/calendar` | GET | 전 역할 R (**벌거벗은 배열** — §4.2 예외) |
"""
from __future__ import annotations

import calendar
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from src.api.deps import get_current_user, get_db, require_roles
from src.api.dto import shipment_dto
from src.api.middleware import set_audit
from src.api.routers._schemas import ShipmentCalendarRow, ShipmentIn, ShipmentOut
from src.api.routers._shared import datetime_filters, lot_or_404, unprocessable
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import safe_float
from src.db.models import Lot, Shipment

router = APIRouter(tags=["G4 포장출하관리"])

_SORTABLE = {
    "shipped_at": Shipment.shipped_at,
    "customer": Shipment.customer,
    "quantity": Shipment.quantity,
}


@router.get("/shipments", response_model=Page[ShipmentOut],
            dependencies=[Depends(get_current_user)])
def list_shipments(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    customer: str | None = Query(None, description="고객사 부분 일치"),
    lot_id: str | None = Query(None, description="LOT ID 부분 일치 (ILIKE)"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    stmt = select(Shipment).options(joinedload(Shipment.lot))
    if customer:
        stmt = stmt.where(Shipment.customer.ilike(f"%{customer}%"))
    if lot_id:
        stmt = stmt.join(Lot, Lot.id == Shipment.lot_id).where(Lot.lot_id.ilike(f"%{lot_id}%"))
    for cond in datetime_filters(Shipment.shipped_at, date_from, date_to):
        stmt = stmt.where(cond)
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Shipment.shipped_at.desc()), Shipment.id.desc())
    return paginate(db, stmt, pg, shipment_dto)


@router.get("/shipments/calendar", response_model=list[ShipmentCalendarRow],
            dependencies=[Depends(get_current_user)])
def shipment_calendar(
    db: Session = Depends(get_db),
    month: str = Query(None, pattern=r"^\d{4}-\d{2}$", description='"YYYY-MM" (기본: 이번 달)'),
):
    """월 단위 집계 — 페이징하지 않는다 (§4.2 예외).

    출하가 없는 날은 **행을 만들지 않는다.** 0 으로 채우면 달력이 빈 날과
    0kg 출하일을 구분하지 못한다.
    """
    today = dt.date.today()
    month = month or f"{today.year:04d}-{today.month:02d}"
    year, mon = int(month[:4]), int(month[5:7])
    if not 1 <= mon <= 12:
        raise unprocessable("month 는 YYYY-MM 형식이어야 합니다")
    start = dt.datetime(year, mon, 1)
    end = dt.datetime(year, mon, calendar.monthrange(year, mon)[1]) + dt.timedelta(days=1)

    day = func.date(Shipment.shipped_at)
    rows = db.execute(
        select(day, func.count(Shipment.id), func.sum(Shipment.quantity))
        .where(Shipment.shipped_at >= start, Shipment.shipped_at < end)
        .group_by(day).order_by(day)
    ).all()
    return [
        {"date": d.isoformat(), "count": int(c), "quantity": safe_float(q, 2) or 0.0}
        for d, c, q in rows
    ]


@router.post("/shipments", response_model=ShipmentOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "sales"))])
def create_shipment(body: ShipmentIn, request: Request, db: Session = Depends(get_db)):
    """`lot_id` 가 `lots` 에 없으면 **404**."""
    lot = lot_or_404(db, body.lot_id)
    ship = Shipment(
        lot_id=lot.id,
        customer=body.customer,
        product=body.product,
        quantity=Decimal(f"{body.quantity:.2f}"),
        unit=body.unit,
    )
    db.add(ship)
    db.commit()
    db.refresh(ship)
    out = shipment_dto(ship, lot.lot_id)
    set_audit(request, target_id=ship.id, after=out)
    return out
