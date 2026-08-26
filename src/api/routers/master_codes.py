"""G7 기준정보관리 — FE-RT-30·31·32 (`api-contract.md` §8.8·§8.8.1).

3화면 모두 `master_codes` 테이블 하나로 처리한다 — `group_code` 로 가른다.

| 경로 | 메서드 | 권한 | `group_code` |
|---|---|---|---|
| `/master/quality-standards` | GET·POST·PATCH | 전 역할 R / admin·quality W | `QUALITY_STD` |
| `/master/work-standards` | GET·POST·PATCH | 전 역할 R / admin·manufacture W | `WORK_STD` |
| `/master/codes` | GET·POST·PATCH | 전 역할 R / **admin** W | 전체 |
| `/master/code-groups` | GET | 전 역할 R (벌거벗은 배열) | — |

### 개정 모델 (§8.8.1)
* `PATCH` 는 **`version+1` 새 행을 INSERT** 하고 이전 행을 `active=false` 로 내린다.
* `GET` 은 **활성 행만** 반환한다. 서버가 보장한다 —
  프론트가 클라이언트에서 최신 버전을 골라내는 방식으로 때우지 마라.
* `?active=false` 를 주면 비활성 이력까지 포함해서 조회한다.
* **`DELETE` 를 만들지 마라.** `PATCH {active:false}` 로 대체하고 버튼 라벨은 "비활성".
* 활성 중복은 DB 가 막는다 (`uq_master_codes_active_code` 부분 유니크 인덱스) → **409**.

### v1 한계 (계약이 명시한 것 — 숨기지 않는다)
* 작업표준의 **과거 리비전 조회 API 가 없다.** 개정 이력은 DB 에 쌓이지만
  `?version=` 필터가 없다. v1 게이트는 "현재 버전 표기 + 개정 시 자동 증가"까지다.
* `master_codes.active` 는 **BOOLEAN 2값**이라 화면의 3상태(적용중/검토중/폐기)를
  담을 수 없다. v1 은 2값(활성/비활성)으로 축소한다.
* 그룹 표시명 컬럼이 없다 → `group_code` 원문을 그대로 칩에 표시한다.
* 개정자(users FK) 컬럼이 없다 → `value.author` 는 자유 문자열이며 계정과 무관하다.
  개정자 추적이 필요하면 `audit_logs` 를 봐라.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.api.deps import get_current_user, get_db, require_roles
from src.api.middleware import set_audit
from src.api.routers._schemas import (
    MasterCodeGroupOut,
    MasterCodeIn,
    MasterCodeOut,
    MasterCodePatch,
    QualityStandardIn,
    QualityStandardPatch,
    WorkStandardIn,
    WorkStandardPatch,
)
from src.api.routers._shared import not_found
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import iso
from src.db.models import MasterCode

router = APIRouter(tags=["G7 기준정보관리"])

GROUP_QUALITY = "QUALITY_STD"
GROUP_WORK = "WORK_STD"

_SORTABLE = {
    "code": MasterCode.code,
    "name": MasterCode.name,
    "sort_order": MasterCode.sort_order,
    "created_at": MasterCode.created_at,
}


def master_dto(row: MasterCode) -> dict:
    return {
        "id": row.id,
        "group_code": row.group_code,
        "code": row.code,
        "name": row.name,
        "value": row.value,
        "sort_order": row.sort_order,
        "version": row.version,
        "active": bool(row.active),
        "created_at": iso(row.created_at),
    }


def _select(group_code: str | None, code: str | None, active: bool | None):
    stmt = select(MasterCode)
    if group_code:
        stmt = stmt.where(MasterCode.group_code == group_code)
    if code:
        stmt = stmt.where(MasterCode.code == code)
    # 기본은 활성 행만. `active=false` 는 "비활성 이력 포함" 이다 (§8.8.1).
    if active is not False:
        stmt = stmt.where(MasterCode.active.is_(True))
    return stmt


def _row_or_404(db: Session, row_id: int, group_code: str | None = None) -> MasterCode:
    row = db.get(MasterCode, row_id)
    if row is None or (group_code and row.group_code != group_code):
        raise not_found(f"기준정보 {row_id}")
    return row


def _next_version(db: Session, group_code: str, code: str) -> int:
    current = db.execute(
        select(func.max(MasterCode.version))
        .where(MasterCode.group_code == group_code, MasterCode.code == code)
    ).scalar_one_or_none()
    return int(current or 0) + 1


def _revise(db: Session, row: MasterCode, updates: dict[str, Any],
            active: bool | None) -> MasterCode:
    """개정 — `version+1` 새 행을 만들고 이전 행을 내린다 (§8.8.1).

    `active=false` 만 보내면 **비활성 처리**이고 새 행을 만들지 않는다
    (`DELETE` 를 대신하는 경로다).
    """
    if active is False:
        row.active = False
        return row
    if not updates:
        if active is True and not row.active:
            row.active = True     # 재활성. 활성 중복이면 DB 가 막아 409 가 된다
        return row

    row.active = False
    db.flush()                    # 부분 유니크 인덱스는 즉시 검사된다 — 먼저 내린다
    new = MasterCode(
        group_code=row.group_code,
        code=row.code,
        name=updates.get("name", row.name),
        value=updates.get("value", row.value),
        sort_order=updates.get("sort_order", row.sort_order),
        version=_next_version(db, row.group_code, row.code),
        active=True,
    )
    db.add(new)
    return new


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-30 품질 기준 — group_code='QUALITY_STD'
#   value JSONB = {sn_min, sn_max, ag_min, ag_max, cu_min, cu_max,
#                  pb_min, pb_max, pass_score}  (`ts-types.md` §9.7)
# ══════════════════════════════════════════════════════════════════════════
@router.get("/master/quality-standards", response_model=Page[MasterCodeOut],
            dependencies=[Depends(get_current_user)])
def list_quality_standards(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    product_code: str | None = Query(None),
    active: bool | None = Query(None, description="false 를 주면 비활성 이력 포함"),
):
    stmt = _select(GROUP_QUALITY, product_code, active).order_by(
        pg.parse_sort(_SORTABLE, MasterCode.code.asc()), MasterCode.version.desc()
    )
    return paginate(db, stmt, pg, master_dto)


@router.post("/master/quality-standards", response_model=MasterCodeOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "quality"))])
def create_quality_standard(
    body: QualityStandardIn, request: Request, db: Session = Depends(get_db)
):
    """활성 코드 중복은 **409** (`uq_master_codes_active_code`)."""
    row = MasterCode(
        group_code=GROUP_QUALITY,
        code=body.product_code,
        name=f"{body.product_code} 품질 기준",   # name 은 NOT NULL 인데 계약 본문에 없다
        value=body.model_dump(exclude={"product_code"}),
        sort_order=0,
        version=_next_version(db, GROUP_QUALITY, body.product_code),
        active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    out = master_dto(row)
    set_audit(request, target_table="master_codes", target_id=row.id, after=out)
    return out


@router.patch("/master/quality-standards/{row_id}", response_model=MasterCodeOut,
              dependencies=[Depends(require_roles("admin", "quality"))])
def patch_quality_standard(
    row_id: int, body: QualityStandardPatch, request: Request, db: Session = Depends(get_db)
):
    row = _row_or_404(db, row_id, GROUP_QUALITY)
    before = master_dto(row)
    changes = body.model_dump(exclude_unset=True)
    active = changes.pop("active", None)
    updates: dict[str, Any] = {}
    if changes:
        updates["value"] = {**(row.value or {}), **changes}
    result = _revise(db, row, updates, active)
    db.commit()
    db.refresh(result)
    out = master_dto(result)
    set_audit(request, target_table="master_codes", target_id=result.id,
              before=before, after=out)
    return out


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-31 작업 표준 — group_code='WORK_STD'
#   process_code → code · title → name · content → value.content
#   **버전은 개정 시 서버가 자동 증가**시킨다 (§8.8)
# ══════════════════════════════════════════════════════════════════════════
@router.get("/master/work-standards", response_model=Page[MasterCodeOut],
            dependencies=[Depends(get_current_user)])
def list_work_standards(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    process_code: str | None = Query(None),
    active: bool | None = Query(None, description="false 를 주면 비활성 이력 포함"),
):
    stmt = _select(GROUP_WORK, process_code, active).order_by(
        pg.parse_sort(_SORTABLE, MasterCode.code.asc()), MasterCode.version.desc()
    )
    return paginate(db, stmt, pg, master_dto)


@router.post("/master/work-standards", response_model=MasterCodeOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "manufacture"))])
def create_work_standard(
    body: WorkStandardIn, request: Request, db: Session = Depends(get_db)
):
    value: dict[str, Any] = {"content": body.content}
    if body.author is not None:
        value["author"] = body.author
    row = MasterCode(
        group_code=GROUP_WORK,
        code=body.process_code,
        name=body.title,
        value=value,
        sort_order=0,
        version=max(body.version, _next_version(db, GROUP_WORK, body.process_code)),
        active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    out = master_dto(row)
    set_audit(request, target_table="master_codes", target_id=row.id, after=out)
    return out


@router.patch("/master/work-standards/{row_id}", response_model=MasterCodeOut,
              dependencies=[Depends(require_roles("admin", "manufacture"))])
def patch_work_standard(
    row_id: int, body: WorkStandardPatch, request: Request, db: Session = Depends(get_db)
):
    """개정 — 새 버전 행이 생기고 `version` 이 1 증가한다."""
    row = _row_or_404(db, row_id, GROUP_WORK)
    before = master_dto(row)
    changes = body.model_dump(exclude_unset=True)
    active = changes.pop("active", None)

    updates: dict[str, Any] = {}
    if "title" in changes:
        updates["name"] = changes.pop("title")
    if changes:
        updates["value"] = {**(row.value or {}), **changes}

    result = _revise(db, row, updates, active)
    db.commit()
    db.refresh(result)
    out = master_dto(result)
    set_audit(request, target_table="master_codes", target_id=result.id,
              before=before, after=out)
    return out


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-32 코드 관리 — 전 그룹. **쓰기는 admin 전용**
# ══════════════════════════════════════════════════════════════════════════
@router.get("/master/codes", response_model=Page[MasterCodeOut],
            dependencies=[Depends(get_current_user)])
def list_codes(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    group_code: str | None = Query(None),
    active: bool | None = Query(None, description="false 를 주면 비활성 이력 포함"),
    q: str | None = Query(None, description="코드·명칭 부분 일치 검색 (대소문자 무시)"),
):
    """`q` 는 **서버에서** 거른다.

    초판에는 검색 파라미터가 없어 화면이 현재 페이지 안에서만 필터했다.
    그래서 100건 중 2페이지에 있는 코드를 검색하면 **실재하는데도
    "검색 결과가 없습니다"** 가 떴다 (QA-C DEF-C-04). 페이징과 검색을
    클라이언트에서 섞으면 데이터가 늘수록 계속 깨진다.
    """
    stmt = _select(group_code, None, active)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(MasterCode.code.ilike(like) | MasterCode.name.ilike(like))
    stmt = stmt.order_by(
        pg.parse_sort(_SORTABLE, MasterCode.group_code.asc()),
        MasterCode.sort_order.asc(), MasterCode.code.asc(),
    )
    return paginate(db, stmt, pg, master_dto)


@router.get("/master/code-groups", response_model=list[MasterCodeGroupOut],
            dependencies=[Depends(get_current_user)])
def list_code_groups(db: Session = Depends(get_db)):
    """그룹별 활성 코드 수 — **벌거벗은 배열** (§4.2 예외)."""
    rows = db.execute(
        select(MasterCode.group_code, func.count(MasterCode.id))
        .where(MasterCode.active.is_(True))
        .group_by(MasterCode.group_code)
        .order_by(MasterCode.group_code)
    ).all()
    return [{"group_code": g, "count": int(c)} for g, c in rows]


@router.post("/master/codes", response_model=MasterCodeOut, status_code=201,
             dependencies=[Depends(require_roles("admin"))])
def create_code(body: MasterCodeIn, request: Request, db: Session = Depends(get_db)):
    row = MasterCode(
        group_code=body.group_code,
        code=body.code,
        name=body.name,
        value=None,
        sort_order=body.sort_order,
        version=_next_version(db, body.group_code, body.code),
        active=True,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    out = master_dto(row)
    set_audit(request, target_table="master_codes", target_id=row.id, after=out)
    return out


@router.patch("/master/codes/{row_id}", response_model=MasterCodeOut,
              dependencies=[Depends(require_roles("admin"))])
def patch_code(
    row_id: int, body: MasterCodePatch, request: Request, db: Session = Depends(get_db)
):
    row = _row_or_404(db, row_id)
    before = master_dto(row)
    changes = body.model_dump(exclude_unset=True)
    active = changes.pop("active", None)
    result = _revise(db, row, changes, active)
    db.commit()
    db.refresh(result)
    out = master_dto(result)
    set_audit(request, target_table="master_codes", target_id=result.id,
              before=before, after=out)
    return out
