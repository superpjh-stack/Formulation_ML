"""Run inference on new formulation data.

Usage:
    python scripts/predict.py --data new_samples.csv --target viscosity --model random_forest
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.data.loader import load_raw, save_processed
from src.features.engineering import build_features, load_preprocessors
from src.models.train import load_model
import pandas as pd


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="CSV filename in data/raw/")
    parser.add_argument("--target", required=True, help="Target column name")
    parser.add_argument("--model", required=True)
    parser.add_argument("--output", default="predictions.csv")
    args = parser.parse_args()

    df = load_raw(args.data)
    imputer, scaler = load_preprocessors(name=args.model)
    X, _, _, _ = build_features(df, target_col=args.target,
                                 imputer=imputer, scaler=scaler, fit=False)

    model = load_model(args.model)
    preds = model.predict(X)

    result = df.copy()
    result["prediction"] = preds
    save_processed(result, args.output)
    print(f"Predictions saved to data/processed/{args.output}")


if __name__ == "__main__":
    main()
