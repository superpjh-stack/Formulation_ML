"""배합비율 최적화 단위 테스트"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

import numpy as np
import pytest
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
from src.models.optimize import recommend_ratios, DEFAULT_BOUNDS, STANDARD_RATIOS
from src.features.engineering import NUM_COLS


def _make_dummy_artifacts():
    """테스트용 더미 모델과 전처리기 반환."""
    import pandas as pd

    np.random.seed(0)
    n = 100
    sn = np.random.uniform(55, 70, n)
    ag = np.random.uniform(0, 5, n)
    cu = np.random.uniform(0, 2, n)
    pb = 100 - sn - ag - cu - 0.3
    melt_temp = np.random.uniform(220, 290, n)
    melt_time = np.random.uniform(20, 90, n)
    sn_dev = sn - 62.0
    ag_dev = ag - 3.0
    cu_dev = cu - 0.5

    X = pd.DataFrame({
        "sn_pct": sn, "ag_pct": ag, "cu_pct": cu, "pb_pct": pb,
        "melt_temp_c": melt_temp, "melt_time_min": melt_time,
        "sn_deviation": sn_dev, "ag_deviation": ag_dev, "cu_deviation": cu_dev,
    })
    y = 100 - 3*np.abs(sn_dev) - 5*np.abs(ag_dev) - 8*np.abs(cu_dev) + np.random.normal(0, 2, n)

    imputer = SimpleImputer(strategy="median").fit(X)
    X_imp = imputer.transform(X)
    scaler = StandardScaler().fit(X_imp)
    X_scaled = scaler.transform(X_imp)

    model = RandomForestRegressor(n_estimators=20, random_state=0)
    model.fit(X_scaled, y)

    return model, imputer, scaler


def test_recommend_returns_dict():
    model, imputer, scaler = _make_dummy_artifacts()
    result = recommend_ratios(
        process_conditions={"melt_temp_c": 250, "melt_time_min": 45,
                            "supplier_id_SUP_B": 0, "supplier_id_SUP_C": 0},
        model=model, imputer=imputer, scaler=scaler,
    )
    assert isinstance(result, dict)
    assert "sn_pct" in result
    assert "predicted_quality" in result


def test_recommend_ratios_in_bounds():
    model, imputer, scaler = _make_dummy_artifacts()
    result = recommend_ratios(
        process_conditions={"melt_temp_c": 250, "melt_time_min": 45,
                            "supplier_id_SUP_B": 0, "supplier_id_SUP_C": 0},
        model=model, imputer=imputer, scaler=scaler,
    )
    if result["success"]:
        for key, (lo, hi) in DEFAULT_BOUNDS.items():
            assert lo <= result[key] <= hi + 1e-3, f"{key} 범위 초과: {result[key]}"


def test_fallback_on_bad_bounds():
    """불가능한 bounds 입력 시 fallback 동작 확인."""
    model, imputer, scaler = _make_dummy_artifacts()
    bad_bounds = {"sn_pct": (100.0, 100.0), "ag_pct": (0.0, 0.0),
                  "cu_pct": (0.0, 0.0), "pb_pct": (0.0, 0.0)}
    result = recommend_ratios(
        process_conditions={"melt_temp_c": 250, "melt_time_min": 45,
                            "supplier_id_SUP_B": 0, "supplier_id_SUP_C": 0},
        model=model, imputer=imputer, scaler=scaler,
        bounds=bad_bounds,
    )
    # 성공 여부와 관계없이 결과 딕셔너리는 반환되어야 함
    assert "message" in result


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
