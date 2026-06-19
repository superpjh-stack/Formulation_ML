"""DOE 실험 데이터 생성 모듈.

두 가지 역할:
  1. generate_doe_experiment() — 학습된 ML 모델로 DOE 설계 행렬의 응답값을 시뮬레이션.
  2. generate_sample_doe_data()  — ML 모델 없이도 동작하는 데모용 샘플 DOE 데이터 생성.
"""
from __future__ import annotations

import itertools
from typing import List, Literal, Optional

import numpy as np
import pandas as pd

# 솔더 도메인 상수 (generate_sample.py 와 동일한 기준값)
SN_TARGET = 62.0
AG_TARGET = 3.0
CU_TARGET = 0.5
TEMP_TARGET = 250.0

_RNG_SEED = 42

# 공급사별 성분 편차 효과 — /doe/compare 실이력 200 LOT 재보정 (2026-06-18)
# sn/ag/cu_bias: SUP_B 기준 상대편차(SUP_B=0), noise_mult: SUP_B std 대비 비율
SUPPLIER_EFFECTS: dict = {
    "SUP_A": {"sn_bias": +0.37, "ag_bias": +0.18, "cu_bias": +0.01, "noise_mult": 1.02},
    "SUP_B": {"sn_bias":  0.0,  "ag_bias":  0.0,  "cu_bias":  0.00, "noise_mult": 1.0},
    "SUP_C": {"sn_bias": +0.47, "ag_bias": +0.04, "cu_bias": +0.02, "noise_mult": 1.22},
}


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _solder_quality(
    sn: np.ndarray,
    ag: np.ndarray,
    cu: np.ndarray,
    temp: np.ndarray,
    time: np.ndarray,
    noise_std: float = 0.0,
    rng: Optional[np.random.Generator] = None,
    supplier: Optional[str] = None,
) -> np.ndarray:
    """솔더 품질 점수 결정론적 모델 — 공급사 효과(TD-3) 포함."""
    # 공급사 편차 적용
    eff = SUPPLIER_EFFECTS.get(supplier or "SUP_B", SUPPLIER_EFFECTS["SUP_B"])
    sn_eff = sn + eff["sn_bias"]
    ag_eff = ag + eff["ag_bias"]
    cu_eff = cu + eff["cu_bias"]
    effective_noise = noise_std * eff["noise_mult"]

    score = (
        100
        - 3.0 * np.abs(sn_eff - SN_TARGET)
        - 5.0 * np.abs(ag_eff - AG_TARGET)
        - 8.0 * np.abs(cu_eff - CU_TARGET)
        - 0.3 * np.abs(temp - TEMP_TARGET)
        - 0.1 * np.abs(time - 45)
    )
    if effective_noise > 0:
        if rng is None:
            rng = np.random.default_rng(_RNG_SEED)
        score = score + rng.normal(0, effective_noise, size=score.shape)
    return np.clip(score, 50, 100)


# ---------------------------------------------------------------------------
# 1. generate_doe_experiment
# ---------------------------------------------------------------------------

def generate_doe_experiment(
    design_df: pd.DataFrame,
    model,
    imputer,
    scaler,
) -> pd.DataFrame:
    """DOE 설계 행렬에 ML 모델로 예측한 품질점수를 시뮬레이션하여 반환한다.

    설계 행렬(design_df)에는 최소한 다음 컬럼이 있어야 한다:
      sn_pct, ag_pct, cu_pct, melt_temp_c, melt_time_min
    선택 컬럼: pb_pct, other_pct, supplier_id

    build_features(fit=False) 를 사용해 학습 때와 동일한 전처리를 적용한다.

    Args:
        design_df: DOE 설계 행렬 (n_runs × factor_cols)
        model: 학습된 sklearn 호환 회귀 모델
        imputer: 저장된 SimpleImputer
        scaler: 저장된 StandardScaler

    Returns:
        design_df + ["predicted_quality", "noise_quality"] 컬럼이 추가된 DataFrame
    """
    from src.features.engineering import build_features

    df = design_df.copy()

    # 필수 컬럼 기본값 채우기
    if "pb_pct" not in df.columns:
        df["pb_pct"] = np.clip(
            100 - df["sn_pct"] - df["ag_pct"] - df.get("cu_pct", CU_TARGET),
            0, 45,
        )
    if "other_pct" not in df.columns:
        df["other_pct"] = np.clip(
            100 - df["sn_pct"] - df["ag_pct"] - df["cu_pct"] - df["pb_pct"],
            0, 2,
        )
    if "supplier_id" not in df.columns:
        df["supplier_id"] = "SUP_A"

    # 더미 타겟 컬럼 추가 (build_features 가 target_col 을 drop 하므로 임의값 사용)
    _DUMMY_TARGET = "_dummy_target_"
    df[_DUMMY_TARGET] = 0.0

    X, _, _, _ = build_features(df, target_col=_DUMMY_TARGET, imputer=imputer, scaler=scaler, fit=False)

    # 학습 시 피처 순서 맞추기
    if hasattr(model, "feature_names_in_"):
        for col in model.feature_names_in_:
            if col not in X.columns:
                X[col] = 0.0
        X = X[model.feature_names_in_]

    predicted = model.predict(X).astype(float)
    predicted = np.clip(predicted, 50, 100)

    rng = np.random.default_rng(_RNG_SEED)
    noise = rng.normal(0, 1.5, size=predicted.shape)
    noise_quality = np.clip(predicted + noise, 50, 100)

    result = design_df.copy()
    result["predicted_quality"] = np.round(predicted, 3)
    result["noise_quality"] = np.round(noise_quality, 3)
    return result


# ---------------------------------------------------------------------------
# 2. generate_sample_doe_data
# ---------------------------------------------------------------------------

def generate_sample_doe_data(
    method: Literal["ccd", "full_factorial", "lhs", "box_behnken"] = "ccd",
    n_points: int = 20,
) -> dict:
    """ML 모델 없이 동작하는 데모용 DOE 샘플 데이터를 생성한다.

    솔더 도메인 지식을 반영한 결정론적 품질 함수를 사용한다.

    Args:
        method: DOE 설계 방법
            - "ccd"            Central Composite Design (Box-Wilson)
            - "full_factorial"  2수준 완전요인 설계 + 중심점
            - "lhs"            Latin Hypercube Sampling
            - "box_behnken"    Box-Behnken Design (3인자)
        n_points: LHS/임의 설계에서 실험점 수 (ccd/full_factorial/box_behnken 은 무시됨)

    Returns:
        {
            "method": str,
            "design_matrix": pd.DataFrame,   # 인자 + 응답값
            "factor_cols": List[str],
            "response_col": str,
            "metadata": dict,
        }
    """
    rng = np.random.default_rng(_RNG_SEED)

    # 인자 정의 (코딩된 수준 → 실제값 변환)
    factors = {
        "sn_pct":        {"low": 59.0,  "center": 62.0,  "high": 65.0},
        "ag_pct":        {"low": 2.0,   "center": 3.0,   "high": 4.0},
        "cu_pct":        {"low": 0.2,   "center": 0.5,   "high": 0.8},
        "melt_temp_c":   {"low": 230.0, "center": 250.0, "high": 270.0},
        "melt_time_min": {"low": 30.0,  "center": 45.0,  "high": 60.0},
    }
    factor_cols = list(factors.keys())
    response_col = "quality_score"

    def decode(coded: np.ndarray, col: str) -> np.ndarray:
        """코딩값 [-1, 0, +1] → 실제값."""
        lo, hi = factors[col]["low"], factors[col]["high"]
        return lo + (coded + 1) / 2 * (hi - lo)

    # -----------------------------------------------------------------------
    # CCD (Central Composite Design)
    # -----------------------------------------------------------------------
    if method == "ccd":
        k = len(factors)
        alpha = k ** 0.5  # 구면 CCD

        # 2^k 완전요인 부분
        factorial_pts = list(itertools.product([-1, 1], repeat=k))
        # 축점(axial)
        axial_pts = []
        for i in range(k):
            for sign in [-alpha, alpha]:
                pt = [0.0] * k
                pt[i] = sign
                axial_pts.append(pt)
        # 중심점 (5회 반복)
        center_pts = [[0.0] * k] * 5

        all_pts = np.array(factorial_pts + axial_pts + center_pts, dtype=float)
        # 축점 값이 [-1, 1] 범위를 초과하므로 클리핑 후 스케일링
        all_pts_clipped = np.clip(all_pts, -alpha, alpha) / alpha

        rows = []
        for coded_row in all_pts_clipped:
            row = {}
            for j, col in enumerate(factor_cols):
                real_val = decode(np.array([coded_row[j]]), col)[0]
                row[col] = float(round(real_val, 3))
            rows.append(row)

        df = pd.DataFrame(rows)
        n_runs = len(df)
        metadata = {
            "n_factorial": len(factorial_pts),
            "n_axial": len(axial_pts),
            "n_center": 5,
            "alpha": float(round(alpha, 4)),
        }

    # -----------------------------------------------------------------------
    # Full Factorial (2수준 + 중심점)
    # -----------------------------------------------------------------------
    elif method == "full_factorial":
        factorial_pts = list(itertools.product([-1, 1], repeat=len(factors)))
        center_pts = [[0.0] * len(factors)] * 3

        all_pts = factorial_pts + center_pts
        rows = []
        for coded_row in all_pts:
            row = {}
            for j, col in enumerate(factor_cols):
                coded_val = float(coded_row[j])
                real_val = decode(np.array([coded_val]), col)[0]
                row[col] = float(round(real_val, 3))
            rows.append(row)

        df = pd.DataFrame(rows)
        n_runs = len(df)
        metadata = {
            "n_factorial": len(factorial_pts),
            "n_center": 3,
            "levels": 2,
        }

    # -----------------------------------------------------------------------
    # LHS (Latin Hypercube Sampling)
    # -----------------------------------------------------------------------
    elif method == "lhs":
        k = len(factors)
        # LHS: 각 인자를 n_points 구간으로 나눠 무작위 샘플
        lhs_matrix = np.zeros((n_points, k))
        for j in range(k):
            perms = rng.permutation(n_points)
            lhs_matrix[:, j] = (perms + rng.uniform(0, 1, n_points)) / n_points

        rows = []
        for i in range(n_points):
            row = {}
            for j, col in enumerate(factor_cols):
                lo, hi = factors[col]["low"], factors[col]["high"]
                real_val = lo + lhs_matrix[i, j] * (hi - lo)
                row[col] = float(round(real_val, 3))
            rows.append(row)

        df = pd.DataFrame(rows)
        n_runs = n_points
        metadata = {
            "n_points": n_points,
            "lhs_type": "maximin",
        }

    # -----------------------------------------------------------------------
    # Box-Behnken (3인자만 사용: sn_pct, ag_pct, melt_temp_c)
    # -----------------------------------------------------------------------
    elif method == "box_behnken":
        # Box-Behnken 3인자 표준 설계 행렬
        bb_cols = ["sn_pct", "ag_pct", "melt_temp_c"]
        bb_matrix = [
            [-1, -1,  0], [-1,  1,  0], [ 1, -1,  0], [ 1,  1,  0],
            [-1,  0, -1], [-1,  0,  1], [ 1,  0, -1], [ 1,  0,  1],
            [ 0, -1, -1], [ 0, -1,  1], [ 0,  1, -1], [ 0,  1,  1],
            [ 0,  0,  0], [ 0,  0,  0], [ 0,  0,  0],  # 중심점 3회
        ]
        # 나머지 인자는 중심값 고정
        other_factors = [c for c in factor_cols if c not in bb_cols]

        rows = []
        for coded_row in bb_matrix:
            row = {}
            for j, col in enumerate(bb_cols):
                coded_val = float(coded_row[j])
                real_val = decode(np.array([coded_val]), col)[0]
                row[col] = float(round(real_val, 3))
            for col in other_factors:
                row[col] = float(factors[col]["center"])
            rows.append(row)

        df = pd.DataFrame(rows)
        factor_cols = bb_cols + other_factors
        n_runs = len(df)
        metadata = {
            "active_factors": bb_cols,
            "fixed_factors": {c: factors[c]["center"] for c in other_factors},
            "n_center": 3,
        }
    else:
        raise ValueError(f"지원하지 않는 method: {method!r}. "
                         f"'ccd', 'full_factorial', 'lhs', 'box_behnken' 중 하나를 선택하세요.")

    # -----------------------------------------------------------------------
    # 응답값 계산 (결정론적 함수 + 현실적 노이즈)
    # -----------------------------------------------------------------------
    sn   = df["sn_pct"].values
    ag   = df["ag_pct"].values
    cu   = df["cu_pct"].values
    temp = df["melt_temp_c"].values
    time = df["melt_time_min"].values

    # 공급사 배열 (LHS/CCD 모두 순환 배정)
    suppliers_arr = np.array([list(SUPPLIER_EFFECTS.keys())[i % 3] for i in range(len(df))])
    df["supplier"] = suppliers_arr

    # 공급사별 품질 계산 (TD-3: 벡터화 대신 공급사별 그룹 처리)
    predicted = np.zeros(len(df))
    noise_quality_arr = np.zeros(len(df))
    for sup in SUPPLIER_EFFECTS:
        mask = suppliers_arr == sup
        if not mask.any():
            continue
        predicted[mask] = _solder_quality(
            sn[mask], ag[mask], cu[mask], temp[mask], time[mask],
            noise_std=0.0, supplier=sup,
        )
        noise_quality_arr[mask] = _solder_quality(
            sn[mask], ag[mask], cu[mask], temp[mask], time[mask],
            noise_std=1.5, rng=rng, supplier=sup,
        )

    # pb_pct, other_pct 계산 (합계 100%)
    df["pb_pct"]    = np.round(np.clip(100 - sn - ag - cu, 0, 45), 3)
    df["other_pct"] = 0.0

    df["predicted_quality"] = np.round(predicted, 3)
    df[response_col]         = np.round(noise_quality_arr, 3)

    # 컬럼 순서 정렬
    base_cols = ["sn_pct", "ag_pct", "cu_pct", "pb_pct", "other_pct",
                 "melt_temp_c", "melt_time_min"]
    extra = [c for c in df.columns if c not in base_cols + ["predicted_quality", response_col]]
    ordered = base_cols + extra + ["predicted_quality", response_col]
    df = df[[c for c in ordered if c in df.columns]]

    # run_id 추가
    df.insert(0, "run_id", [f"RUN-{i+1:03d}" for i in range(n_runs)])

    metadata.update({
        "method": method,
        "n_runs": n_runs,
        "factor_ranges": {
            col: {"low": v["low"], "center": v["center"], "high": v["high"]}
            for col, v in factors.items()
        },
    })

    return {
        "method": method,
        "design_matrix": df,
        "factor_cols": factor_cols,
        "response_col": response_col,
        "metadata": metadata,
    }
