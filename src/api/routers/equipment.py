"""G5 설비 — FE-RT-22 (`api-contract.md` §8.6).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/equipment` | GET | 전 역할 R |
| `/equipment/{eq_id}` | GET | 전 역할 R |

* **실시간 모니터는 폴링이다.** WebSocket 을 쓰지 마라 — SF-TD2 에 설계가 없다.
  프론트가 `GET /equipment` 를 10초 간격으로 부른다 (NFR-P-01 ≤ 2초 안에 들어온다).
* **온도 경고는 API 가 판정한다.** `temp_warning = temperature > temp_warn_c` 를
  응답에 넣어 프론트가 255 를 하드코딩하지 않게 한다. 임계값은
  `system_settings.equipment.temp_warn_c` 에서 읽는다 (기본 255 — goal.md 2.3).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.api import settings_store
from src.api.deps import get_current_user, get_db
from src.api.dto import equipment_dto
from src.api.routers._schemas import EquipmentOut
from src.api.routers._shared import not_found
from src.api.schemas import Page, PageParams, paginate
from src.db.models import Equipment

router = APIRouter(tags=["G5 공정관리"])

_SORTABLE = {"eq_id": Equipment.eq_id, "name": Equipment.name,
             "status": Equipment.status, "updated_at": Equipment.updated_at}


def _temp_warn_c(db: Session) -> float:
    return float(settings_store.get(db, settings_store.K_TEMP_WARN, 255))


@router.get("/equipment", response_model=Page[EquipmentOut],
            dependencies=[Depends(get_current_user)])
def list_equipment(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    status: str | None = Query(None, description="normal|warning|error|maintenance"),
):
    warn = _temp_warn_c(db)
    stmt = select(Equipment)
    if status:
        stmt = stmt.where(Equipment.status == status)
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Equipment.eq_id.asc()))
    return paginate(db, stmt, pg, lambda eq: equipment_dto(eq, warn))


@router.get("/equipment/{eq_id}", response_model=EquipmentOut,
            dependencies=[Depends(get_current_user)])
def get_equipment(eq_id: str, db: Session = Depends(get_db)):
    eq = db.execute(select(Equipment).where(Equipment.eq_id == eq_id)).scalar_one_or_none()
    if eq is None:
        raise not_found(eq_id)
    return equipment_dto(eq, _temp_warn_c(db))
