"""G0 — 인증 · 공통 (`api-contract.md` §8.1).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/health` | GET | **인증 면제** (§3.4) |
| `/auth/login` | POST | **인증 면제** |
| `/auth/logout` | POST | 전 역할 |
| `/auth/refresh` | POST | 전 역할 |
| `/auth/me` | GET | 전 역할 |
| `/settings/public` | GET | **인증만 요구, 역할 무관** (`viewer` 포함) |
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.api import settings_store
from src.api.deps import (
    ACCESS_TOKEN_EXPIRE_SECONDS,
    UNAUTHORIZED_DETAIL,
    create_access_token,
    get_current_user,
    get_db,
    verify_password,
)
from src.api.dto import auth_user_dto
from src.api.middleware import set_audit
from src.api.model_cache import loaded_model_names
from src.db.models import User
from src.models.train import REGISTRY

router = APIRouter(tags=["G0 인증·공통"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=1)


# ══════════════════════════════════════════════════════════════════════════
# 인증 면제 (§3.4)
# ══════════════════════════════════════════════════════════════════════════
@router.get("/health", summary="헬스체크 (인증 면제)")
def health():
    return {
        "status": "ok",
        "loaded_models": loaded_model_names(),
        "available_models": list(REGISTRY.keys()),
    }


@router.post("/auth/login", summary="로그인 (인증 면제)")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """실패는 **401 `"로그인이 필요합니다"`**.

    §8.1: **사용자 존재 여부를 구분해서 알려주지 마라.** 없는 계정·틀린 비밀번호·
    비활성 계정이 전부 같은 응답이다.

    성공 시 `users.last_login` 을 갱신하고 `audit_logs` 에 `LOGIN` 을 남긴다 (§6.2).
    """
    user = db.execute(select(User).where(User.username == body.username)).scalar_one_or_none()

    # 타이밍 차이로 계정 존재를 노출하지 않도록, 계정이 없어도 해시 검증을 수행한다.
    ok = verify_password(body.password, user.password_hash if user else None)
    if user is None or not ok or not user.active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=UNAUTHORIZED_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )

    user.last_login = dt.datetime.now()
    db.commit()
    db.refresh(user)

    # 미들웨어가 이 요청을 `LOGIN` 으로 기록한다 (§6.2). uid 는 토큰이 아직 없으므로
    # 여기서 넘겨준다.
    set_audit(request, user_id=user.id, target_table="users", target_id=user.id,
              after={"username": user.username, "role": user.role})

    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_SECONDS,
        "user": auth_user_dto(user),
    }


# ══════════════════════════════════════════════════════════════════════════
# 인증 필요
# ══════════════════════════════════════════════════════════════════════════
@router.post("/auth/logout", summary="로그아웃")
def logout(user: User = Depends(get_current_user)):
    """JWT 는 **무상태**다. v1 에는 서버측 폐기 목록이 없다.

    실제 로그아웃은 프론트가 `sessionStorage` 의 토큰을 지우는 것으로 완료된다
    (`ts-types.md` §6.1). 이 엔드포인트는 그 시점을 서버가 알 수 있게 하는 훅이다.
    토큰은 발급 후 30분까지 유효하게 남는다 — 폐기 목록이 필요하면 별도 CR 이다.
    """
    return {"ok": True}


@router.post("/auth/refresh", summary="토큰 갱신")
def refresh(user: User = Depends(get_current_user)):
    """만료 **전에만** 갱신된다. 만료된 토큰은 401 이라 여기 도달하지 못한다."""
    return {
        "access_token": create_access_token(user),
        "expires_in": ACCESS_TOKEN_EXPIRE_SECONDS,
    }


@router.get("/auth/me", summary="현재 사용자")
def me(user: User = Depends(get_current_user)):
    return auth_user_dto(user)


@router.get("/settings/public", summary="화면 렌더용 공개 임계값")
def public_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """🔴 **인증만 요구하고 역할은 무관하다** (§8.1.1). `viewer` 포함 전 역할 R.

    `GET /settings` 가 `admin` 전용이라 **품질 점수를 표시하는 9개 화면이
    비관리자에게는 합격 판정 기준을 못 가져오는** 차단 결함이 있었다. 그 해소다.

    ⛔ `integration.*` 등 운영 파라미터를 절대 포함하지 마라. 노출 대상은
    화면 렌더용 읽기 전용 임계값 7종이 전부다.

    프론트는 **세션당 1회** 조회해 보관한다. 화면마다 다시 부르지 마라.
    """
    return settings_store.public_settings(db)
