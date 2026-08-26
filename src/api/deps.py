"""인증 · RBAC 의존성 — `api-contract.md` §3, `ts-types.md` §6.

계약 요지
    * JWT Bearer (`python-jose`), **세션 만료 30분** (`exp = now + 1800s`, NFR-S-01 / goal.md 2.3)
    * 클레임: `sub`(username) · `uid`(users.id) · `role` · `exp` · `iat`
    * 비밀번호 해시: bcrypt (`users.password_hash VARCHAR(255)`)
    * RBAC **5역할**: `admin` / `manufacture` / `quality` / `sales` / `viewer`
      (SF-AD2 FR-SY-01 은 4역할이나 goal.md 2.3 · SF-TD5 §3.8 의 **5역할이 정본**)
    * 인증 실패 **401** `"로그인이 필요합니다"` · 권한 없음 **403** `"접근 권한이 없습니다"`

라우터 사용법 — **핸들러 안에서 role 을 if 문으로 검사하지 마라** (§3.3):

    @router.post("/users", dependencies=[Depends(require_roles("admin"))])
    def create_user(...): ...

    @router.get("/lots")
    def list_lots(db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)): ...

`viewer` 는 모든 GET 에 `R`, 모든 쓰기에 403 이다. 쓰기 엔드포인트의
`require_roles(...)` 에 `viewer` 를 넣지 않으면 자동으로 403 이 된다.
"""
from __future__ import annotations

import datetime as dt
import os
from collections.abc import Iterator
from typing import Annotated, Literal

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.orm import Session

from src.db.models import User
from src.db.session import get_session

# ── 상수 ────────────────────────────────────────────────────────────────
#: 운영에서는 반드시 환경변수로 덮어써라. 값이 바뀌면 발급된 토큰이 전부 무효가 된다.
SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "koryo-solder-dev-secret-change-me")
ALGORITHM = "HS256"

#: NFR-S-01 / goal.md 2.3 — 세션 타임아웃 30분
ACCESS_TOKEN_EXPIRE_SECONDS = 1800

#: RBAC 5역할 (goal.md 2.3 · SF-TD5 §3.8)
UserRole = Literal["admin", "manufacture", "quality", "sales", "viewer"]
USER_ROLES: tuple[str, ...] = ("admin", "manufacture", "quality", "sales", "viewer")

#: `api-contract.md` §5 가 규정한 정확한 문구. 여기서 문구를 바꾸면 QA 케이스가 깨진다.
UNAUTHORIZED_DETAIL = "로그인이 필요합니다"
FORBIDDEN_DETAIL = "접근 권한이 없습니다"

#: bcrypt 는 72바이트를 넘는 입력을 거부한다 (bcrypt>=4.1). 잘라서 넘긴다.
_BCRYPT_MAX_BYTES = 72

_bearer = HTTPBearer(auto_error=False, description="Authorization: Bearer <JWT>")


# ══════════════════════════════════════════════════════════════════════════
# 비밀번호 해시
#   ⚠ `passlib 1.7.4` + `bcrypt 5.0.0` 조합은 깨져 있다
#     (`AttributeError: module 'bcrypt' has no attribute '__about__'` → 백엔드 로드 실패).
#     passlib 은 2020년 이후 릴리스가 없다. `bcrypt` 를 직접 쓴다 — 해시 포맷은
#     `$2b$...` 로 동일하므로 나중에 passlib 으로 되돌려도 기존 해시가 유효하다.
# ══════════════════════════════════════════════════════════════════════════
def _encode_secret(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """bcrypt 해시. `users.password_hash VARCHAR(255)` 에 들어간다 (60자)."""
    return bcrypt.hashpw(_encode_secret(password), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash:
        return False
    try:
        return bcrypt.checkpw(_encode_secret(password), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        # 손상된 해시 문자열 — 인증 실패로 취급한다 (500 을 내지 않는다)
        return False


# ══════════════════════════════════════════════════════════════════════════
# JWT
# ══════════════════════════════════════════════════════════════════════════
def create_access_token(user: User, expires_in: int = ACCESS_TOKEN_EXPIRE_SECONDS) -> str:
    """`api-contract.md` §3.1 클레임 5종을 담은 액세스 토큰."""
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": user.username,
        "uid": int(user.id),
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """검증 실패(위조·만료·형식 오류)는 전부 **401** 이다."""
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=UNAUTHORIZED_DETAIL,
            headers={"WWW-Authenticate": "Bearer"},
        )


def peek_token_payload(token: str | None) -> dict | None:
    """예외를 던지지 않는 디코드 — 감사로그 미들웨어 전용."""
    if not token:
        return None
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ══════════════════════════════════════════════════════════════════════════
# FastAPI 의존성
# ══════════════════════════════════════════════════════════════════════════
def get_db() -> Iterator[Session]:
    """`src/db/session.get_session` 의 별칭.

    DB 연결 실패는 여기서 잡지 않는다 — `src/api/errors.py` 의 전역 핸들러가
    `OperationalError` 를 **503 "서비스 일시 중단"** 으로 바꾼다 (§5).
    """
    yield from get_session()


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=UNAUTHORIZED_DETAIL,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
    db: Session = Depends(get_db),
) -> User:
    """토큰 → `users` 행. 실패는 전부 **401** (§3.3).

    사용자 존재 여부를 구분해서 알려주지 않는다 — 토큰이 없든, 만료됐든,
    계정이 지워졌든, 비활성이든 동일하게 401 `"로그인이 필요합니다"` 다.
    """
    if credentials is None or not credentials.credentials:
        raise _unauthorized()

    payload = decode_token(credentials.credentials)
    uid = payload.get("uid")
    if uid is None:
        raise _unauthorized()

    user = db.execute(select(User).where(User.id == int(uid))).scalar_one_or_none()
    if user is None or not user.active:
        raise _unauthorized()
    return user


def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)] = None,
    db: Session = Depends(get_db),
) -> User | None:
    """인증이 있으면 사용자, 없으면 `None`. 인증 면제 경로에서만 쓴다 (§3.4)."""
    if credentials is None or not credentials.credentials:
        return None
    payload = peek_token_payload(credentials.credentials)
    if not payload or payload.get("uid") is None:
        return None
    user = db.execute(select(User).where(User.id == int(payload["uid"]))).scalar_one_or_none()
    return user if (user and user.active) else None


def require_roles(*roles: str):
    """역할 게이트. 목록 밖이면 **403 "접근 권한이 없습니다"** (§3.3).

        @router.post("/users", dependencies=[Depends(require_roles("admin"))])

    `viewer` 를 목록에 넣지 않으면 자동으로 쓰기가 막힌다.
    """
    unknown = set(roles) - set(USER_ROLES)
    if unknown:  # 오타를 조용히 통과시키면 권한 게이트가 무력화된다
        raise ValueError(f"알 수 없는 역할: {sorted(unknown)} (허용: {USER_ROLES})")

    allowed = frozenset(roles)

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FORBIDDEN_DETAIL)
        return user

    return _dep


#: 자주 쓰는 조합 — 쓰기 권한 (`viewer` 는 절대 포함하지 않는다)
require_admin = require_roles("admin")

#: 인증만 요구하고 역할은 무관 (`/settings/public` 등). `viewer` 포함 전 역할 R.
require_any_role = require_roles(*USER_ROLES)


__all__ = [
    "ACCESS_TOKEN_EXPIRE_SECONDS",
    "ALGORITHM",
    "FORBIDDEN_DETAIL",
    "SECRET_KEY",
    "UNAUTHORIZED_DETAIL",
    "USER_ROLES",
    "UserRole",
    "create_access_token",
    "decode_token",
    "get_current_user",
    "get_db",
    "get_optional_user",
    "hash_password",
    "peek_token_payload",
    "require_admin",
    "require_any_role",
    "require_roles",
    "verify_password",
]
