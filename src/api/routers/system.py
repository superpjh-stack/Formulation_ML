"""G6 — 사용자/시스템관리 (`api-contract.md` §8.7).

| 경로 | 메서드 | 화면 | 권한 |
|---|---|---|---|
| `/users` | GET·POST | FE-RT-26 | **admin** (GET 조차 admin — `viewer` 도 403) |
| `/users/{id}` | PATCH·DELETE | FE-RT-26 | **admin** |
| `/audit-logs` | GET | FE-RT-27 시스템 로그 | **admin** |
| `/notification-rules` | GET·PUT | FE-RT-28 알림 설정 | **admin** |
| `/settings` | GET·PUT | FE-RT-29 시스템 설정 | **admin** |

> ⚠ `/users` 와 `/audit-logs` 는 GET 조차 `admin` 전용이다. 다른 그룹의 "전 역할 R"
> 규칙이 여기엔 적용되지 않는다 — 개인정보·감사 기록이기 때문이다.
> `UserOut` 에 **`password_hash` 를 절대 포함하지 마라.**
"""
from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from src.api import settings_store
from src.api.deps import USER_ROLES, get_db, hash_password, require_roles
from src.api.dto import audit_log_dto, user_dto
from src.api.middleware import AUDIT_ACTIONS, set_audit
from src.api.schemas import PageParams, page_of, paginate
from src.db.models import AuditLog, NotificationRule, User

router = APIRouter(tags=["G6 사용자·시스템관리"])

#: `api-contract.md` §8.7.1 — 산출물에 비밀번호 정책 정의가 없다.
#: **8자 이상만 강제한다** (기획2 판단). 복잡도·만료·재사용 금지는 근거가 없으므로 만들지 마라.
MIN_PASSWORD_LENGTH = 8

RoleLiteral = Literal["admin", "manufacture", "quality", "sales", "viewer"]

#: `users.email VARCHAR(100)`.
#: ⚠ **`pydantic.EmailStr` 을 쓰지 마라.** `email_validator` 가 `.local` 을
#: "special-use or reserved name" 으로 **거부**한다. 사내 도메인이 `koryosolder.local`
#: 이고 시드 계정 8개가 전부 이 도메인이라, `EmailStr` 을 쓰면 사용자 생성·수정이
#: 전부 422 가 된다. 산출물에 이메일 형식 요구가 없으므로 최소 형식만 본다.
_EMAIL_RE = __import__("re").compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_email(value: str) -> str:
    if not _EMAIL_RE.match(value):
        raise ValueError("올바른 이메일 형식이 아닙니다")
    return value


# ══════════════════════════════════════════════════════════════════════════
# 사용자 관리 — FE-RT-26
# ══════════════════════════════════════════════════════════════════════════
class UserIn(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    email: str = Field(..., max_length=100)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=200)
    role: RoleLiteral = "viewer"

    _check_email = field_validator("email")(_validate_email)


class UserPatch(BaseModel):
    email: str | None = Field(None, max_length=100)
    role: RoleLiteral | None = None
    active: bool | None = None
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=200)

    @field_validator("email")
    @classmethod
    def _check_email(cls, v):
        return _validate_email(v) if v is not None else v


def _active_admin_count(db: Session, exclude_id: int | None = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == "admin", User.active.is_(True))
    if exclude_id is not None:
        stmt = stmt.where(User.id != exclude_id)
    return int(db.execute(stmt).scalar_one() or 0)


def _guard_last_admin(db: Session, target: User) -> None:
    """마지막 `admin` 의 삭제·비활성화·강등을 막는다 → **422** (§8.7.1)."""
    if target.role == "admin" and target.active and _active_admin_count(db, exclude_id=target.id) == 0:
        raise HTTPException(status_code=422, detail="마지막 관리자 계정은 변경할 수 없습니다")


def _guard_self(actor: User, target: User) -> None:
    """본인 계정의 역할 변경·비활성화·삭제를 막는다 → **422** (§8.7.1)."""
    if actor.id == target.id:
        raise HTTPException(status_code=422, detail="본인 계정은 변경할 수 없습니다")


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail=f"사용자 {user_id} 을(를) 찾을 수 없습니다")
    return user


@router.get("/users", summary="FE-RT-26 사용자 목록 (admin)")
def list_users(
    pg: PageParams = Depends(),
    role: RoleLiteral | None = Query(None),
    active: bool | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    stmt = select(User)
    if role is not None:
        stmt = stmt.where(User.role == role)
    if active is not None:
        stmt = stmt.where(User.active.is_(active))
    order = pg.parse_sort(
        {"username": User.username, "role": User.role, "created_at": User.created_at,
         "last_login": User.last_login},
        default=User.id.asc(),
    )
    return paginate(db, stmt.order_by(order), pg, user_dto)


@router.post("/users", status_code=201, summary="FE-RT-26 사용자 생성 (admin)")
def create_user(
    body: UserIn,
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """`username`/`email` 중복은 **409** — 전역 `IntegrityError` 핸들러가 변환한다."""
    user = User(
        username=body.username,
        email=str(body.email),
        password_hash=hash_password(body.password),
        role=body.role,
        active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    # detail 에 비밀번호를 넣지 않는다 (§6.3)
    set_audit(request, target_table="users", target_id=user.id,
              after={"username": user.username, "email": user.email, "role": user.role})
    return user_dto(user)


@router.patch("/users/{user_id}", summary="FE-RT-26 사용자 수정 (admin)")
def patch_user(
    user_id: int,
    body: UserPatch,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("admin")),
):
    target = _get_user_or_404(db, user_id)
    changes = body.model_dump(exclude_unset=True)

    # 역할 변경·비활성화는 본인/마지막 admin 보호 대상이다.
    # 이메일·비밀번호 변경은 본인도 할 수 있다.
    if "role" in changes and changes["role"] != target.role:
        _guard_self(actor, target)
        if target.role == "admin":
            _guard_last_admin(db, target)
    if "active" in changes and changes["active"] is False and target.active:
        _guard_self(actor, target)
        _guard_last_admin(db, target)

    before = {"email": target.email, "role": target.role, "active": target.active}

    if "email" in changes:
        target.email = str(changes["email"])
    if "role" in changes:
        target.role = changes["role"]
    if "active" in changes:
        target.active = bool(changes["active"])
    if changes.get("password"):
        target.password_hash = hash_password(changes["password"])

    db.commit()
    db.refresh(target)
    set_audit(request, target_table="users", target_id=target.id, before=before,
              after={"email": target.email, "role": target.role, "active": target.active})
    return user_dto(target)


@router.delete("/users/{user_id}", status_code=204, summary="FE-RT-26 사용자 비활성 (admin)")
def delete_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("admin")),
):
    """**소프트 삭제다** — `active=false` 로 바꾸고 행은 지우지 않는다 (§8.7.1).

    하드 삭제하면 `audit_logs.user_id` 가 `ON DELETE SET NULL` 되어 "누가 했는지"가
    영구히 사라진다. NFR-S-04 가 요구하는 건 로그의 존재가 아니라 **추적 가능성**이다.
    """
    target = _get_user_or_404(db, user_id)
    _guard_self(actor, target)
    _guard_last_admin(db, target)

    before = {"active": target.active}
    target.active = False
    db.commit()
    set_audit(request, target_table="users", target_id=target.id,
              before=before, after={"active": False, "soft_delete": True})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ══════════════════════════════════════════════════════════════════════════
# 시스템 로그 — FE-RT-27
# ══════════════════════════════════════════════════════════════════════════
@router.get("/audit-logs", summary="FE-RT-27 감사로그 조회 (admin)")
def list_audit_logs(
    pg: PageParams = Depends(),
    user_id: int | None = Query(None),
    action: str | None = Query(None, description="|".join(AUDIT_ACTIONS)),
    date_from: dt.date | None = Query(None),
    date_to: dt.date | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    stmt = select(AuditLog).options(selectinload(AuditLog.user))
    if user_id is not None:
        stmt = stmt.where(AuditLog.user_id == user_id)
    if action:
        if action not in AUDIT_ACTIONS:
            raise HTTPException(status_code=422, detail=f"action 은 {list(AUDIT_ACTIONS)} 중 하나여야 합니다")
        stmt = stmt.where(AuditLog.action == action)
    if date_from is not None:
        stmt = stmt.where(AuditLog.created_at >= dt.datetime.combine(date_from, dt.time.min))
    if date_to is not None:
        stmt = stmt.where(AuditLog.created_at <= dt.datetime.combine(date_to, dt.time.max))
    return paginate(db, stmt.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()),
                    pg, audit_log_dto)


# ══════════════════════════════════════════════════════════════════════════
# 알림 설정 — FE-RT-28
# ══════════════════════════════════════════════════════════════════════════
EVENT_TYPES = ("quality_fail", "deviation_exceed", "equipment_warning")
CHANNELS = ("email", "system")
NOTIFICATION_ROW_COUNT = len(EVENT_TYPES) * len(CHANNELS)   # 6


class NotificationRuleIn(BaseModel):
    event_type: Literal["quality_fail", "deviation_exceed", "equipment_warning"]
    threshold: float | None = None      # v1 미사용 — 생략하거나 null
    channel: Literal["email", "system"]
    enabled: bool = True


def _rule_dto(rule: NotificationRule) -> dict:
    from src.api.serialization import safe_float
    return {
        "event_type": rule.event_type,
        "threshold": safe_float(rule.threshold, 3),
        "channel": rule.channel,
        "enabled": bool(rule.enabled),
    }


def _fetch_rules(db: Session) -> list[dict]:
    rows = db.execute(
        select(NotificationRule).order_by(NotificationRule.event_type, NotificationRule.channel)
    ).scalars().all()
    if rows:
        return [_rule_dto(r) for r in rows]
    # 행이 하나도 없으면 기본 6행(전부 비활성)을 **응답으로만** 만들어 낸다.
    # DB 에 쓰지는 않는다 — 시드는 개발1 담당이다.
    return [
        {"event_type": e, "threshold": None, "channel": c, "enabled": False}
        for e in EVENT_TYPES for c in CHANNELS
    ]


@router.get("/notification-rules", summary="FE-RT-28 알림 규칙 (admin)")
def list_notification_rules(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """**벌거벗은 배열** — 6행 고정이라 페이징 대상이 아니다 (§4.2 예외)."""
    return _fetch_rules(db)


@router.put("/notification-rules", summary="FE-RT-28 알림 규칙 전체 교체 (admin)")
def replace_notification_rules(
    body: list[NotificationRuleIn],
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """**전체 교체다** — 의도된 예외다 (§8.7).

    6행(이벤트 3종 × 채널 2종) **전부**를 보낸다. 바뀐 행만 보내면 나머지가 삭제된다.
    행 수가 6이 아니거나 조합이 중복이면 **409** (`uq_notification_rules_event_channel`).
    `threshold` 는 v1 미사용 — 생략하거나 `null` 로 보낸다.
    """
    keys = [(r.event_type, r.channel) for r in body]
    if len(body) != NOTIFICATION_ROW_COUNT:
        raise HTTPException(
            status_code=409,
            detail=f"알림 규칙은 {NOTIFICATION_ROW_COUNT}행 전체를 보내야 합니다 (받은 행: {len(body)})",
        )
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=409, detail="중복된 값입니다 (event_type+channel)")

    existing = {
        (r.event_type, r.channel): r
        for r in db.execute(select(NotificationRule)).scalars().all()
    }
    before = [_rule_dto(r) for r in existing.values()]

    for item in body:
        key = (item.event_type, item.channel)
        row = existing.pop(key, None)
        if row is None:
            db.add(NotificationRule(
                event_type=item.event_type, channel=item.channel,
                threshold=item.threshold, enabled=item.enabled,
            ))
        else:
            row.threshold = item.threshold
            row.enabled = item.enabled
    for orphan in existing.values():   # 페이로드에 없는 행은 지운다 (전체 교체)
        db.delete(orphan)

    db.commit()
    result = _fetch_rules(db)
    set_audit(request, target_table="notification_rules", before=before, after=result)
    return result


# ══════════════════════════════════════════════════════════════════════════
# 시스템 설정 — FE-RT-29
# ══════════════════════════════════════════════════════════════════════════
class DeviationWarnIn(BaseModel):
    sn: float = Field(..., gt=0)
    ag: float = Field(..., gt=0)
    cu: float = Field(..., gt=0)


class SystemSettingsPatch(BaseModel):
    """`ts-types.md` §9.6 `SystemSettingsPatch` 와 1:1.

    **목표값 3종(`sn_target`/`ag_target`/`cu_target`)은 타입에 없다.**
    보내면 아래 `_reject_targets` 가 **422** 로 막는다.
    """
    model_config = {"extra": "allow"}   # 목표값이 오는지 보려면 받아야 한다

    quality_pass_score: int | None = Field(None, ge=0, le=100)
    temp_warn_c: float | None = Field(None, gt=0, lt=1000)
    deviation_warn: DeviationWarnIn | None = None

    @field_validator("quality_pass_score")
    @classmethod
    def _range(cls, v):
        # 범위: 0~100 정수. 밖이면 422 (§8.7.2)
        return v


_TARGET_KEYS = ("sn_target", "ag_target", "cu_target")
_ALLOWED_PATCH_KEYS = {"quality_pass_score", "temp_warn_c", "deviation_warn"}


@router.get("/settings", summary="FE-RT-29 시스템 설정 (admin)")
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """`integration.*` 는 **반환하지 않는다** (§8.7 네임스페이스 경계).

    두 화면이 같은 키를 편집하면 서로의 변경을 덮어쓴다.
    비관리자가 쓸 값은 `GET /settings/public` 이다 (§8.1.1).
    """
    return settings_store.admin_settings(db)


@router.put("/settings", summary="FE-RT-29 시스템 설정 부분 갱신 (admin)")
def put_settings(
    body: SystemSettingsPatch,
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("admin")),
):
    """**부분 갱신이다.** 전달된 키만 `UPDATE` 한다 (§8.7).

    `system_settings` 전체를 replace 하면 `/integrations` 가 관리하는
    `integration.*` 키가 날아간다.

    🔴 **목표값 3종은 v1 에서 변경 불가다 → 422.**
    학습된 4개 모델의 파생 피처(`sn_deviation` 등)가 62.0/3.0/0.5 기준으로 굳어 있어
    런타임에 바꾸면 모델이 전부 무효가 된다. §8.4.5 에서 재학습 트리거를 만들지
    않기로 했으므로 "재학습과 묶어서만 허용"의 전제가 성립하지 않는다.
    """
    raw = body.model_dump(exclude_unset=True)

    offending = [k for k in _TARGET_KEYS if k in raw]
    if offending:
        raise HTTPException(
            status_code=422,
            detail="목표값은 모델 재학습을 통해서만 변경할 수 있습니다",
        )
    unknown = set(raw) - _ALLOWED_PATCH_KEYS
    if unknown:
        raise HTTPException(status_code=422, detail=f"변경할 수 없는 설정 키: {sorted(unknown)}")

    before = settings_store.admin_settings(db)

    if "quality_pass_score" in raw and raw["quality_pass_score"] is not None:
        settings_store.upsert(db, settings_store.K_PASS_SCORE,
                              int(raw["quality_pass_score"]), updated_by=actor.id)
    if "temp_warn_c" in raw and raw["temp_warn_c"] is not None:
        settings_store.upsert(db, settings_store.K_TEMP_WARN,
                              float(raw["temp_warn_c"]), updated_by=actor.id)
    if raw.get("deviation_warn") is not None:
        dev = raw["deviation_warn"]
        settings_store.upsert(db, settings_store.K_DEV_SN, float(dev["sn"]), updated_by=actor.id)
        settings_store.upsert(db, settings_store.K_DEV_AG, float(dev["ag"]), updated_by=actor.id)
        settings_store.upsert(db, settings_store.K_DEV_CU, float(dev["cu"]), updated_by=actor.id)

    db.commit()
    after = settings_store.admin_settings(db)
    set_audit(request, target_table="system_settings", before=before, after=after)
    return after
