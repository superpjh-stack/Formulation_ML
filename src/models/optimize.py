"""배합비율 최적화 — 품질 예측 모델을 objective function으로 사용."""
import numpy as np
import pandas as pd
from scipy.optimize import minimize

# 기본 성분별 허용 범위 (도메인 기본값 — 실제 스펙에 맞게 조정)
DEFAULT_BOUNDS = {
    "sn_pct": (55.0, 70.0),
    "ag_pct": (0.0, 5.0),
    "cu_pct": (0.0, 2.0),
    "pb_pct": (0.0, 45.0),
}

# 표준 배합비율 (초기값)
STANDARD_RATIOS = {"sn_pct": 62.0, "ag_pct": 3.0, "cu_pct": 0.5, "pb_pct": 34.5}


def recommend_ratios(
    process_conditions: dict,
    model,
    imputer,
    scaler,
    bounds: dict = None,
    standard_ratios: dict = None,
) -> dict:
    """신규 공정 조건에서 최적 배합비율을 추천한다.

    Args:
        process_conditions: {"melt_temp_c": 250, "melt_time_min": 45, "supplier_id_SUP_B": 0, ...}
        model: 학습된 품질 예측 모델
        imputer, scaler: 전처리 객체
        bounds: 성분별 (min, max) 허용 범위
        standard_ratios: 최적화 초기값 (기본: STANDARD_RATIOS)

    Returns:
        {"sn_pct": ..., "ag_pct": ..., "cu_pct": ..., "pb_pct": ...,
         "predicted_quality": ..., "success": bool, "message": str}
    """
    from src.features.engineering import SN_TARGET, AG_TARGET, CU_TARGET

    if bounds is None:
        bounds = DEFAULT_BOUNDS
    if standard_ratios is None:
        standard_ratios = STANDARD_RATIOS

    ratio_keys = list(bounds.keys())
    x0 = np.array([standard_ratios.get(k, 0.0) for k in ratio_keys])
    scipy_bounds = [bounds[k] for k in ratio_keys]

    def objective(ratios):
        row = dict(zip(ratio_keys, ratios))
        row.update(process_conditions)
        # 파생 피처 추가
        row["sn_deviation"] = row.get("sn_pct", 0) - SN_TARGET
        row["ag_deviation"] = row.get("ag_pct", 0) - AG_TARGET
        row["cu_deviation"] = row.get("cu_pct", 0) - CU_TARGET
        # other_pct: 전체 100%에서 주요 성분 합산 후 나머지
        row["other_pct"] = max(0.0, 100 - row.get("sn_pct", 0) - row.get("ag_pct", 0)
                               - row.get("cu_pct", 0) - row.get("pb_pct", 0))
        df_row = pd.DataFrame([row])

        # 스케일링 (NUM_COLS 우선)
        from src.features.engineering import NUM_COLS
        num_present = [c for c in NUM_COLS if c in df_row.columns]
        df_row[num_present] = imputer.transform(df_row[num_present])
        df_row[num_present] = scaler.transform(df_row[num_present])

        # 학습 시 피처 순서에 맞게 정렬 — feature_names_in_ 있으면 사용, 없으면 NUM_COLS만 선택
        if hasattr(model, "feature_names_in_"):
            for col in model.feature_names_in_:
                if col not in df_row.columns:
                    df_row[col] = 0.0
            df_row = df_row[model.feature_names_in_]
        else:
            df_row = df_row[num_present]

        pred = model.predict(df_row)[0]
        return -pred  # 최대화 → 부호 반전

    constraints = [
        # 주요 성분 합계 제약 (pb_pct = 100 - 나머지)
        {"type": "ineq", "fun": lambda r: 100 - sum(r)},
        {"type": "ineq", "fun": lambda r: sum(r) - 95},
    ]

    result = minimize(
        objective, x0,
        method="SLSQP",
        bounds=scipy_bounds,
        constraints=constraints,
        options={"ftol": 1e-6, "maxiter": 500},
    )

    if result.success:
        optimal_ratios = {k: float(round(float(v), 3)) for k, v in zip(ratio_keys, result.x)}
        # pb_pct 재계산 (합계 보정)
        if "pb_pct" in optimal_ratios:
            other_sum = sum(v for k, v in optimal_ratios.items() if k != "pb_pct")
            optimal_ratios["pb_pct"] = round(100.0 - other_sum, 3)
        optimal_ratios["predicted_quality"] = float(round(float(-result.fun), 3))
        optimal_ratios["success"] = True
        optimal_ratios["message"] = "최적화 성공"
    else:
        # fallback: 표준 배합비율 반환
        optimal_ratios = {k: float(v) for k, v in standard_ratios.items()}
        optimal_ratios["predicted_quality"] = None
        optimal_ratios["success"] = False
        optimal_ratios["message"] = f"최적화 실패 ({result.message}) — 표준 배합비율 반환"

    return optimal_ratios
