import joblib
from pathlib import Path
from sklearn.linear_model import Ridge
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.model_selection import cross_val_score
import numpy as np

ARTIFACTS_DIR = Path(__file__).parent.parent.parent / "models" / "artifacts"

REGISTRY = {
    "ridge": Ridge(alpha=1.0),
    "random_forest": RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1),
    "gradient_boosting": GradientBoostingRegressor(n_estimators=200, random_state=42),
}

try:
    from xgboost import XGBRegressor
    # early_stopping_rounds는 REGISTRY에 포함하지 않음 — CV 시 검증셋 불필요
    REGISTRY["xgboost"] = XGBRegressor(
        n_estimators=300, learning_rate=0.05, max_depth=5,
        subsample=0.8, colsample_bytree=0.8,
        random_state=42, eval_metric="rmse", verbosity=0,
    )
except ImportError:
    pass  # xgboost 미설치 시 무시


def train(X, y, model_name: str = "random_forest", X_val=None, y_val=None):
    import sklearn.base
    model = sklearn.base.clone(REGISTRY[model_name])

    if model_name == "xgboost" and X_val is not None:
        # early stopping은 train() 단계에서만 적용
        model.set_params(early_stopping_rounds=20)
        model.fit(X, y, eval_set=[(X_val, y_val)], verbose=False)
    else:
        model.fit(X, y)
    return model


def cross_validate(X, y, model_name: str = "random_forest", cv: int = 5) -> dict:
    import sklearn.base
    model = sklearn.base.clone(REGISTRY[model_name])
    rmse_scores = cross_val_score(model, X, y, cv=cv, scoring="neg_root_mean_squared_error")
    r2_scores = cross_val_score(model, X, y, cv=cv, scoring="r2")
    mape_scores = cross_val_score(model, X, y, cv=cv, scoring="neg_mean_absolute_percentage_error")
    return {
        "rmse_mean": -rmse_scores.mean(),
        "rmse_std": rmse_scores.std(),
        "r2_mean": r2_scores.mean(),
        "r2_std": r2_scores.std(),
        "mape_mean": -mape_scores.mean() * 100,
        "mape_std": mape_scores.std() * 100,
    }


def save_model(model, name: str) -> None:
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, ARTIFACTS_DIR / f"{name}.joblib")


def load_model(name: str):
    return joblib.load(ARTIFACTS_DIR / f"{name}.joblib")


def get_feature_importance(model, feature_names: list, top_n: int = 10) -> dict:
    if hasattr(model, "feature_importances_"):
        importances = model.feature_importances_
    elif hasattr(model, "coef_"):
        importances = np.abs(model.coef_)
    else:
        return {}
    pairs = sorted(zip(feature_names, importances), key=lambda x: x[1], reverse=True)
    return dict(pairs[:top_n])
