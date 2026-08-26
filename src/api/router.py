"""`/api/v1` 라우터 조립 — `api-contract.md` §1.2.

    api_v1 = APIRouter(prefix="/api/v1")
    app.include_router(api_v1)

**정본 경로는 `/api/v1/*` 다.** 기존 무접두사 12개는 `app.py` 가 deprecated 별칭으로
따로 매단다 (§2.2). 별칭은 **동일 핸들러를 재사용**한다 — 로직을 복사하지 마라.

### 개발1 라우터 자동 편입
개발1이 담당하는 마스터·트랜잭션 CRUD 라우터는 `src/api/routers/<name>.py` 에
`router = APIRouter(...)` 만 정의하면 **여기 손대지 않아도** 자동으로 편입된다.
`_DEV1_MODULES` 목록에 이름이 있으면 되고, 없는 모듈은 조용히 건너뛴다.
이렇게 한 이유: 개발2·개발1이 같은 라운드에 `app.py` 를 동시에 고치면 충돌한다.
"""
from __future__ import annotations

import importlib
import logging

from fastapi import APIRouter

from src.api.routers import agents, auth, dashboard, data, kpi, system

log = logging.getLogger("koryo.api")

#: 개발1(마스터·트랜잭션 CRUD) 담당 모듈. 파일이 생기면 자동으로 붙는다.
#: 순서는 OpenAPI 문서 노출 순서다.
_DEV1_MODULES: tuple[str, ...] = (
    "receipts",          # FE-RT-06·07
    "components",        # FE-RT-08
    "suppliers",         # FE-RT-09
    "training_data",     # FE-RT-11·12 (학습 데이터 · 편차)
    "shipments",         # FE-RT-16
    "lots",              # FE-RT-17
    "quality",           # FE-RT-18
    "claims",            # FE-RT-19
    "process",           # FE-RT-21·25 집계 (개발2 — /process/performance·/process/analysis)
    "process_conditions",  # FE-RT-23·24 (개발1 — /process/conditions·/process/history)
    "equipment",         # FE-RT-22
    "master_codes",      # FE-RT-30·31·32 (개발1)
)
# ⚠ `alerts` 를 목록에서 뺐다. `GET /alerts` 는 **§8 엔드포인트 카탈로그에 없다** —
#   내가 초안에 넣었던 항목이고 계약 근거가 없다. 알림은 `/dashboard/production` 의
#   `alerts` 배열로만 나간다 (§8.2). 계약에 없는 엔드포인트를 만들지 마라.


def build_api_router() -> APIRouter:
    api_v1 = APIRouter(prefix="/api/v1")

    # ── 개발2 담당 ──────────────────────────────────────────────────────
    api_v1.include_router(auth.router)          # G0 인증·공통
    api_v1.include_router(dashboard.router)     # G1 AI 대시보드
    api_v1.include_router(data.router)          # G8 데이터관리시스템
    api_v1.include_router(agents.router)        # G9 AI Agent (501)
    api_v1.include_router(kpi.router)           # G10 KPI 관리
    api_v1.include_router(system.router)        # G6 사용자·시스템관리

    # ── 개발1 담당 (있으면 편입) ────────────────────────────────────────
    for name in _DEV1_MODULES:
        try:
            module = importlib.import_module(f"src.api.routers.{name}")
        except ModuleNotFoundError:
            continue
        router = getattr(module, "router", None)
        if router is None:
            log.warning("src/api/routers/%s.py 에 `router` 가 없다 — 건너뛴다", name)
            continue
        api_v1.include_router(router)

    # ── G11 DOE (경로만 이동 — §8.11 "그 외 손대지 마라") ───────────────
    # 권한은 §8.11 표대로 "전 역할 R" = **인증 필수**다 (§3.4 면제 목록에 없다).
    from fastapi import Depends

    from src.api.deps import get_current_user
    from src.doe.routes import router as doe_router

    api_v1.include_router(doe_router, dependencies=[Depends(get_current_user)])

    return api_v1
