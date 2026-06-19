"""배합비율 ML 학습 스크립트.

Usage:
    python scripts/train.py --data formulation_history.csv --target quality_score --model random_forest
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data.loader import load_raw
from src.features.engineering import build_features, save_preprocessors
from src.models.train import train, cross_validate, save_model, get_feature_importance
from src.evaluation.metrics import regression_report, print_report
from sklearn.model_selection import train_test_split


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--model", default="random_forest",
                        choices=["ridge", "random_forest", "gradient_boosting", "xgboost"])
    parser.add_argument("--test-size", type=float, default=0.2)
    args = parser.parse_args()

    df = load_raw(args.data)
    print(f"데이터 로드: {len(df)}건")

    X, y, imputer, scaler = build_features(df, target_col=args.target, fit=True)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=args.test_size, random_state=42
    )

    print(f"\n[{args.model}] 교차 검증 (5-Fold):")
    cv = cross_validate(X_train, y_train, model_name=args.model)
    print(f"  RMSE: {cv['rmse_mean']:.4f} ± {cv['rmse_std']:.4f}")
    print(f"  R²  : {cv['r2_mean']:.4f} ± {cv['r2_std']:.4f}")
    print(f"  MAPE: {cv['mape_mean']:.2f}% ± {cv['mape_std']:.2f}%")

    X_val, X_eval, y_val, y_eval = train_test_split(X_train, y_train, test_size=0.2, random_state=0)
    model = train(X_train, y_train, model_name=args.model, X_val=X_val, y_val=y_val)

    report = regression_report(y_test, model.predict(X_test))
    print(f"\n[{args.model}] 테스트셋 결과:")
    print_report(report)

    # 성능 목표 확인
    r2, mape = report["R2"], report.get("MAPE", float("inf"))
    if r2 >= 0.85 or mape <= 10.0:
        print(f"\n목표 달성: R²={r2:.3f} (≥0.85) / MAPE={mape:.2f}% (≤10%)")
    else:
        print(f"\n목표 미달: R²={r2:.3f} / MAPE={mape:.2f}% — 모델 고도화 필요")

    imp = get_feature_importance(model, list(X.columns))
    if imp:
        print("\n피처 중요도 TOP10:")
        for feat, val in imp.items():
            print(f"  {feat:30s}: {val:.4f}")

    save_model(model, args.model)
    save_preprocessors(imputer, scaler, name=args.model)
    print(f"\n모델 저장: models/artifacts/{args.model}.joblib")
    print(f"전처리기 저장: models/artifacts/preprocessors_{args.model}.joblib")

    meta = {
        "name": args.model,
        "metrics": {
            "mae": round(report["MAE"], 4),
            "rmse": round(report["RMSE"], 4),
            "r2": round(report["R2"], 4),
            "mape": round(report.get("MAPE", 0.0), 4),
        },
        "feature_importances": [
            {"feature": f, "importance": round(float(v), 6)}
            for f, v in imp.items()
        ],
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }
    meta_path = Path("models/artifacts") / f"{args.model}_meta.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"메타데이터 저장: {meta_path}")


if __name__ == "__main__":
    main()
