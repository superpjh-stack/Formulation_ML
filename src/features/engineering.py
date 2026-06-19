import pandas as pd
import numpy as np
import joblib
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

ARTIFACTS_DIR = Path(__file__).parent.parent.parent / "models" / "artifacts"

SN_TARGET = 62.0
AG_TARGET = 3.0
CU_TARGET = 0.5

NUM_COLS = ["sn_pct", "ag_pct", "cu_pct", "pb_pct",
            "melt_temp_c", "melt_time_min",
            "sn_deviation", "ag_deviation", "cu_deviation"]


def build_features(df: pd.DataFrame, target_col: str,
                   imputer=None, scaler=None, fit: bool = True):
    """피처 엔지니어링 + 전처리.

    Returns (X, y, imputer, scaler) — fit=True 시 새로 학습, False 시 전달된 객체 사용.
    """
    df = df.copy()

    # 파생 피처: 목표값 대비 편차
    df["sn_deviation"] = df["sn_pct"] - SN_TARGET
    df["ag_deviation"] = df["ag_pct"] - AG_TARGET
    df["cu_deviation"] = df["cu_pct"] - CU_TARGET

    y = df[target_col] if target_col in df.columns else pd.Series(dtype=float)
    drop_cols = [c for c in [target_col, "lot_id", "is_defect", "quality_score"] if c in df.columns]
    X = df.drop(columns=drop_cols)

    # 범주형 인코딩
    cat_cols = X.select_dtypes(exclude=[np.number]).columns.tolist()
    if cat_cols:
        X = pd.get_dummies(X, columns=cat_cols, drop_first=True)

    present_num = [c for c in NUM_COLS if c in X.columns]

    if fit:
        imputer = SimpleImputer(strategy="median")
        scaler = StandardScaler()
        X[present_num] = imputer.fit_transform(X[present_num])
        X[present_num] = scaler.fit_transform(X[present_num])
    else:
        X[present_num] = imputer.transform(X[present_num])
        X[present_num] = scaler.transform(X[present_num])

    return X, y, imputer, scaler


def save_preprocessors(imputer, scaler, name: str = "default") -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"imputer": imputer, "scaler": scaler},
                ARTIFACTS_DIR / f"preprocessors_{name}.joblib")


def load_preprocessors(name: str = "default"):
    obj = joblib.load(ARTIFACTS_DIR / f"preprocessors_{name}.joblib")
    return obj["imputer"], obj["scaler"]
