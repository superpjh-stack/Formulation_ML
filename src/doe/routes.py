"""DOE (Design of Experiments) FastAPI Router

엔드포인트:
    GET  /doe/methods   — 지원 DOE 방법 목록 및 메타데이터
    POST /doe/design    — 설계 행렬 생성
    POST /doe/simulate  — ML 모델로 배치 예측 실행
    POST /doe/analyze   — 주효과 / 교호작용 / RSM 분석
    GET  /doe/sample    — 데모용 사전 생성 샘플 결과
"""
from __future__ import annotations

import sys
from pathlib import Path

# 프로젝트 루트를 sys.path에 추가 (직접 실행 시에도 동작)
_PROJECT_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(_PROJECT_ROOT))

import itertools
import math
import warnings
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from src.features.engineering import build_features, load_preprocessors, SN_TARGET, AG_TARGET, CU_TARGET
from src.models.train import load_model, REGISTRY
from src.doe.designs import DESIGN_REGISTRY
from src.doe.sample_generator import generate_sample_doe_data
from src.models.optimize import recommend_ratios, DEFAULT_BOUNDS

router = APIRouter(prefix="/doe", tags=["DOE"])

# ── 전역 모델 캐시 (app.py _cache 와 독립 운영, 키 충돌 없음) ────────────
_doe_cache: dict = {}


def _get_model(model_name: str) -> dict:
    if model_name not in _doe_cache:
        if model_name not in REGISTRY:
            raise HTTPException(
                status_code=400,
                detail=f"알 수 없는 모델: '{model_name}'. 가능한 모델: {list(REGISTRY.keys())}",
            )
        try:
            model = load_model(model_name)
            imputer, scaler = load_preprocessors(name=model_name)
            _doe_cache[model_name] = {"model": model, "imputer": imputer, "scaler": scaler}
        except FileNotFoundError:
            raise HTTPException(
                status_code=404,
                detail=f"모델 '{model_name}' 아티팩트 없음. 먼저 학습하세요: "
                       f"python scripts/train.py --model {model_name}",
            )
    return _doe_cache[model_name]


# ══════════════════════════════════════════════════════════════════════════
# DOE 설계 행렬 생성 유틸
# ══════════════════════════════════════════════════════════════════════════

def _full_factorial(factors: dict) -> List[dict]:
    """완전 요인 설계 — 모든 수준 조합."""
    keys = list(factors.keys())
    level_lists = []
    for k, info in factors.items():
        lo, hi = info["min"], info["max"]
        n_lv = max(2, int(info.get("levels", 2)))
        level_lists.append(list(np.linspace(lo, hi, n_lv)))
    rows = []
    for combo in itertools.product(*level_lists):
        rows.append(dict(zip(keys, [round(v, 4) for v in combo])))
    return rows


def _fractional_factorial(factors: dict) -> List[dict]:
    """부분 요인 설계 — 2-수준 Resolution IV (Plackett-Burman 근사)."""
    keys = list(factors.keys())
    k = len(keys)
    # 2^k 의 절반 (Resolution IV)
    n = 2 ** max(1, k - 1)
    rows = []
    for i in range(n):
        row = {}
        for j, key in enumerate(keys):
            lo, hi = factors[key]["min"], factors[key]["max"]
            # 그레이 코드 기반 ±1 할당
            bit = (i >> j) & 1
            row[key] = round(hi if bit else lo, 4)
        rows.append(row)
    return rows


def _ccd(factors: dict) -> List[dict]:
    """Central Composite Design (CCD) — 2-수준 요인 + 축점 + 중심점."""
    keys = list(factors.keys())
    k = len(keys)
    alpha = k ** 0.5  # 회전 가능 CCD

    mids = {k: (factors[k]["min"] + factors[k]["max"]) / 2 for k in keys}
    halfs = {k: (factors[k]["max"] - factors[k]["min"]) / 2 for k in keys}

    rows = []
    # 요인점 (2^k)
    for combo in itertools.product([-1, 1], repeat=k):
        row = {key: round(mids[key] + combo[i] * halfs[key], 4) for i, key in enumerate(keys)}
        rows.append(row)
    # 축점 (2k)
    for i, key in enumerate(keys):
        for sign in [-alpha, alpha]:
            row = {kk: round(mids[kk], 4) for kk in keys}
            row[key] = round(
                np.clip(mids[key] + sign * halfs[key], factors[key]["min"], factors[key]["max"]),
                4,
            )
            rows.append(row)
    # 중심점 (5회)
    for _ in range(5):
        rows.append({key: round(mids[key], 4) for key in keys})
    return rows


def _box_behnken(factors: dict) -> List[dict]:
    """Box-Behnken Design — 3-수준, 인자 수 ≥ 3."""
    keys = list(factors.keys())
    k = len(keys)
    if k < 3:
        # 인자가 2개 이하면 CCD로 대체
        return _ccd(factors)

    mids = {kk: (factors[kk]["min"] + factors[kk]["max"]) / 2 for kk in keys}
    halfs = {kk: (factors[kk]["max"] - factors[kk]["min"]) / 2 for kk in keys}

    rows = []
    # 모든 쌍 (i,j) 에 대해 ±1 조합, 나머지 0
    for i, j in itertools.combinations(range(k), 2):
        for si, sj in itertools.product([-1, 1], [-1, 1]):
            row = {kk: round(mids[kk], 4) for kk in keys}
            row[keys[i]] = round(mids[keys[i]] + si * halfs[keys[i]], 4)
            row[keys[j]] = round(mids[keys[j]] + sj * halfs[keys[j]], 4)
            rows.append(row)
    # 중심점
    for _ in range(3):
        rows.append({kk: round(mids[kk], 4) for kk in keys})
    return rows


def _taguchi(factors: dict) -> List[dict]:
    """다구치 직교 배열 (L9 or L18 근사) — 3-수준."""
    keys = list(factors.keys())
    k = len(keys)
    # L9 (3^4 직교 배열): 최대 4인자
    L9 = [
        [0, 0, 0, 0],
        [0, 1, 1, 1],
        [0, 2, 2, 2],
        [1, 0, 1, 2],
        [1, 1, 2, 0],
        [1, 2, 0, 1],
        [2, 0, 2, 1],
        [2, 1, 0, 2],
        [2, 2, 1, 0],
    ]
    rows = []
    levels_map = {}
    for kk, info in factors.items():
        lo, hi = info["min"], info["max"]
        levels_map[kk] = [lo, (lo + hi) / 2, hi]

    for oa_row in L9:
        row = {}
        for idx, kk in enumerate(keys):
            lv_idx = oa_row[idx % 4]
            row[kk] = round(levels_map[kk][lv_idx], 4)
        rows.append(row)
    return rows


def _lhs(factors: dict, n_samples: int = 30) -> List[dict]:
    """Latin Hypercube Sampling."""
    keys = list(factors.keys())
    k = len(keys)
    n = max(10, n_samples)

    rng = np.random.default_rng(42)
    # 각 차원: n개 구간을 임의로 섞어 샘플링
    lhs_matrix = np.zeros((n, k))
    for j in range(k):
        perm = rng.permutation(n)
        u = rng.uniform(size=n)
        lhs_matrix[:, j] = (perm + u) / n

    rows = []
    for i in range(n):
        row = {}
        for j, kk in enumerate(keys):
            lo, hi = factors[kk]["min"], factors[kk]["max"]
            row[kk] = round(lo + lhs_matrix[i, j] * (hi - lo), 4)
        rows.append(row)
    return rows


def _df_to_rows(df: pd.DataFrame) -> List[dict]:
    """designs.py DataFrame → routes List[dict] (coded 컬럼 제외)."""
    real_cols = [c for c in df.columns if not c.endswith("_coded")]
    return df[real_cols].round(4).to_dict(orient="records")

def _make_adapter(fn):
    """DESIGN_REGISTRY 함수를 routes 형식(List[dict] 반환)으로 래핑."""
    def wrapper(factors: dict, **kwargs) -> List[dict]:
        return _df_to_rows(fn(factors, **kwargs))
    return wrapper

# designs.DESIGN_REGISTRY 를 직접 사용 (inline 중복 제거)
_DESIGN_FUNCTIONS = {name: _make_adapter(fn) for name, fn in DESIGN_REGISTRY.items()}

_DOE_META = {
    "full_factorial": {
        "name": "Full Factorial",
        "description": "모든 인자 수준 조합 — 교호작용 완전 추정 가능, 인자 수 증가 시 실험 수 폭증",
        "recommended_factors": "2~4",
        "typical_experiments": "8~81",
        "pros": "완전한 정보, 교호작용 파악",
        "cons": "인자 수 증가 시 실험 수 급증",
    },
    "fractional_factorial": {
        "name": "Fractional Factorial",
        "description": "전체 조합의 절반(1/2 fraction) — 주효과 추정 위주, 고차 교호작용 혼합",
        "recommended_factors": "4~8",
        "typical_experiments": "8~32",
        "pros": "실험 수 절감",
        "cons": "일부 교호작용 혼합(aliased)",
    },
    "ccd": {
        "name": "Central Composite Design",
        "description": "2차 반응표면 모델링용 — 요인점 + 축점 + 중심점 구조",
        "recommended_factors": "2~5",
        "typical_experiments": "13~52",
        "pros": "2차 모델 추정, 회전 가능",
        "cons": "축점이 범위 밖으로 벗어날 수 있음",
    },
    "box_behnken": {
        "name": "Box-Behnken Design",
        "description": "CCD 대안 — 극단값 없는 3-수준 설계",
        "recommended_factors": "3~5",
        "typical_experiments": "13~46",
        "pros": "극단 조합 없음, 안전한 실험 범위",
        "cons": "인자 수 3 미만 불가",
    },
    "taguchi": {
        "name": "Taguchi Orthogonal Array (L9)",
        "description": "다구치 품질공학 — 강건 설계, 신호/잡음비 최적화",
        "recommended_factors": "2~4",
        "typical_experiments": "9",
        "pros": "노이즈 인자 포함 가능, 실험 수 최소화",
        "cons": "교호작용 추정 제한",
    },
    "lhs": {
        "name": "Latin Hypercube Sampling",
        "description": "공간 균등 샘플링 — 연속 탐색, 시뮬레이션 실험에 적합",
        "recommended_factors": "2~10",
        "typical_experiments": "20~100 (사용자 지정)",
        "pros": "공간 균등성, 인자 수 제한 없음",
        "cons": "직교성 보장 없음",
    },
}


# ══════════════════════════════════════════════════════════════════════════
# pb_pct 보정 유틸
# ══════════════════════════════════════════════════════════════════════════

def _fill_pb_pct(row: dict, other_pct: float = 0.0) -> dict:
    """sn+ag+cu+other 합산 후 pb_pct = 100 - sum 자동 계산."""
    sn = row.get("sn_pct", 0.0)
    ag = row.get("ag_pct", 0.0)
    cu = row.get("cu_pct", 0.0)
    pb = 100.0 - sn - ag - cu - other_pct
    if pb < 0:
        raise ValueError(
            f"pb_pct 가 음수({pb:.3f}) — sn+ag+cu 합계({sn+ag+cu:.1f})가 100%를 초과합니다."
        )
    row = dict(row)
    row["pb_pct"] = round(pb, 4)
    row["other_pct"] = round(other_pct, 4)
    return row


# ══════════════════════════════════════════════════════════════════════════
# Pydantic 스키마
# ══════════════════════════════════════════════════════════════════════════

class FactorSpec(BaseModel):
    min: float
    max: float
    levels: int = Field(3, ge=2, le=10)

    @model_validator(mode="after")
    def check_range(self) -> "FactorSpec":
        if self.min >= self.max:
            raise ValueError("min 은 max 보다 작아야 합니다.")
        return self


class DesignRequest(BaseModel):
    method: str = Field("ccd", description="DOE 방법: full_factorial | fractional_factorial | ccd | box_behnken | taguchi | lhs")
    factors: Dict[str, FactorSpec] = Field(
        ...,
        description="인자별 범위 및 수준 수. 예: {\"sn_pct\": {\"min\": 58, \"max\": 68, \"levels\": 3}}",
    )
    n_samples: int = Field(30, ge=5, le=500, description="LHS 전용 샘플 수")

    @model_validator(mode="after")
    def check_method(self) -> "DesignRequest":
        if self.method not in _DESIGN_FUNCTIONS:
            raise ValueError(f"method 는 {list(_DESIGN_FUNCTIONS.keys())} 중 하나여야 합니다.")
        return self


class SimulateRequest(BaseModel):
    design_matrix: List[Dict[str, Any]] = Field(..., description="설계 행렬 (dict 목록)")
    model: str = Field("xgboost", description="예측에 사용할 모델 이름")
    supplier: str = Field("SUP_A", pattern="^SUP_[ABC]$", description="공급사 코드")
    melt_temp_c: float = Field(250.0, ge=200, le=320, description="용해 온도 (°C)")
    melt_time_min: float = Field(45.0, ge=10, le=120, description="가열 시간 (분)")
    add_noise: bool = Field(False, description="Monte Carlo 노이즈 추가 여부")
    noise_std: float = Field(1.0, ge=0.0, description="노이즈 표준편차 (add_noise=True 시 사용)")


class AnalyzeRequest(BaseModel):
    simulated_data: List[Dict[str, Any]] = Field(..., description="simulate 결과의 simulated_data")
    response_col: str = Field("predicted_quality", description="반응값 컬럼명")
    factor_cols: Optional[List[str]] = Field(
        None,
        description="분석할 인자 컬럼 목록 (미지정 시 숫자형 컬럼에서 자동 선택)",
    )


# ══════════════════════════════════════════════════════════════════════════
# 엔드포인트
# ══════════════════════════════════════════════════════════════════════════

@router.get("/methods", summary="DOE 방법 목록")
def get_doe_methods():
    """지원하는 6가지 DOE 방법의 설명과 권장 인자 수 / 실험 수를 반환합니다."""
    return {
        "supported_methods": list(_DOE_META.keys()),
        "metadata": _DOE_META,
    }


@router.post("/design", summary="설계 행렬 생성")
def create_design(req: DesignRequest):
    """DOE 방법과 인자 범위를 받아 설계 행렬을 생성합니다.

    - **method**: DOE 방법 선택
    - **factors**: 인자별 min/max/levels
    - **n_samples**: LHS 전용 샘플 수 (다른 방법은 무시)
    """
    design_fn = _DESIGN_FUNCTIONS[req.method]
    factors_raw = {k: v.model_dump() for k, v in req.factors.items()}

    if req.method == "lhs":
        raw_matrix = design_fn(factors_raw, n_samples=req.n_samples)
    else:
        raw_matrix = design_fn(factors_raw)

    # pb_pct 자동 보정 (sn_pct, ag_pct, cu_pct 가 포함된 경우)
    comp_keys = {"sn_pct", "ag_pct", "cu_pct"}
    processed = []
    errors = []
    for idx, row in enumerate(raw_matrix):
        if comp_keys.issubset(row.keys()) and "pb_pct" not in row:
            try:
                row = _fill_pb_pct(row)
            except ValueError as e:
                errors.append({"row": idx, "error": str(e)})
                continue
        processed.append(row)

    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "pb_pct 계산 오류 — 성분 합계가 100%를 초과합니다.", "errors": errors},
        )

    return {
        "method": req.method,
        "method_name": _DOE_META[req.method]["name"],
        "n_experiments": len(processed),
        "design_matrix": processed,
        "factor_info": {
            k: {"min": v.min, "max": v.max, "levels": v.levels}
            for k, v in req.factors.items()
        },
    }


@router.post("/simulate", summary="ML 모델 배치 예측 실행")
def simulate_doe(req: SimulateRequest):
    """설계 행렬의 각 실험 조건에 대해 ML 모델로 품질 점수를 예측합니다.

    - **add_noise**: True 이면 Monte Carlo 노이즈를 예측값에 추가합니다.
    - **noise_std**: 노이즈 표준편차
    """
    cache = _get_model(req.model)
    model = cache["model"]
    imputer = cache["imputer"]
    scaler = cache["scaler"]

    supplier_b = 1 if req.supplier == "SUP_B" else 0
    supplier_c = 1 if req.supplier == "SUP_C" else 0

    rng = np.random.default_rng(42)
    results = []

    for idx, row in enumerate(req.design_matrix):
        enriched = dict(row)
        enriched.setdefault("melt_temp_c", req.melt_temp_c)
        enriched.setdefault("melt_time_min", req.melt_time_min)
        enriched["supplier_id_SUP_B"] = supplier_b
        enriched["supplier_id_SUP_C"] = supplier_c

        # pb_pct / other_pct 보정
        if "pb_pct" not in enriched and all(k in enriched for k in ["sn_pct", "ag_pct", "cu_pct"]):
            try:
                enriched = _fill_pb_pct(enriched)
            except ValueError as e:
                raise HTTPException(status_code=422, detail=f"행 {idx}: {e}")

        enriched.setdefault("pb_pct", 34.5)
        enriched.setdefault("other_pct", 0.0)

        # 편차 피처
        enriched["sn_deviation"] = enriched.get("sn_pct", SN_TARGET) - SN_TARGET
        enriched["ag_deviation"] = enriched.get("ag_pct", AG_TARGET) - AG_TARGET
        enriched["cu_deviation"] = enriched.get("cu_pct", CU_TARGET) - CU_TARGET

        df_row = pd.DataFrame([enriched])

        from src.features.engineering import NUM_COLS
        num_present = [c for c in NUM_COLS if c in df_row.columns]

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            df_row[num_present] = imputer.transform(df_row[num_present])
            df_row[num_present] = scaler.transform(df_row[num_present])

        if hasattr(model, "feature_names_in_"):
            for col in model.feature_names_in_:
                if col not in df_row.columns:
                    df_row[col] = 0.0
            df_row = df_row[model.feature_names_in_]
        else:
            df_row = df_row[num_present]

        pred = float(model.predict(df_row)[0])

        if req.add_noise:
            pred += float(rng.normal(0, req.noise_std))

        pred = round(pred, 3)

        result_row = dict(row)
        result_row["melt_temp_c"] = req.melt_temp_c
        result_row["melt_time_min"] = req.melt_time_min
        result_row["supplier"] = req.supplier
        result_row["predicted_quality"] = pred
        results.append(result_row)

    if not results:
        raise HTTPException(status_code=422, detail="유효한 예측 결과가 없습니다.")

    qualities = [r["predicted_quality"] for r in results]
    best_idx = int(np.argmax(qualities))

    summary = {
        "mean": round(float(np.mean(qualities)), 3),
        "std": round(float(np.std(qualities)), 3),
        "min": round(float(np.min(qualities)), 3),
        "max": round(float(np.max(qualities)), 3),
        "n_experiments": len(results),
        "model": req.model,
        "noise_applied": req.add_noise,
    }

    return {
        "simulated_data": results,
        "summary": summary,
        "optimal_point": results[best_idx],
    }


@router.post("/analyze", summary="주효과 / 교호작용 / RSM 분석")
def analyze_doe(req: AnalyzeRequest):
    """시뮬레이션 결과를 받아 주효과, 교호작용, 2차 RSM 계수를 계산합니다.

    sklearn 없이 numpy 선형대수로 직접 구현합니다.
    """
    df = pd.DataFrame(req.simulated_data)

    if req.response_col not in df.columns:
        raise HTTPException(
            status_code=422,
            detail=f"반응값 컬럼 '{req.response_col}' 이 데이터에 없습니다. "
                   f"사용 가능한 컬럼: {list(df.columns)}",
        )

    y = df[req.response_col].astype(float).values

    # 인자 컬럼 자동 선택
    exclude = {req.response_col, "supplier", "lot_id", "is_defect"}
    if req.factor_cols:
        factor_cols = [c for c in req.factor_cols if c in df.columns]
    else:
        factor_cols = [
            c for c in df.select_dtypes(include=[np.number]).columns
            if c not in exclude and c != req.response_col
        ]

    if not factor_cols:
        raise HTTPException(status_code=422, detail="분석할 수치형 인자 컬럼이 없습니다.")

    X_raw = df[factor_cols].astype(float).values

    # 중심화/정규화 (주효과 비교를 위해)
    col_means = X_raw.mean(axis=0)
    col_stds = X_raw.std(axis=0)
    col_stds[col_stds == 0] = 1.0
    X_scaled = (X_raw - col_means) / col_stds

    # ── 주효과 (1차 선형 회귀 계수) ──────────────────────────────
    X1 = np.column_stack([np.ones(len(X_scaled)), X_scaled])
    try:
        beta1, _, _, _ = np.linalg.lstsq(X1, y, rcond=None)
    except np.linalg.LinAlgError:
        beta1 = np.zeros(X1.shape[1])

    main_effects = {factor_cols[i]: round(float(beta1[i + 1]), 5) for i in range(len(factor_cols))}

    # ── 교호작용 (2인자 교호작용 항) ─────────────────────────────
    interaction_terms = []
    interaction_names = []
    for i, j in itertools.combinations(range(len(factor_cols)), 2):
        interaction_terms.append(X_scaled[:, i] * X_scaled[:, j])
        interaction_names.append(f"{factor_cols[i]}*{factor_cols[j]}")

    interactions = {}
    if interaction_terms:
        X_inter = np.column_stack([X1] + interaction_terms)
        try:
            beta_inter, _, _, _ = np.linalg.lstsq(X_inter, y, rcond=None)
            for k, name in enumerate(interaction_names):
                interactions[name] = round(float(beta_inter[X1.shape[1] + k]), 5)
        except np.linalg.LinAlgError:
            interactions = {name: 0.0 for name in interaction_names}

    # ── RSM 2차 계수 ──────────────────────────────────────────────
    quad_terms = [X_scaled[:, i] ** 2 for i in range(len(factor_cols))]
    quad_names = [f"{factor_cols[i]}^2" for i in range(len(factor_cols))]

    rsm_cols = [np.ones(len(X_scaled))]
    rsm_names = ["intercept"]
    for i, fc in enumerate(factor_cols):
        rsm_cols.append(X_scaled[:, i])
        rsm_names.append(fc)
    for i, qn in enumerate(quad_names):
        rsm_cols.append(quad_terms[i])
        rsm_names.append(qn)
    for i, (inter_col, inter_name) in enumerate(zip(interaction_terms, interaction_names)):
        rsm_cols.append(inter_col)
        rsm_names.append(inter_name)

    X_rsm = np.column_stack(rsm_cols)
    try:
        beta_rsm, residuals, rank, sv = np.linalg.lstsq(X_rsm, y, rcond=None)
        rsm_coefficients = {rsm_names[i]: round(float(beta_rsm[i]), 5) for i in range(len(rsm_names))}
    except np.linalg.LinAlgError:
        rsm_coefficients = {name: 0.0 for name in rsm_names}

    # ── R² 계산 ───────────────────────────────────────────────────
    y_pred_rsm = X_rsm @ beta_rsm
    ss_res = float(np.sum((y - y_pred_rsm) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = round(1 - ss_res / ss_tot if ss_tot > 0 else 0.0, 4)

    # ── 간이 ANOVA 테이블 ─────────────────────────────────────────
    n = len(y)
    p = X_rsm.shape[1] - 1  # 절편 제외
    df_model = p
    df_error = max(1, n - p - 1)
    ms_model = (ss_tot - ss_res) / max(1, df_model)
    ms_error = ss_res / df_error
    f_stat = ms_model / ms_error if ms_error > 0 else float("inf")

    anova_table = [
        {
            "source": "Model",
            "df": df_model,
            "SS": round(ss_tot - ss_res, 4),
            "MS": round(ms_model, 4),
            "F": round(f_stat, 4),
        },
        {
            "source": "Error",
            "df": df_error,
            "SS": round(ss_res, 4),
            "MS": round(ms_error, 4),
            "F": None,
        },
        {
            "source": "Total",
            "df": n - 1,
            "SS": round(ss_tot, 4),
            "MS": None,
            "F": None,
        },
    ]

    # ── 최적 조건 탐색 (그리드 탐색으로 RSM 모델 최대화) ──────────
    grid_points = 10
    grid_axes = []
    for i in range(len(factor_cols)):
        grid_axes.append(np.linspace(-1.5, 1.5, grid_points))

    best_pred = -np.inf
    best_row = {}
    for combo in itertools.product(*grid_axes):
        combo_arr = np.array(combo)
        # RSM 예측
        row_vec = [1.0]
        row_vec.extend(combo_arr.tolist())
        row_vec.extend((combo_arr ** 2).tolist())
        for ii, jj in itertools.combinations(range(len(factor_cols)), 2):
            row_vec.append(float(combo_arr[ii] * combo_arr[jj]))
        pred_val = float(np.dot(beta_rsm, row_vec))
        if pred_val > best_pred:
            best_pred = pred_val
            best_row = {
                factor_cols[i]: round(float(combo_arr[i] * col_stds[i] + col_means[i]), 4)
                for i in range(len(factor_cols))
            }
            best_row["rsm_predicted_quality"] = round(best_pred, 3)

    return {
        "n_experiments": n,
        "factor_cols": factor_cols,
        "response_col": req.response_col,
        "r_squared": r2,
        "rsm_coefficients": rsm_coefficients,
        "main_effects": main_effects,
        "interactions": interactions,
        "anova_table": anova_table,
        "optimal_conditions": best_row,
    }


class OptimizeRequest(BaseModel):
    factors: Dict[str, Dict[str, float]] = Field(
        default={
            "sn_pct":        {"min": 58.0, "max": 68.0},
            "ag_pct":        {"min": 1.0,  "max": 5.0},
            "cu_pct":        {"min": 0.1,  "max": 1.5},
        },
        description="인자별 탐색 범위 {name: {min, max}}",
    )
    model: str = Field("xgboost", description="사용 ML 모델")
    supplier: str = Field("SUP_A", description="공급사 코드")
    method: str = Field("slsqp", description="최적화 방법: slsqp | lhs_best")
    melt_temp_c: float = Field(250.0, description="용해 온도 (°C)")
    melt_time_min: float = Field(45.0, description="가열 시간 (분)")
    n_candidates: int = Field(200, ge=50, le=2000, description="lhs_best 후보 수")


@router.post("/optimize", summary="DOE+ML 기반 최적 배합비율 탐색")
def optimize_doe(req: OptimizeRequest):
    """scipy SLSQP 제약 최적화 또는 LHS 전수탐색으로 품질 최대화 배합비율를 탐색합니다.

    - **slsqp**: 기울기 기반 제약 최적화 (빠름, 지역 최적 위험)
    - **lhs_best**: Latin Hypercube 후보군 → 전수 예측 → 상위 5개 반환 (안전)
    """
    cache = _get_model(req.model)
    model, imputer, scaler = cache["model"], cache["imputer"], cache["scaler"]

    process_conditions = {
        "melt_temp_c":       req.melt_temp_c,
        "melt_time_min":     req.melt_time_min,
        "supplier_id_SUP_B": 1 if req.supplier == "SUP_B" else 0,
        "supplier_id_SUP_C": 1 if req.supplier == "SUP_C" else 0,
    }

    # 범위 → DEFAULT_BOUNDS 형식으로 변환
    bounds = {k: (v["min"], v["max"]) for k, v in req.factors.items()}
    bounds.setdefault("pb_pct", (0.0, 45.0))

    if req.method == "slsqp":
        result = recommend_ratios(
            process_conditions=process_conditions,
            model=model, imputer=imputer, scaler=scaler,
            bounds=bounds,
        )
        top5 = [result]

    else:  # lhs_best
        lhs_factors = {k: {"min": v["min"], "max": v["max"], "levels": 3}
                       for k, v in req.factors.items()}
        candidates = _lhs(lhs_factors, n_samples=req.n_candidates)

        scored = []
        for row in candidates:
            row = _fill_pb_pct(row)
            row.update(process_conditions)
            try:
                dummy = "_t_"
                df_row = pd.DataFrame([row])
                df_row[dummy] = 0.0
                X, _, _, _ = build_features(df_row, target_col=dummy,
                                            imputer=imputer, scaler=scaler, fit=False)
                if hasattr(model, "feature_names_in_"):
                    for col in model.feature_names_in_:
                        if col not in X.columns:
                            X[col] = 0.0
                    X = X[model.feature_names_in_]
                pred = float(model.predict(X)[0])
                scored.append({**{k: round(v, 4) for k, v in row.items()
                                  if k not in process_conditions and k != dummy},
                               "predicted_quality": round(pred, 3)})
            except Exception:
                continue

        scored.sort(key=lambda x: x["predicted_quality"], reverse=True)
        top5 = scored[:5]
        result = top5[0] if top5 else {}
        result["success"] = True
        result["message"] = f"LHS {req.n_candidates}개 후보 중 최적"

    return {
        "method":             req.method,
        "model":              req.model,
        "supplier":           req.supplier,
        "process_conditions": {"melt_temp_c": req.melt_temp_c, "melt_time_min": req.melt_time_min},
        "optimal_conditions": result,
        "top5_candidates":    top5,
        "factor_ranges":      req.factors,
    }


@router.get("/compare", summary="실이력 vs DOE 최적 조건 비교")
def compare_history(
    lot_count: int = Query(30, ge=5, le=200, description="이력 샘플 수"),
):
    """formulation_history.csv 에서 실생산 이력을 로드하여 공급사별 품질 통계와
    SUPPLIER_EFFECTS 재보정 값을 반환합니다.
    """
    from src.data.loader import load_raw
    from src.doe.sample_generator import SUPPLIER_EFFECTS, SN_TARGET, AG_TARGET, CU_TARGET

    try:
        df_hist = load_raw("formulation_history.csv")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="formulation_history.csv 없음. python data/raw/generate_sample.py 실행 후 재시도하세요.")

    # 샘플링 (lot_count 초과 시)
    if len(df_hist) > lot_count:
        df_hist = df_hist.sample(n=lot_count, random_state=42)

    # ── 공급사별 실통계 ───────────────────────────────────────────────
    supplier_col = "supplier_id" if "supplier_id" in df_hist.columns else None
    quality_col  = "quality_score" if "quality_score" in df_hist.columns else "predicted_quality"

    supplier_stats: list[dict] = []
    calibrated_effects: dict = {}

    if supplier_col:
        baseline_mean = float(df_hist[quality_col].mean())
        for sup, grp in df_hist.groupby(supplier_col):
            q_vals = grp[quality_col].dropna()
            if len(q_vals) == 0:
                continue
            mean_q = float(q_vals.mean())
            std_q  = float(q_vals.std())
            sn_mean = float(grp["sn_pct"].mean()) if "sn_pct" in grp else SN_TARGET
            ag_mean = float(grp["ag_pct"].mean()) if "ag_pct" in grp else AG_TARGET
            cu_mean = float(grp["cu_pct"].mean()) if "cu_pct" in grp else CU_TARGET

            sn_bias = round(sn_mean - SN_TARGET, 4)
            ag_bias = round(ag_mean - AG_TARGET, 4)
            cu_bias = round(cu_mean - CU_TARGET, 4)
            # noise_mult: std 대비 기준 공급사(SUP_B) 비율로 추정
            noise_mult = round(std_q / max(std_q, 0.1), 4)  # 자기 상대값(나중에 SUP_B 기준 정규화)

            supplier_stats.append({
                "supplier": str(sup),
                "n": int(len(q_vals)),
                "mean_quality": round(mean_q, 3),
                "std_quality":  round(std_q, 3),
                "sn_mean": round(sn_mean, 3),
                "ag_mean": round(ag_mean, 3),
                "cu_mean": round(cu_mean, 3),
                "sn_bias": sn_bias,
                "ag_bias": ag_bias,
                "cu_bias": cu_bias,
            })
            calibrated_effects[str(sup)] = {
                "sn_bias": sn_bias, "ag_bias": ag_bias, "cu_bias": cu_bias,
                "noise_mult": noise_mult,
                "mean_quality": round(mean_q, 3),
            }

        # noise_mult 를 SUP_B 기준으로 정규화
        ref_std = next((s["std_quality"] for s in supplier_stats if s["supplier"] == "SUP_B"), None)
        if ref_std and ref_std > 0:
            for s in supplier_stats:
                calibrated_effects[s["supplier"]]["noise_mult"] = round(s["std_quality"] / ref_std, 4)

    # ── 현재 하드코딩 vs 실보정 비교 ─────────────────────────────────
    current_vs_calibrated = []
    for sup, cur in SUPPLIER_EFFECTS.items():
        cal = calibrated_effects.get(sup, {})
        current_vs_calibrated.append({
            "supplier": sup,
            "current_sn_bias": cur["sn_bias"], "calibrated_sn_bias": cal.get("sn_bias", None),
            "current_noise_mult": cur["noise_mult"], "calibrated_noise_mult": cal.get("noise_mult", None),
        })

    # ── 이력 데이터 샘플 (응답용) ────────────────────────────────────
    history_records = df_hist[[c for c in ["lot_id","sn_pct","ag_pct","cu_pct",
                                            "melt_temp_c","melt_time_min",
                                            "supplier_id","quality_score"] if c in df_hist.columns]].round(3).to_dict(orient="records")

    return {
        "lot_count":    len(df_hist),
        "history":      history_records,
        "supplier_stats": supplier_stats,
        "calibrated_effects": calibrated_effects,
        "current_vs_calibrated": current_vs_calibrated,
        "summary": {
            "overall_mean": round(float(df_hist[quality_col].mean()), 3),
            "overall_std":  round(float(df_hist[quality_col].std()),  3),
            "n_suppliers":  len(supplier_stats),
        },
    }


@router.get("/sample", summary="데모용 샘플 DOE 데이터")
def get_sample(
    method: str = Query("lhs", description="DOE 방법"),
    n_points: int = Query(100, ge=20, le=1000, description="샘플 수 (LHS 전용; 다른 방법은 기본 설계 후 반복 보충)"),
):
    """모델 없이 동작하는 결정론적 샘플 DOE 데이터를 반환합니다.

    n_points 로 원하는 실험 수(최소 20, 최대 1000)를 지정할 수 있습니다.
    LHS 는 n_points 그대로, 나머지 방법은 기본 설계점 생성 후 LHS 로 보충합니다.
    """
    if method not in _DESIGN_FUNCTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"method 는 {list(_DESIGN_FUNCTIONS.keys())} 중 하나여야 합니다.",
        )

    # 5인자 전체 범위 정의
    sample_factors = {
        "sn_pct":        {"min": 58.0, "max": 68.0, "levels": 3},
        "ag_pct":        {"min": 1.0,  "max": 5.0,  "levels": 3},
        "cu_pct":        {"min": 0.1,  "max": 1.5,  "levels": 3},
        "melt_temp_c":   {"min": 230.0,"max": 290.0,"levels": 3},
        "melt_time_min": {"min": 20.0, "max": 80.0, "levels": 3},
    }

    # sample_generator.generate_sample_doe_data() 를 직접 사용
    result = generate_sample_doe_data(method=method, n_points=n_points)
    df: pd.DataFrame = result["design_matrix"]

    simulated = df.to_dict(orient="records")
    if not simulated:
        raise HTTPException(status_code=500, detail="샘플 생성 실패")

    qualities = [float(r.get("predicted_quality", r.get("quality_score", 0))) for r in simulated]
    best_idx  = int(np.argmax(qualities))
    n_defect  = sum(1 for q in qualities if q < 60)

    return {
        "method":        method,
        "method_name":   _DOE_META[method]["name"],
        "note":          f"{n_points}개 결정론적 샘플 데이터 (ML 모델 없이 생성됨)",
        "n_points":      n_points,
        "n_experiments": len(simulated),
        "simulated_data": simulated,
        "summary": {
            "mean":        round(float(np.mean(qualities)), 3),
            "std":         round(float(np.std(qualities)),  3),
            "min":         round(float(np.min(qualities)),  3),
            "max":         round(float(np.max(qualities)),  3),
            "n_defect":    n_defect,
            "defect_rate": round(n_defect / len(simulated) * 100, 1),
        },
        "optimal_point": simulated[best_idx],
        "factor_cols":   result["factor_cols"],
        "metadata":      result["metadata"],
    }
