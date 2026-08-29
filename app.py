"""고려솔더 AI 스마트공장 — FastAPI 정본 라우터.

실행:
    uvicorn app:app --reload --port 8000

## 경로 규약 (`contracts/api-contract.md` §1·§2)

**정본 경로는 `/api/v1/*` 다.** 프론트는 `BASE_URL=''` 상대경로로 Next rewrite 를
경유하고, rewrite 는 `/api` 를 벗기지 않는다 → 네트워크 탭 URL 을 그대로 `curl` 할 수 있다.

기존 무접두사 12개(`/models`·`/predict`·`/recommend`·`/eda/stats`·`/doe/*`)는
**deprecated 별칭**으로 남는다. 별칭은 **동일 핸들러를 재사용**하며 응답에
`Deprecation: true` + `Link: </api/v1/...>; rel="successor-version"` 헤더가 붙는다
(`src/api/middleware.py`). 제거 시점은 v1 종료 — `TODO-API-001`.

## 이 파일이 책임지는 것

| 항목 | 근거 |
|---|---|
| `/api/v1` 라우터 조립 | §1.2 |
| deprecated 별칭 12개 | §2.2 |
| 전역 예외 핸들러 (503·409) | §5 — **라우터마다 try/except 금지** |
| 감사로그 미들웨어 등록 | §6.1 |
| ML 모델 싱글톤 사전 적재 | `DEF-IT-001` |

## G3 핵심 기능 3종(`/models`·`/predict`·`/recommend`)이 여기 남은 이유
`api-contract.md` §8.12 가 이 3개를 **✅ 기존 구현**(경로만 이동)으로 분류했다.
새 라우터로 옮기면 `lib/api.ts`·`streamlit_app.py`·레거시 5페이지가 동시에 흔들린다.
"""
from __future__ import annotations

import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

# `.env` 를 **다른 import 보다 먼저** 읽는다. `src/agent/config.py` 등이 모듈
# 수준에서 `os.getenv` 를 부르므로, 나중에 읽으면 값이 이미 굳은 뒤다.
# `override=False` — 셸에서 명시적으로 준 값이 파일보다 우선한다.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).parent / ".env", override=False)

import pandas as pd
from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from src.api import model_cache
from src.api.deps import get_current_user, get_db
from src.api.errors import register_exception_handlers
from src.api.middleware import purge_expired_audit_logs, register_middleware
from src.api.router import build_api_router
from src.api.serialization import safe_float
from src.features.engineering import AG_TARGET, CU_TARGET, SN_TARGET, build_features
from src.db.models import User
from src.models.optimize import recommend_ratios
from src.models.train import REGISTRY

ARTIFACTS_DIR = Path("models/artifacts")

# ── 전역 모델 캐시 ──────────────────────────────────────────────────────
# ⚠ `DEF-IT-001` — 이 dict 는 `src/api/model_cache.py` 의 프로세스 전역 캐시를
#   **그대로 참조**하는 별칭이다. `src/doe/routes.py._doe_cache` 도 같은 객체다.
#   새 캐시를 만들지 마라. 20명 동시 접속에서 같은 모델이 두 번 적재된다.
_cache: dict = model_cache.shared_cache()


def _load(model_name: str) -> dict:
    """싱글톤에서 번들을 꺼낸다. 아티팩트가 없으면 404 "모델을 찾을 수 없습니다" (§5)."""
    return model_cache.get_bundle(model_name)


# ══════════════════════════════════════════════════════════════════════════
# 앱
# ══════════════════════════════════════════════════════════════════════════
@asynccontextmanager
async def lifespan(app: FastAPI):
    loaded = model_cache.preload()
    for name in REGISTRY:
        print(f"  [{'OK' if name in loaded else '--'}] {name}")
    # NFR-S-04 — 감사로그 보관 1년. 기동 시 1회 정리한다 (상시 운영은 cron 으로 옮겨라).
    purged = purge_expired_audit_logs()
    if purged:
        print(f"  [OK] 만료 감사로그 {purged}건 정리")

    # agent-architecture.md §6.6 — 외부 송출 원문 90일, 실행 로그 행 1년.
    # 🔴 서버가 몇 주씩 떠 있으면 기동 시 1회로는 90일 정책이 지켜지지 않는다.
    #    상시 운영에서는 `scripts/purge_retention.py` 를 cron 으로 돌려라.
    from src.agent import retention
    from src.db.session import SessionLocal

    _db = SessionLocal()
    try:
        stats = retention.run_all(_db)
        if stats["masked"] or stats["purged"]:
            print(
                f"  [OK] Agent 로그 정리 — 원문 {stats['masked']}건 비움, "
                f"행 {stats['purged']}건 삭제"
            )
    finally:
        _db.close()
    yield


app = FastAPI(
    title="고려솔더 AI 스마트공장 API",
    description=(
        "배합비율 최적화 AI 스마트공장 (과제 SF26179525) — 44화면 / 10메뉴.\n\n"
        "**정본 경로는 `/api/v1/*`.** 무접두사 경로는 deprecated 별칭이다."
    ),
    version="3.0.0",
    lifespan=lifespan,
)

# 동일 출처(Next rewrite 경유)가 정본이라 CORS 는 개발 환경 탈출구다.
# `NEXT_PUBLIC_API_URL` 을 채워 직접 호출하는 배포에서는 오리진을 추가해야 한다.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# §6.1 감사로그 + §2.2 deprecated 헤더
register_middleware(app)
# §5 전역 오류 계약 (503 DB 연결 실패 · 409 UK 중복)
register_exception_handlers(app)

app.mount("/static", StaticFiles(directory="static"), name="static")


# ══════════════════════════════════════════════════════════════════════════
# G3 스키마 — `api-contract.md` §8.4.1·§8.4.2
# ══════════════════════════════════════════════════════════════════════════
#: goal.md 2.3 최적화 경계. `src/models/optimize.py` 의 `DEFAULT_BOUNDS`
#: (`ag 0~5`, `cu 0~2`, `pb 0~45`) 와 **다르다** — API 레이어가 goal.md 값으로 덮어쓴다 (§8.4.2).
API_BOUNDS: dict[str, tuple[float, float]] = {
    "sn_pct": (55.0, 70.0),
    "ag_pct": (1.0, 5.0),
    "cu_pct": (0.1, 1.5),
    "pb_pct": (25.0, 45.0),
}

#: 품질 합격선 (goal.md 2.3). 런타임 변경은 `system_settings.quality.pass_score` 지만
#: `/predict` 는 모델 응답 스키마 고정을 위해 계약 상수를 쓴다 (§8.4.1 "기준: 70점 이상").
QUALITY_PASS_SCORE = 70.0

#: §7.3 — 모델 등급. `baseline` 은 `/recommend` 드롭다운에서 제외한다.
MODEL_TIERS: dict[str, tuple[str, bool, str]] = {
    "gradient_boosting": ("serving", True, "GradientBoosting (권장)"),
    "xgboost": ("candidate", False, "XGBoost"),
    "random_forest": ("candidate", False, "RandomForest"),
    "ridge": ("baseline", False, "Ridge (선형 베이스라인)"),
}


class RecommendRequest(BaseModel):
    model: str = Field("gradient_boosting", description="사용 모델")
    temperature: float = Field(250.0, description="용해 온도 (°C)", ge=200, le=320)
    process_time: float = Field(45.0, description="가열 시간 (분)", ge=10, le=120)
    supplier: str = Field("SUP_A", description="공급사 코드", pattern="^SUP_[ABC]$")
    sn_bounds: tuple[float, float] | None = None
    ag_bounds: tuple[float, float] | None = None
    cu_bounds: tuple[float, float] | None = None


class PredictRequest(BaseModel):
    """입력 범위는 goal.md 2.3 하드 비즈니스 룰이다."""

    model: str = Field("gradient_boosting", description="사용 모델")
    sn_ratio: float = Field(..., description="Sn 비율 (%)", ge=55, le=70)
    ag_ratio: float = Field(..., description="Ag 비율 (%)", ge=1, le=5)
    cu_ratio: float = Field(..., description="Cu 비율 (%)", ge=0.1, le=1.5)
    pb_ratio: float = Field(..., description="Pb 비율 (%)", ge=25, le=45)
    temperature: float = Field(250.0, description="용해 온도 (°C)", ge=200, le=320)
    process_time: float = Field(45.0, description="가열 시간 (분)", ge=10, le=120)
    supplier: str = Field("SUP_A", description="공급사 코드", pattern="^SUP_[ABC]$")

    @model_validator(mode="after")
    def _sum_must_be_100(self):
        """🔴 오류 계약 1번 — 성분 합계 ≠ 100% → **422** (goal.md 2.3 / §5).

        허용 오차 0.05. 프론트는 합계가 100 이 아니면 예측 버튼을 비활성한다 (이중 방어).
        """
        total = self.sn_ratio + self.ag_ratio + self.cu_ratio + self.pb_ratio
        if abs(total - 100.0) > 0.05:
            raise ValueError(f"성분 합계는 100%여야 합니다 (현재 {total:.3f}%)")
        return self


# ══════════════════════════════════════════════════════════════════════════
# G3 핸들러 — 정본/별칭이 **같은 함수**를 쓴다
# ══════════════════════════════════════════════════════════════════════════
def _meta(name: str) -> dict | None:
    path = ARTIFACTS_DIR / f"{name}_meta.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def health():
    return {
        "status": "ok",
        "loaded_models": model_cache.loaded_model_names(),
        "available_models": list(REGISTRY.keys()),
    }


def list_models():
    """학습된 모델 목록 — **벌거벗은 배열** (§4.2 예외).

    §7.3 대로 `tier` / `active` / `display_name` 을 덧붙인다.
    **성능 수치를 코드에 하드코딩하지 마라** — `{name}_meta.json` 에서 읽는다 (§7.4).
    """
    result = []
    for name in REGISTRY:
        if not (ARTIFACTS_DIR / f"{name}.joblib").exists():
            continue
        info = _meta(name) or {
            "name": name,
            "metrics": {"mae": None, "rmse": None, "r2": None, "mape": None},
            "feature_importances": [],
            "trained_at": None,
        }
        tier, active, display = MODEL_TIERS.get(name, ("candidate", False, name))
        info["tier"] = tier
        info["active"] = active
        info["display_name"] = display
        result.append(info)
    return result


def recommend(req: RecommendRequest):
    """최적 배합비율 추천 — FE-RT-14. NFR-P-03 ≤ 5초.

    **`optimization_success:false` 는 200 이다.** 4xx/5xx 로 바꾸지 마라 (§5).
    """
    tier = MODEL_TIERS.get(req.model, ("candidate", False, req.model))[0]
    if tier == "baseline":
        # §7.3 — 선형 모델은 내부 최적점이 없어 SLSQP 가 경계값(Sn 55 또는 70)으로 튄다.
        raise HTTPException(
            status_code=400,
            detail=f"'{req.model}' 은 선형 베이스라인 모델이라 배합 최적화에 쓸 수 없습니다",
        )

    bundle = _load(req.model)

    process_conditions = {
        "melt_temp_c": req.temperature,
        "melt_time_min": req.process_time,
        "supplier_id_SUP_B": 1 if req.supplier == "SUP_B" else 0,
        "supplier_id_SUP_C": 1 if req.supplier == "SUP_C" else 0,
    }

    # 클라이언트가 보낸 탐색 범위는 **계약 경계 안에 있어야 한다**.
    #
    # 검증이 없던 초판은 `sn_bounds:[71,80]` 을 그대로 받아 `sn=71.0` 을
    # `optimization_success: true` 로 반환했다. 그런데 `/predict` 는 같은 경계를
    # Pydantic 으로 강제하므로 그 배합을 되먹이면 **422** 가 났다 —
    # **최적화 AI 가 추천한 배합을 예측 API 가 거부하는** 모순이다 (2차 QA 실측).
    # 두 엔드포인트가 같은 계약(goal.md 2.3)을 보도록 여기서 막는다.
    def _clamp_check(name: str, key: str, got: tuple[float, float] | None) -> tuple[float, float]:
        lo_c, hi_c = API_BOUNDS[key]
        if not got:
            return (lo_c, hi_c)
        lo, hi = float(got[0]), float(got[1])
        if lo > hi:
            raise HTTPException(
                status_code=422,
                detail=f"{name} 탐색 범위의 하한이 상한보다 큽니다 ({lo} > {hi})",
            )
        if lo < lo_c or hi > hi_c:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"{name} 탐색 범위 [{lo}, {hi}] 가 허용 경계 [{lo_c}, {hi_c}] 를 벗어났습니다. "
                    "허용 경계 밖의 배합은 품질 예측 API 가 거부합니다."
                ),
            )
        return (lo, hi)

    bounds = dict(API_BOUNDS)
    bounds["sn_pct"] = _clamp_check("Sn", "sn_pct", req.sn_bounds)
    bounds["ag_pct"] = _clamp_check("Ag", "ag_pct", req.ag_bounds)
    bounds["cu_pct"] = _clamp_check("Cu", "cu_pct", req.cu_bounds)

    result = recommend_ratios(
        process_conditions=process_conditions,
        model=bundle["model"],
        imputer=bundle["imputer"],
        scaler=bundle["scaler"],
        bounds=bounds,
    )
    return {
        "recommended_ratios": {
            "sn": safe_float(result.get("sn_pct"), 3),
            "ag": safe_float(result.get("ag_pct"), 3),
            "cu": safe_float(result.get("cu_pct"), 3),
            "pb": safe_float(result.get("pb_pct"), 3),
        },
        "predicted_quality": safe_float(result.get("predicted_quality"), 3),
        "optimization_success": bool(result.get("success", False)),
        "iterations": int(result.get("iterations", 0)),
        "message": result.get("message"),
    }


def predict(req: PredictRequest):
    """품질 점수 예측 — FE-RT-13. NFR-P-02 ≤ 3초.

    응답은 기존 2필드 + §8.4.1 의 3필드(`passed`·`deviations`·`model_metrics`)다.
    """
    bundle = _load(req.model)

    record = {
        "sn_pct": req.sn_ratio,
        "ag_pct": req.ag_ratio,
        "cu_pct": req.cu_ratio,
        "pb_pct": req.pb_ratio,
        "other_pct": 0.0,
        "melt_temp_c": req.temperature,
        "melt_time_min": req.process_time,
        "supplier_id_SUP_B": 1 if req.supplier == "SUP_B" else 0,
        "supplier_id_SUP_C": 1 if req.supplier == "SUP_C" else 0,
        "quality_score": 0.0,
    }

    X, _, _, _ = build_features(
        pd.DataFrame([record]), target_col="quality_score",
        imputer=bundle["imputer"], scaler=bundle["scaler"], fit=False,
    )

    # `BUG-001` — 학습 시 피처 순서/목록 일치 보장. **이 경로를 바꾸지 마라** (§2.3).
    model = bundle["model"]
    if hasattr(model, "feature_names_in_"):
        for col in model.feature_names_in_:
            if col not in X.columns:
                X[col] = 0.0
        X = X[model.feature_names_in_]

    pred = safe_float(model.predict(X)[0], 3)
    metrics = (_meta(req.model) or {}).get("metrics", {})

    return {
        "predicted_quality": pred,
        "model_used": req.model,
        # SF-TD3 §3.2 "● 합격 (기준: 70점 이상)"
        "passed": bool(pred is not None and pred >= QUALITY_PASS_SCORE),
        # SF-TD3 §3.2 "성분 편차 Sn: +0.0% (목표: 62.0%)" — 목표값은 engineering.py 상수다
        "deviations": {
            "sn": safe_float(req.sn_ratio - SN_TARGET, 3),
            "ag": safe_float(req.ag_ratio - AG_TARGET, 3),
            "cu": safe_float(req.cu_ratio - CU_TARGET, 3),
        },
        "model_metrics": {k: safe_float(v, 4) for k, v in metrics.items()},
    }


# ══════════════════════════════════════════════════════════════════════════
# 라우팅 — 정본(`/api/v1`) + deprecated 별칭
# ══════════════════════════════════════════════════════════════════════════
_G3_ROUTES: tuple[tuple[str, str, object, str, str], ...] = (
    ("/models", "GET", list_models, "모델 목록", "G3 배합비율 최적화AI"),
    ("/predict", "POST", predict, "FE-RT-13 품질 예측", "G3 배합비율 최적화AI"),
    ("/recommend", "POST", recommend, "FE-RT-14 배합비율 추천", "G3 배합비율 최적화AI"),
)

# §3.4 인증 면제는 `/health` · `/auth/login` · `/docs` · `/openapi.json` · `/static/*` **뿐**이다.
# **그 외 전부 인증 필수**이며 여기에는 deprecated 별칭도 포함된다 — 별칭에 인증을 걸지
# 않으면 `/api/v1/predict` 의 게이트를 `/predict` 로 우회할 수 있다.
_AUTH = [Depends(get_current_user)]


def eda_stats_alias(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """`GET /eda/stats` — deprecated 별칭.

    ⚠ SF-TD4 §2.4 표기는 `eda-stats`(하이픈)이고 그것이 정본이다 (§1.4).
    """
    from src.api.routers.data import eda_stats

    return eda_stats(db=db, _=user)


api_v1 = build_api_router()
for _path, _method, _fn, _summary, _tag in _G3_ROUTES:
    api_v1.add_api_route(_path, _fn, methods=[_method], summary=_summary,
                         tags=[_tag], dependencies=_AUTH)
app.include_router(api_v1)

# ── deprecated 별칭 (§2.2) — 동일 핸들러 재사용. 로직을 복사하지 마라 ─────
legacy = APIRouter(tags=["deprecated 별칭"], deprecated=True)
legacy.add_api_route("/", health, methods=["GET"], summary="헬스체크 (→ /api/v1/health)")
legacy.add_api_route("/eda/stats", eda_stats_alias, methods=["GET"],
                     summary="EDA 통계 (→ /api/v1/eda-stats)")
for _path, _method, _fn, _summary, _tag in _G3_ROUTES:
    legacy.add_api_route(_path, _fn, methods=[_method], dependencies=_AUTH,
                         summary=f"{_summary} (→ /api/v1{_path})")

from src.doe.routes import router as doe_router  # noqa: E402

legacy.include_router(doe_router, dependencies=_AUTH)
app.include_router(legacy)

del _path, _method, _fn, _summary, _tag
