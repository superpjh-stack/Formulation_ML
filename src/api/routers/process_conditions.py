"""G5 공정 조건 · 변경 이력 — FE-RT-23·24 (`api-contract.md` §8.6·§8.6.1).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/process/conditions` | GET | 전 역할 R |
| `/process/conditions` | POST | admin·manufacture W |
| `/process/conditions/{id}` | PATCH | admin·manufacture W |
| `/process/history` | GET | 전 역할 R (**판별 유니온**) |

> ⚠ **`condition_history` 쓰기는 §6.1 "감사는 미들웨어 한 곳" 규칙의 예외다.**
> `condition_history` 는 `audit_logs` 와 다른 테이블이라 감사 미들웨어가 쓸 수 없다.
> → `POST`/`PATCH /process/conditions` 라우터가 **명시적으로** 행을 만든다.
> **이 예외는 `condition_history` 하나뿐이다.**

### 개정 모델 — 같은 행의 `version` 을 올린다
`master_codes` 는 새 버전 행을 쌓지만(§8.8.1) `process_conditions` 는 그렇게 하지 않는다.
FE-RT-23 의 `[이력 보기]` 가 `?condition_id=` 로 이력을 여는데(§8.6.1), 개정할 때마다
새 `id` 를 만들면 **그 진입 경로가 개정 시점마다 끊긴다.** 과거 값은
`condition_history` 가 보존하므로 행을 쌓을 이유가 없다.
`db-schema.md` §6.5 의 "version — 개정 시 증가"도 그대로 만족한다.

> ⚠ `/process/performance` 와 `/process/analysis` 는 **집계 API 라 개발2 담당**이다.
> 같은 `/process` 접두사를 쓰는 별도 라우터로 붙는다 — 경로가 겹치지 않는다.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.api.deps import get_current_user, get_db, require_roles
from src.api.middleware import set_audit
from src.api.routers._schemas import (
    ProcessConditionIn,
    ProcessConditionOut,
    ProcessConditionPatch,
    ProcessHistoryOut,
)
from src.api.routers._shared import datetime_filters, not_found
from src.api.schemas import Page, PageParams, page_of, paginate
from src.api.serialization import iso, safe_float
from src.db.models import Alert, ConditionHistory, Lot, ProcessCondition, User

router = APIRouter(tags=["G5 공정관리"])

_SORTABLE = {
    "product_code": ProcessCondition.product_code,
    "version": ProcessCondition.version,
    "created_at": ProcessCondition.created_at,
}


def condition_dto(cond: ProcessCondition) -> dict:
    return {
        "id": cond.id,
        "product_code": cond.product_code,
        "temp_min": safe_float(cond.temp_min, 1),
        "temp_max": safe_float(cond.temp_max, 1),
        "time_min": cond.time_min,
        "time_max": cond.time_max,
        "speed": safe_float(cond.speed, 2),
        "version": cond.version,
        "active": bool(cond.active),
        "created_at": iso(cond.created_at),
    }


def _snapshot(cond: ProcessCondition) -> dict:
    """`condition_history.before/after` JSONB 에 넣을 값 (JSON 안전)."""
    snap = condition_dto(cond)
    snap.pop("created_at", None)
    return snap


@router.get("/process/conditions", response_model=Page[ProcessConditionOut],
            dependencies=[Depends(get_current_user)])
def list_conditions(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    product_code: str | None = Query(None),
    active: bool | None = Query(None, description="생략하면 전체"),
):
    stmt = select(ProcessCondition)
    if product_code:
        stmt = stmt.where(ProcessCondition.product_code == product_code)
    if active is not None:
        stmt = stmt.where(ProcessCondition.active.is_(active))
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, ProcessCondition.product_code.asc()),
                         ProcessCondition.version.desc())
    return paginate(db, stmt, pg, condition_dto)


@router.post("/process/conditions", response_model=ProcessConditionOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "manufacture"))])
def create_condition(
    body: ProcessConditionIn,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """신규 등록. `(product_code, version)` 중복은 **409**.

    `condition_history` 에 `before=null` (신규 등록) 행을 함께 만든다.
    """
    cond = ProcessCondition(
        product_code=body.product_code,
        temp_min=Decimal(f"{body.temp_min:.1f}"),
        temp_max=Decimal(f"{body.temp_max:.1f}"),
        time_min=body.time_min,
        time_max=body.time_max,
        speed=None if body.speed is None else Decimal(f"{body.speed:.2f}"),
        version=1,
        active=body.active,
    )
    db.add(cond)
    db.flush()
    db.add(ConditionHistory(condition_id=cond.id, changed_by=user.id,
                            before=None, after=_snapshot(cond)))
    db.commit()
    db.refresh(cond)
    out = condition_dto(cond)
    set_audit(request, target_table="process_conditions", target_id=cond.id, after=out)
    return out


@router.patch("/process/conditions/{condition_id}", response_model=ProcessConditionOut,
              dependencies=[Depends(require_roles("admin", "manufacture"))])
def patch_condition(
    condition_id: int,
    body: ProcessConditionPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """개정 — 전달된 키만 갱신하고 **`version` 을 1 올린다.**

    `product_code` 는 변경할 수 없다 (`ts-types.md` §9.3).
    변경 전/후 스냅샷을 `condition_history` 에 남긴다.
    """
    cond = db.get(ProcessCondition, condition_id)
    if cond is None:
        raise not_found(f"공정 조건 {condition_id}")

    before = _snapshot(cond)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in ("temp_min", "temp_max") and value is not None:
            value = Decimal(f"{float(value):.1f}")
        elif field == "speed" and value is not None:
            value = Decimal(f"{float(value):.2f}")
        setattr(cond, field, value)
    if cond.temp_min > cond.temp_max or cond.time_min > cond.time_max:
        from src.api.routers._shared import unprocessable
        raise unprocessable("하한이 상한보다 클 수 없습니다")
    if changes:
        cond.version += 1

    db.add(ConditionHistory(condition_id=cond.id, changed_by=user.id,
                            before=before, after=_snapshot(cond)))
    db.commit()
    db.refresh(cond)
    out = condition_dto(cond)
    set_audit(request, target_table="process_conditions", target_id=cond.id,
              before=before, after=out)
    return out


@router.get("/process/history", response_model=Page[ProcessHistoryOut],
            dependencies=[Depends(get_current_user)])
def process_history(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    kind: str = Query("condition", pattern="^(condition|alarm)$"),
    condition_id: int | None = Query(None, description="kind=condition — FE-RT-23 [이력 보기]"),
    product_code: str | None = Query(None, description="kind=condition"),
    level: str | None = Query(None, description="kind=alarm — info|warning|critical"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    """**판별 유니온**이다 — 응답의 `kind` 로 종류를 알려준다 (§8.6.1).

    프론트가 자기가 보낸 `kind` 쿼리를 기억해서 해석하면 탭을 빠르게 전환할 때
    이전 요청의 응답이 새 탭 기준으로 렌더된다.

    | `kind` | 원천 |
    |---|---|
    | `condition` (기본) | `condition_history` + `process_conditions` + `users` |
    | `alarm` | `alerts WHERE source='equipment'` |

    ⚠ `ip_address` 를 이 응답에 절대 포함하지 마라 — 감사 정보는 `admin` 전용
    `GET /audit-logs` 소관이다.
    """
    if kind == "alarm":
        stmt = (
            select(Alert, Lot.lot_id)
            .outerjoin(Lot, Lot.id == Alert.lot_id)
            .where(Alert.source == "equipment")
        )
        if level:
            stmt = stmt.where(Alert.level == level)
        for cond in datetime_filters(Alert.created_at, date_from, date_to):
            stmt = stmt.where(cond)
        stmt = stmt.order_by(Alert.created_at.desc(), Alert.id.desc())
        total = _count(db, stmt)
        rows = db.execute(stmt.limit(pg.page_size).offset(pg.offset)).all()
        items = [{
            "kind": "alarm",
            "id": alert.id,
            "created_at": iso(alert.created_at),
            "level": alert.level,
            "message": alert.message,
            "lot_id": lot_code,
            "resolved": bool(alert.resolved),
            "resolved_at": iso(alert.resolved_at),
        } for alert, lot_code in rows]
        return page_of(items, total, pg)

    stmt = (
        select(ConditionHistory, ProcessCondition.product_code, User.username)
        .join(ProcessCondition, ProcessCondition.id == ConditionHistory.condition_id)
        .outerjoin(User, User.id == ConditionHistory.changed_by)
    )
    if condition_id is not None:
        stmt = stmt.where(ConditionHistory.condition_id == condition_id)
    if product_code:
        stmt = stmt.where(ProcessCondition.product_code == product_code)
    for cond in datetime_filters(ConditionHistory.created_at, date_from, date_to):
        stmt = stmt.where(cond)
    stmt = stmt.order_by(ConditionHistory.created_at.desc(), ConditionHistory.id.desc())

    total = _count(db, stmt)
    rows = db.execute(stmt.limit(pg.page_size).offset(pg.offset)).all()
    items = [{
        "kind": "condition",
        "id": hist.id,
        "created_at": iso(hist.created_at),
        "condition_id": hist.condition_id,
        "product_code": code,
        "changed_by_username": username,
        "before": hist.before,
        "after": hist.after,
    } for hist, code, username in rows]
    return page_of(items, total, pg)


def _count(db: Session, stmt) -> int:
    from sqlalchemy import func

    return int(db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one())
