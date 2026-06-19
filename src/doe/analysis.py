"""DOE(실험계획법) 응답표면 분석 모듈.

솔더 합금 배합 최적화를 위한 RSM(Response Surface Methodology) 분석 함수 모음.
Plotly 차트 연동을 위한 직렬화 가능한 dict 형태로 데이터를 반환한다.
"""
from __future__ import annotations

import itertools
from typing import List

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures


# ---------------------------------------------------------------------------
# 내부 헬퍼
# ---------------------------------------------------------------------------

def _build_rsm_matrix(df: pd.DataFrame, factor_cols: List[str]):
    """2차 다항 피처 행렬과 컬럼명을 반환한다."""
    X = df[factor_cols].values.astype(float)
    poly = PolynomialFeatures(degree=2, include_bias=True)
    X_poly = poly.fit_transform(X)
    feature_names = poly.get_feature_names_out(factor_cols)
    return X_poly, feature_names, poly


def _ols_stats(X: np.ndarray, y: np.ndarray):
    """OLS 회귀 계수, p-value, R² 반환."""
    from numpy.linalg import lstsq

    n, p = X.shape
    coef, residuals, rank, _ = lstsq(X, y, rcond=None)
    y_pred = X @ coef
    ss_res = np.sum((y - y_pred) ** 2)
    ss_tot = np.sum((y - y.mean()) ** 2)
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 0.0

    # p-value 계산
    df_res = n - rank
    if df_res > 0 and ss_res > 0:
        mse = ss_res / df_res
        try:
            XtX_inv = np.linalg.pinv(X.T @ X)
            se = np.sqrt(np.maximum(np.diag(XtX_inv) * mse, 0))
            t_stats = coef / np.where(se > 1e-12, se, np.nan)
            p_values = 2 * stats.t.sf(np.abs(t_stats), df=df_res)
        except np.linalg.LinAlgError:
            p_values = np.full(p, np.nan)
    else:
        p_values = np.full(p, np.nan)

    return coef, p_values, r2, y_pred


# ---------------------------------------------------------------------------
# 1. response_surface_analysis
# ---------------------------------------------------------------------------

def response_surface_analysis(
    df: pd.DataFrame,
    response_col: str,
    factor_cols: List[str],
) -> dict:
    """2차 회귀 모델(RSM)을 피팅하고 계수/통계량을 반환한다.

    Returns:
        {
            "model_type": "RSM_2nd_order",
            "response": str,
            "factors": List[str],
            "r2": float,
            "adj_r2": float,
            "coefficients": {term: {"coef": float, "p_value": float}},
            "main_effects": {factor: coef},
            "interactions": {factor_i*factor_j: coef},
            "quadratic": {factor^2: coef},
            "n_obs": int,
        }
    """
    df = df.dropna(subset=[response_col] + factor_cols).copy()
    y = df[response_col].values.astype(float)
    X_poly, feature_names, _ = _build_rsm_matrix(df, factor_cols)

    coef, p_values, r2, _ = _ols_stats(X_poly, y)

    n, p = X_poly.shape
    adj_r2 = 1 - (1 - r2) * (n - 1) / max(n - p, 1)

    coefficients = {}
    for name, c, pv in zip(feature_names, coef, p_values):
        coefficients[name] = {
            "coef": float(round(c, 6)),
            "p_value": float(round(pv, 6)) if not np.isnan(pv) else None,
        }

    # 항 분류
    main_effects = {}
    interactions = {}
    quadratic = {}

    for name, c in zip(feature_names, coef):
        if name == "1":
            continue
        parts = name.split(" ")
        if len(parts) == 1:
            main_effects[name] = float(round(c, 6))
        elif len(parts) == 2 and parts[0] == parts[1]:
            quadratic[name] = float(round(c, 6))
        elif len(parts) == 2:
            interactions[name] = float(round(c, 6))

    return {
        "model_type": "RSM_2nd_order",
        "response": response_col,
        "factors": factor_cols,
        "r2": float(round(r2, 4)),
        "adj_r2": float(round(adj_r2, 4)),
        "coefficients": coefficients,
        "main_effects": main_effects,
        "interactions": interactions,
        "quadratic": quadratic,
        "n_obs": int(len(df)),
    }


# ---------------------------------------------------------------------------
# 2. main_effects_data
# ---------------------------------------------------------------------------

def main_effects_data(
    df: pd.DataFrame,
    response_col: str,
    factor_cols: List[str],
) -> dict:
    """각 인자의 주효과(Main Effect) 데이터를 Plotly 차트 형식으로 반환한다.

    각 인자를 5분위로 나눠 평균 응답값을 계산한다.
    다른 인자는 전체 평균으로 고정(One-Factor-at-a-Time 방식).

    Returns:
        {
            "grand_mean": float,
            "factors": {
                factor: {
                    "levels": List[float],
                    "means": List[float],
                    "effect_size": float,  # max - min
                }
            }
        }
    """
    df = df.dropna(subset=[response_col] + factor_cols).copy()
    grand_mean = float(df[response_col].mean())

    factors_data = {}
    for col in factor_cols:
        bins = pd.qcut(df[col], q=5, duplicates="drop")
        grouped = df.groupby(bins, observed=True)[response_col].mean()
        levels = [float(round(interval.mid, 4)) for interval in grouped.index]
        means = [float(round(v, 4)) for v in grouped.values]
        effect_size = float(round(max(means) - min(means), 4)) if means else 0.0

        factors_data[col] = {
            "levels": levels,
            "means": means,
            "effect_size": effect_size,
        }

    return {
        "grand_mean": float(round(grand_mean, 4)),
        "factors": factors_data,
    }


# ---------------------------------------------------------------------------
# 3. interaction_effects_data
# ---------------------------------------------------------------------------

def interaction_effects_data(
    df: pd.DataFrame,
    response_col: str,
    factor_cols: List[str],
) -> dict:
    """2인자 교호작용(Interaction Effect) 데이터를 Plotly 차트 형식으로 반환한다.

    각 인자를 Low/High 2수준으로 나눠 교호작용 패턴을 계산한다.

    Returns:
        {
            "pairs": [
                {
                    "factor_a": str,
                    "factor_b": str,
                    "factor_b_low": {
                        "factor_a_levels": [low, high],
                        "means": [float, float],
                    },
                    "factor_b_high": {
                        "factor_a_levels": [low, high],
                        "means": [float, float],
                    },
                    "interaction_magnitude": float,
                }
            ]
        }
    """
    df = df.dropna(subset=[response_col] + factor_cols).copy()
    pairs = []

    for col_a, col_b in itertools.combinations(factor_cols, 2):
        med_a = df[col_a].median()
        med_b = df[col_b].median()

        low_a = df[col_a] <= med_a
        high_a = df[col_a] > med_a
        low_b = df[col_b] <= med_b
        high_b = df[col_b] > med_b

        def _safe_mean(mask):
            sub = df.loc[mask, response_col]
            return float(round(sub.mean(), 4)) if len(sub) > 0 else float("nan")

        # factor_b = Low 고정 시 factor_a 효과
        b_low_a_low = _safe_mean(low_a & low_b)
        b_low_a_high = _safe_mean(high_a & low_b)
        # factor_b = High 고정 시 factor_a 효과
        b_high_a_low = _safe_mean(low_a & high_b)
        b_high_a_high = _safe_mean(high_a & high_b)

        # 교호작용 크기: 두 선의 기울기 차이
        slope_b_low = b_low_a_high - b_low_a_low
        slope_b_high = b_high_a_high - b_high_a_low
        interaction_magnitude = float(round(abs(slope_b_high - slope_b_low), 4))

        level_a_low = float(round(df.loc[low_a, col_a].mean(), 4))
        level_a_high = float(round(df.loc[high_a, col_a].mean(), 4))

        pairs.append({
            "factor_a": col_a,
            "factor_b": col_b,
            "factor_b_low": {
                "factor_a_levels": [level_a_low, level_a_high],
                "means": [b_low_a_low, b_low_a_high],
            },
            "factor_b_high": {
                "factor_a_levels": [level_a_low, level_a_high],
                "means": [b_high_a_low, b_high_a_high],
            },
            "interaction_magnitude": interaction_magnitude,
        })

    # 교호작용 크기 내림차순 정렬
    pairs.sort(key=lambda x: x["interaction_magnitude"], reverse=True)
    return {"pairs": pairs}


# ---------------------------------------------------------------------------
# 4. anova_table
# ---------------------------------------------------------------------------

def anova_table(
    df: pd.DataFrame,
    response_col: str,
    factor_cols: List[str],
) -> list[dict]:
    """분산분석표를 계산한다.

    각 인자(주효과)의 SS를 순차 SS(Type I)로 분해한다.
    교호작용 및 잔차, 전체 SS도 포함.

    Returns:
        [
            {"source": str, "ss": float, "df": int, "ms": float,
             "f_stat": float | None, "p_value": float | None},
            ...
        ]
    """
    df = df.dropna(subset=[response_col] + factor_cols).copy()
    y = df[response_col].values.astype(float)
    n = len(y)
    grand_mean = y.mean()
    ss_total = float(np.sum((y - grand_mean) ** 2))
    df_total = n - 1

    rows = []
    ss_model_cumulative = 0.0
    df_model_cumulative = 0

    # 주효과 순차 SS
    for i, col in enumerate(factor_cols):
        prev_cols = factor_cols[: i + 1]
        X_curr = df[prev_cols].values.astype(float)
        ones = np.ones((n, 1))
        X_curr_full = np.hstack([ones, X_curr])

        coef_curr, _, _, _ = np.linalg.lstsq(X_curr_full, y, rcond=None)
        y_pred_curr = X_curr_full @ coef_curr
        ss_reg_curr = float(np.sum((y_pred_curr - grand_mean) ** 2))
        ss_this = ss_reg_curr - ss_model_cumulative
        ss_model_cumulative = ss_reg_curr
        df_this = 1
        df_model_cumulative += df_this
        ms = ss_this / df_this if df_this > 0 else 0.0
        rows.append({"_source": col, "_ss": ss_this, "_df": df_this, "_ms": ms})

    # 교호작용 (2인자)
    interaction_terms = []
    for col_a, col_b in itertools.combinations(factor_cols, 2):
        interaction_terms.append((f"{col_a}:{col_b}", col_a, col_b))

    for term_name, col_a, col_b in interaction_terms:
        prev_terms_cols = factor_cols + [f"_inter_{col_a}_{col_b}"]
        df_ext = df[factor_cols].copy()
        df_ext[f"_inter_{col_a}_{col_b}"] = df[col_a] * df[col_b]
        X_inter = df_ext.values.astype(float)
        X_inter_full = np.hstack([np.ones((n, 1)), X_inter])
        coef_inter, _, _, _ = np.linalg.lstsq(X_inter_full, y, rcond=None)
        y_pred_inter = X_inter_full @ coef_inter
        ss_reg_inter = float(np.sum((y_pred_inter - grand_mean) ** 2))
        ss_this = ss_reg_inter - ss_model_cumulative
        ss_model_cumulative = ss_reg_inter
        df_this = 1
        df_model_cumulative += df_this
        ms = ss_this / df_this if df_this > 0 else 0.0
        rows.append({"_source": term_name, "_ss": ss_this, "_df": df_this, "_ms": ms})

    # 잔차
    ss_residual = ss_total - ss_model_cumulative
    df_residual = df_total - df_model_cumulative
    ms_residual = ss_residual / df_residual if df_residual > 0 else 0.0

    # F 통계량 및 p-value 계산
    result = []
    for row in rows:
        ss = row["_ss"]
        df_i = row["_df"]
        ms_i = row["_ms"]
        if ms_residual > 0 and df_i > 0:
            f_stat = ms_i / ms_residual
            p_val = float(1 - stats.f.cdf(f_stat, df_i, df_residual))
        else:
            f_stat, p_val = None, None

        result.append({
            "source": row["_source"],
            "ss": float(round(ss, 4)),
            "df": int(df_i),
            "ms": float(round(ms_i, 4)),
            "f_stat": float(round(f_stat, 4)) if f_stat is not None else None,
            "p_value": float(round(p_val, 6)) if p_val is not None else None,
        })

    result.append({
        "source": "Residual",
        "ss": float(round(ss_residual, 4)),
        "df": int(df_residual),
        "ms": float(round(ms_residual, 4)),
        "f_stat": None,
        "p_value": None,
    })
    result.append({
        "source": "Total",
        "ss": float(round(ss_total, 4)),
        "df": int(df_total),
        "ms": None,
        "f_stat": None,
        "p_value": None,
    })

    return result


# ---------------------------------------------------------------------------
# 5. find_optimum
# ---------------------------------------------------------------------------

def find_optimum(
    df: pd.DataFrame,
    response_col: str,
    maximize: bool = True,
) -> dict:
    """데이터프레임 내에서 최적 실험 조건을 반환한다.

    Args:
        df: 실험 결과 데이터프레임 (설계 행렬 + 응답값 포함)
        response_col: 최적화할 응답 컬럼명
        maximize: True → 최대화, False → 최소화

    Returns:
        {
            "optimal_row": dict,        # 최적 행 전체 값
            "response_value": float,    # 최적 응답값
            "optimize_direction": str,  # "maximize" | "minimize"
            "row_index": int,           # 원본 df index
            "percentile_rank": float,   # 전체 중 상위/하위 몇 %
        }
    """
    df = df.dropna(subset=[response_col]).copy()
    if df.empty:
        return {"error": "데이터가 없습니다."}

    if maximize:
        idx = df[response_col].idxmax()
    else:
        idx = df[response_col].idxmin()

    optimal_val = float(df.loc[idx, response_col])
    all_vals = df[response_col].values

    if maximize:
        percentile_rank = float(round((all_vals <= optimal_val).mean() * 100, 1))
    else:
        percentile_rank = float(round((all_vals >= optimal_val).mean() * 100, 1))

    optimal_row = {
        col: (float(v) if isinstance(v, (np.floating, np.integer)) else v)
        for col, v in df.loc[idx].items()
    }

    return {
        "optimal_row": optimal_row,
        "response_value": float(round(optimal_val, 4)),
        "optimize_direction": "maximize" if maximize else "minimize",
        "row_index": int(idx),
        "percentile_rank": percentile_rank,
    }
