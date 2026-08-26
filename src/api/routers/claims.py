"""G4 고객 클레임 — FE-RT-19 (`api-contract.md` §8.5·§8.5.1).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/claims` | GET | 전 역할 R |
| `/claims` | POST | admin·sales·quality W |
| `/claims/{claim_no}` | PATCH | admin·sales·quality W |
| `/claims/{claim_no}/history` | GET | **admin·sales·quality R** (벌거벗은 배열) |

`claim_no` 는 **서버가 채번**한다 — `CLM-` + 5자리 0패딩. 본문에 와도 무시한다.

상태 전이 그래프(`open→analyzing→resolved`)는 **UI 가드이지 API 검증이 아니다.**
서버가 강제하는 건 두 줄뿐이다:
  * `resolved`/`rejected` 로 보내면서 `resolution` 이 비었다 → **422**
  * `lot_id` 가 `lots` 에 없다 (POST) → **404**

`resolved_at` 은 **클라이언트 입력 금지** — 서버가 종결 진입 시 `NOW()`,
이탈 시 `NULL` 로 되돌린다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from src.api.deps import get_current_user, get_db, require_roles
from src.api.middleware import set_audit
from src.api.routers._schemas import (
    CLAIM_CLOSED_STATES,
    ClaimHistoryOut,
    ClaimIn,
    ClaimOut,
    ClaimPatch,
)
from src.api.routers._shared import lot_or_404, not_found
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import iso
from src.db.models import AuditLog, Claim, User
import datetime as dt

router = APIRouter(tags=["G4 포장출하관리"])

_SORTABLE = {
    "created_at": Claim.created_at,
    "claim_no": Claim.claim_no,
    "status": Claim.status,
    "customer": Claim.customer,
}

#: 이력에 노출하는 필드 — `ip_address` 는 절대 포함하지 않는다 (§8.5.1)
_HISTORY_FIELDS = ("status", "resolution")


def claim_dto(claim: Claim, lot_code: str | None = None) -> dict:
    return {
        "id": claim.id,
        "claim_no": claim.claim_no,
        "lot_id": lot_code if lot_code is not None else (claim.lot.lot_id if claim.lot else None),
        "customer": claim.customer,
        "reason": claim.reason,
        "status": claim.status,
        "resolution": claim.resolution,
        "resolved_at": iso(claim.resolved_at),
        "created_at": iso(claim.created_at),
    }


def _state(claim: Claim) -> dict:
    return {"status": claim.status, "resolution": claim.resolution}


def _next_claim_no(db: Session) -> str:
    last = db.execute(
        select(func.max(Claim.claim_no)).where(Claim.claim_no.like("CLM-%"))
    ).scalar_one_or_none()
    seq = 0
    if last:
        tail = last.rsplit("-", 1)[-1]
        seq = int(tail) if tail.isdigit() else 0
    return f"CLM-{seq + 1:05d}"


def _claim_or_404(db: Session, claim_no: str) -> Claim:
    claim = db.execute(
        select(Claim).options(joinedload(Claim.lot)).where(Claim.claim_no == claim_no)
    ).scalar_one_or_none()
    if claim is None:
        raise not_found(claim_no)
    return claim


@router.get("/claims", response_model=Page[ClaimOut], dependencies=[Depends(get_current_user)])
def list_claims(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    status: str | None = Query(None, description="open|analyzing|resolved|rejected"),
    customer: str | None = Query(None, description="고객사 부분 일치"),
):
    stmt = select(Claim).options(joinedload(Claim.lot))
    if status:
        stmt = stmt.where(Claim.status == status)
    if customer:
        stmt = stmt.where(Claim.customer.ilike(f"%{customer}%"))
    stmt = stmt.order_by(pg.parse_sort(_SORTABLE, Claim.created_at.desc()), Claim.id.desc())
    return paginate(db, stmt, pg, claim_dto)


@router.post("/claims", response_model=ClaimOut, status_code=201,
             dependencies=[Depends(require_roles("admin", "sales", "quality"))])
def create_claim(body: ClaimIn, request: Request, db: Session = Depends(get_db)):
    """접수. `claim_no` 채번 충돌은 **409** 이고 프론트가 1회 재시도한다 (§8.5.1)."""
    lot = lot_or_404(db, body.lot_id)
    claim = Claim(
        claim_no=_next_claim_no(db),
        lot_id=lot.id,
        customer=body.customer,
        reason=body.reason,
        status="open",
    )
    db.add(claim)
    db.commit()
    db.refresh(claim)
    # 이력의 첫 줄(접수)이 된다 — `/claims/{claim_no}/history` 는 audit_logs 를 읽는다
    set_audit(request, target_table="claims", target_id=claim.id, after=_state(claim))
    return claim_dto(claim, lot.lot_id)


@router.patch("/claims/{claim_no}", response_model=ClaimOut,
              dependencies=[Depends(require_roles("admin", "sales", "quality"))])
def patch_claim(
    claim_no: str, body: ClaimPatch, request: Request, db: Session = Depends(get_db)
):
    claim = _claim_or_404(db, claim_no)
    before = _state(claim)

    claim.status = body.status
    # **전송 안 함**과 **명시적 `null`** 을 구분한다.
    #
    # 초판은 `if body.resolution is not None` 이라 `{"resolution": null}` 을 보내면
    # **200 을 돌려주면서 아무것도 바꾸지 않았다** — 처리 내용을 지우려는 요청이
    # 성공한 것처럼 보이고 값은 그대로 남는 조용한 실패다 (QA-B DEF-B-04).
    # 종결 상태로 갈 때 `resolution` 이 비면 `ClaimPatch` 검증기가 이미 422 를 낸다.
    if "resolution" in body.model_fields_set:
        claim.resolution = body.resolution
    # 종결 진입 → NOW() / 종결 이탈 → NULL (클라이언트가 정하지 않는다)
    claim.resolved_at = dt.datetime.now() if body.status in CLAIM_CLOSED_STATES else None

    db.commit()
    db.refresh(claim)
    set_audit(request, target_table="claims", target_id=claim.id,
              before=before, after=_state(claim))
    return claim_dto(claim)


@router.get("/claims/{claim_no}/history", response_model=list[ClaimHistoryOut],
            dependencies=[Depends(require_roles("admin", "sales", "quality"))])
def claim_history(claim_no: str, db: Session = Depends(get_db)):
    """처리 이력 — **전용 테이블 없이 `audit_logs` 로 재구성한다** (§8.5.1).

    `PATCH /claims/{claim_no}` 가 감사 미들웨어를 통해 `{before, after}` JSONB 를
    남기므로 이력이 완전히 복원된다. **벌거벗은 배열**이며 `ip_address` 는 제외한다.
    `GET /audit-logs`(admin 전용)와 권한이 다르다 — 담당자가 자기 클레임 이력을
    못 보면 안 된다.
    """
    claim = _claim_or_404(db, claim_no)
    rows = db.execute(
        select(AuditLog, User.username)
        .outerjoin(User, User.id == AuditLog.user_id)
        .where(AuditLog.target_table == "claims", AuditLog.target_id == claim.id)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
    ).all()

    def _pick(value) -> dict | None:
        if not isinstance(value, dict):
            return None
        return {k: value.get(k) for k in _HISTORY_FIELDS}

    out = []
    for log, username in rows:
        detail = log.detail if isinstance(log.detail, dict) else {}
        out.append({
            "changed_at": iso(log.created_at),
            "changed_by_username": username,
            "before": _pick(detail.get("before")),
            "after": _pick(detail.get("after")),
        })
    return out
