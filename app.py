"""배합비율 최적화 ML — FastAPI 추천 서버

실행:
    uvicorn app:app --reload --port 8000

엔드포인트:
    GET  /             헬스체크
    GET  /models       모델 목록 + 성능 지표 (ModelInfo[])
    POST /recommend    최적 배합비율 추천
    POST /predict      품질 점수 예측
    GET  /eda/stats    EDA 통계 데이터
"""
import sys
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional
import numpy as np
import pandas as pd

from src.models.train import load_model, REGISTRY
from src.features.engineering import load_preprocessors, build_features
from src.models.optimize import recommend_ratios, DEFAULT_BOUNDS
from src.doe.routes import router as doe_router

ARTIFACTS_DIR = Path("models/artifacts")

# ── 전역 모델 캐시 ──────────────────────────────────────────────
_cache: dict = {}


def _load(model_name: str):
    if model_name not in _cache:
        try:
            model = load_model(model_name)
            imputer, scaler = load_preprocessors(name=model_name)
            _cache[model_name] = {"model": model, "imputer": imputer, "scaler": scaler}
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=f"모델 '{model_name}' 아티팩트 없음. 먼저 학습하세요: "
                       f"python scripts/train.py --model {model_name}",
            )
    return _cache[model_name]


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 서버 시작 시 기본 모델 사전 로드 시도
    for name in ("xgboost", "gradient_boosting", "random_forest"):
        try:
            _load(name)
            print(f"  [OK] {name} 로드 완료")
        except HTTPException:
            print(f"  - {name} 아티팩트 없음 (skip)")
    yield


app = FastAPI(
    title="배합비율 최적화 ML API",
    description="성분분석 데이터 기반 최적 배합비율 자동 추천 서버",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(doe_router, tags=["DOE"])
app.mount("/static", StaticFiles(directory="static"), name="static")


# ── 스키마 ──────────────────────────────────────────────────────

class RecommendRequest(BaseModel):
    model: str = Field("xgboost", description="사용 모델")
    temperature: float = Field(250.0, description="용해 온도 (°C)", ge=200, le=320)
    process_time: float = Field(45.0, description="가열 시간 (분)", ge=10, le=120)
    supplier: str = Field("SUP_A", description="공급사 코드", pattern="^SUP_[ABC]$")
    sn_bounds: Optional[tuple[float, float]] = None
    ag_bounds: Optional[tuple[float, float]] = None
    cu_bounds: Optional[tuple[float, float]] = None


class PredictRequest(BaseModel):
    model: str = Field("xgboost", description="사용 모델")
    sn_ratio: float = Field(..., description="SN 비율 (%)")
    ag_ratio: float = Field(..., description="AG 비율 (%)")
    cu_ratio: float = Field(..., description="CU 비율 (%)")
    pb_ratio: float = Field(..., description="PB 비율 (%)")
    temperature: float = Field(250.0, description="용해 온도 (°C)")
    process_time: float = Field(45.0, description="가열 시간 (분)")
    supplier: str = Field("SUP_A", description="공급사 코드")


# ── 엔드포인트 ───────────────────────────────────────────────────

@app.get("/", tags=["상태"])
def health():
    loaded = list(_cache.keys())
    return {
        "status": "ok",
        "loaded_models": loaded,
        "available_models": list(REGISTRY.keys()),
    }


@app.get("/models", tags=["상태"])
def list_models():
    """학습된 모델 목록 + 성능 지표 + 피처 중요도 (ModelInfo[])"""
    result = []
    for name in REGISTRY.keys():
        artifact = ARTIFACTS_DIR / f"{name}.joblib"
        if not artifact.exists():
            continue
        meta_path = ARTIFACTS_DIR / f"{name}_meta.json"
        if meta_path.exists():
            with open(meta_path, encoding="utf-8") as f:
                result.append(json.load(f))
        else:
            result.append({
                "name": name,
                "metrics": {"mae": 0.0, "rmse": 0.0, "r2": 0.0, "mape": 0.0},
                "feature_importances": [],
                "trained_at": None,
            })
    return result


@app.post("/recommend", tags=["추천"])
def recommend(req: RecommendRequest):
    """신규 LOT 공정 조건 → 최적 배합비율 추천"""
    cache = _load(req.model)

    process_conditions = {
        "melt_temp_c": req.temperature,
        "melt_time_min": req.process_time,
        "supplier_id_SUP_B": 1 if req.supplier == "SUP_B" else 0,
        "supplier_id_SUP_C": 1 if req.supplier == "SUP_C" else 0,
    }

    bounds = dict(DEFAULT_BOUNDS)
    if req.sn_bounds:
        bounds["sn_pct"] = tuple(req.sn_bounds)
    if req.ag_bounds:
        bounds["ag_pct"] = tuple(req.ag_bounds)
    if req.cu_bounds:
        bounds["cu_pct"] = tuple(req.cu_bounds)

    result = recommend_ratios(
        process_conditions=process_conditions,
        model=cache["model"],
        imputer=cache["imputer"],
        scaler=cache["scaler"],
        bounds=bounds,
    )
    return {
        "recommended_ratios": {
            "sn": result.get("sn_pct", 0.0),
            "ag": result.get("ag_pct", 0.0),
            "cu": result.get("cu_pct", 0.0),
            "pb": result.get("pb_pct", 0.0),
        },
        "predicted_quality": result.get("predicted_quality"),
        "optimization_success": result.get("success", False),
        "message": result.get("message"),
    }


@app.post("/predict", tags=["예측"])
def predict(req: PredictRequest):
    """피처 단건 → 품질 점수 예측"""
    cache = _load(req.model)

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

    df = pd.DataFrame([record])
    X, _, _, _ = build_features(
        df, target_col="quality_score",
        imputer=cache["imputer"], scaler=cache["scaler"], fit=False,
    )

    # 모델 학습 시와 피처 순서/목록 일치 보장
    if hasattr(cache["model"], "feature_names_in_"):
        for col in cache["model"].feature_names_in_:
            if col not in X.columns:
                X[col] = 0.0
        X = X[cache["model"].feature_names_in_]

    pred = float(cache["model"].predict(X)[0])
    return {
        "predicted_quality": round(pred, 3),
        "model_used": req.model,
    }


@app.get("/eda/stats", tags=["EDA"])
def eda_stats():
    """EDA 통계 데이터 — 성분 분포 및 품질 상관관계"""
    from src.data.loader import load_raw
    import subprocess

    try:
        df = load_raw("formulation_history.csv")
    except FileNotFoundError:
        subprocess.run(["python", "data/raw/generate_sample.py"], check=False)
        try:
            df = load_raw("formulation_history.csv")
        except FileNotFoundError:
            raise HTTPException(status_code=503, detail="데이터 파일 없음. python data/raw/generate_sample.py 실행 필요")

    def make_distribution(series, bins=5):
        counts, edges = np.histogram(series.dropna(), bins=bins)
        return [
            {"range": f"{edges[i]:.1f}-{edges[i+1]:.1f}", "count": int(counts[i])}
            for i in range(len(counts))
        ]

    sn_col = next((c for c in df.columns if "sn" in c.lower() and "pct" in c.lower()), None)
    ag_col = next((c for c in df.columns if "ag" in c.lower() and "pct" in c.lower()), None)
    cu_col = next((c for c in df.columns if "cu" in c.lower() and "pct" in c.lower()), None)
    quality_col = next((c for c in df.columns if "quality" in c.lower()), None)

    sn_vs_quality = []
    if sn_col and quality_col:
        sample = df[[sn_col, quality_col]].dropna().sample(min(60, len(df)), random_state=42)
        sn_vs_quality = [
            {"sn": round(float(row[sn_col]), 2), "quality": round(float(row[quality_col]), 2)}
            for _, row in sample.iterrows()
        ]

    return {
        "sn_distribution": make_distribution(df[sn_col]) if sn_col else [],
        "ag_distribution": make_distribution(df[ag_col]) if ag_col else [],
        "cu_distribution": make_distribution(df[cu_col]) if cu_col else [],
        "sn_vs_quality": sn_vs_quality,
        "stats": {
            "total_lots": len(df),
            "mean_quality": round(float(df[quality_col].mean()), 2) if quality_col else 0.0,
            "std_quality": round(float(df[quality_col].std()), 2) if quality_col else 0.0,
        },
    }
