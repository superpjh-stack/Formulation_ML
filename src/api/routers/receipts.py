"""G2 원재료 입고 — FE-RT-06·07 (`api-contract.md` §8.3·§8.3.1).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/receipts` | GET | 전 역할 R |
| `/receipts` | POST | admin·manufacture W |
| `/receipts/{receipt_no}` | PATCH | admin·manufacture·quality W |
| `/receipts/history` | GET | 전 역할 R |

`receipt_no` 는 **서버가 채번**한다 — `RCV-` + 5자리 0패딩 (`ts-types.md` §9.1).
요청 본문에 `receipt_no` 가 와도 무시한다.

⚠ **원재료 편차를 품질 편차로 해석하지 마라.** `material='Sn ingot'` 의 `sn_pct` 는
99% 대이고 배합 목표 62.0% 와의 차이는 품질 편차가 아니다. 편차 경고
(`deviation_warn`)는 **생산 LOT(`components`)에만** 적용한다 (§8.3.1).
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from src.api.deps import get_current_user, get_db, require_roles
from src.api.routers._schemas import ReceiptIn, ReceiptOut, ReceiptPatch
from src.api.routers._shared import date_filters, not_found, supplier_or_404
from src.api.middleware import set_audit
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import iso, safe_float
from src.db.models import Receipt, Supplier
from src.features.engineering import AG_TARGET, CU_TARGET, SN_TARGET

router = APIRouter(tags=["G2 입고관리"])

_SORTABLE = {
    "date": Receipt.date,
    "receipt_no": Receipt.receipt_no,
    "quantity": Receipt.quantity,
    "status": Receipt.status,
    "created_at": Receipt.created_at,
}


def receipt_dto(rc: Receipt, supplier_code: str | None = None) -> dict:
    """`ReceiptDto` — `ts-types.md` §9.1.

    `deviations` 는 **저장 컬럼이 아니라 응답 시점 계산**이다 (FR-R-03).
    sn/ag/cu 세 값이 모두 측정된 경우에만 채우고, 하나라도 없으면 `null` 이다
    (`ReceiptDto.deviations` 의 멤버가 non-nullable 이라 부분 계산이 불가능하다).
    원재료는 단일 원소 순도만 측정하는 것이 보통이므로 `null` 이 정상값이다.
    """
    sn, ag, cu = (safe_float(rc.sn_pct, 3), safe_float(rc.ag_pct, 3), safe_float(rc.cu_pct, 3))
    deviations = None
    if None not in (sn, ag, cu):
        deviations = {
            "sn": round(sn - SN_TARGET, 3),
            "ag": round(ag - AG_TARGET, 3),
            "cu": round(cu - CU_TARGET, 3),
        }
    return {
        "id": rc.id,
        "receipt_no": rc.receipt_no,
        "date": iso(rc.date),
        "supplier_code": supplier_code if supplier_code is not None
                         else (rc.supplier.code if rc.supplier else None),
        "material": rc.material,
        "quantity": safe_float(rc.quantity, 2),
        "unit": rc.unit,
        "status": rc.status,
        "sn_pct": sn, "ag_pct": ag, "cu_pct": cu,
        "pb_pct": safe_float(rc.pb_pct, 3),
        "analysis_method": rc.analysis_method,
        "deviations": deviations,
        "created_at": iso(rc.created_at),
    }


def _next_receipt_no(db: Session) -> str:
    """`RCV-00001` 다음 번호. 충돌 시 UK 가 막고 전역 핸들러가 **409** 를 낸다."""
    last = db.execute(
        select(func.max(Receipt.receipt_no)).where(Receipt.receipt_no.like("RCV-%"))
    ).scalar_one_or_none()
    seq = 0
    if last:
        tail = last.rsplit("-", 1)[-1]
        seq = int(tail) if tail.isdigit() else 0
    return f"RCV-{seq + 1:05d}"


def _filtered(stmt, *, status, supplier, material, date_from, date_to):
    if status:
        stmt = stmt.where(Receipt.status == status)
    if supplier:
        stmt = stmt.where(Receipt.supplier_id == select(Supplier.id)
                          .where(Supplier.code == supplier).scalar_subquery())
    if material:
        stmt = stmt.where(Receipt.material.ilike(f"%{material}%"))
    for cond in date_filters(Receipt.date, date_from, date_to):
        stmt = stmt.where(cond)
    return stmt


@router.get("/receipts", response_model=Page[ReceiptOut],
            dependencies=[Depends(get_current_user)])
def list_receipts(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    status: str | None = Query(None, description="accepted|rejected|inspecting"),
    supplier: str | None = Query(None, description="공급사 코드"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    """FE-RT-06 입고 현황."""
    stmt = _filtered(
        select(Receipt).options(joinedload(Receipt.supplier)),
        status=status, supplier=supplier, material=None,
        date_from=date_from, date_to=date_to,
    ).order_by(pg.parse_sort(_SORTABLE, Receipt.date.desc()), Receipt.id.desc())
    return paginate(db, stmt, pg, receipt_dto)


@router.get("/receipts/history", response_model=Page[ReceiptOut],
            dependencies=[Depends(get_current_user)])
def receipt_history(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    supplier: str | None = Query(None, description="공급사 코드"),
    material: str | None = Query(None, description="원재료명 부분 일치"),
    status: str | None = Query(None, description="accepted|rejected|inspecting"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    """FE-RT-07 입고 이력 — **성분 데이터 포함** (CR-DB-003 으로 해소된 필수 요구사항)."""
    stmt = _filtered(
        select(Receipt).options(joinedload(Receipt.supplier)),
        status=status, supplier=supplier, material=material,
        date_from=date_from, date_to=date_to,
    ).order_by(pg.parse_sort(_SORTABLE, Receipt.date.desc()), Receipt.id.desc())
    return paginate(db, stmt, pg, receipt_dto)


@router.post("/receipts", response_model=ReceiptOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "manufacture"))])
def create_receipt(body: ReceiptIn, request: Request, db: Session = Depends(get_db)):
    sup = supplier_or_404(db, body.supplier_code)
    rc = Receipt(
        receipt_no=_next_receipt_no(db),
        date=body.date,
        supplier_id=sup.id,
        material=body.material,
        quantity=Decimal(f"{body.quantity:.2f}"),
        unit=body.unit,
        status=body.status,
    )
    db.add(rc)
    db.commit()
    db.refresh(rc)
    out = receipt_dto(rc, sup.code)
    set_audit(request, target_id=rc.id, after=out)
    return out


@router.patch("/receipts/{receipt_no}", response_model=ReceiptOut,
              dependencies=[Depends(require_roles("admin", "manufacture", "quality"))])
def patch_receipt(
    receipt_no: str, body: ReceiptPatch, request: Request, db: Session = Depends(get_db)
):
    """검사 결과 입력 — 전달된 키만 갱신한다."""
    rc = db.execute(
        select(Receipt).options(joinedload(Receipt.supplier))
        .where(Receipt.receipt_no == receipt_no)
    ).scalar_one_or_none()
    if rc is None:
        raise not_found(receipt_no)

    before = receipt_dto(rc)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field.endswith("_pct") and value is not None:
            value = Decimal(f"{float(value):.3f}")
        setattr(rc, field, value)
    db.commit()
    db.refresh(rc)
    out = receipt_dto(rc)
    set_audit(request, target_id=rc.id, before=before, after=out)
    return out
