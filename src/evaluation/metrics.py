import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def regression_report(y_true, y_pred) -> dict:
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    y_true_arr = np.array(y_true)
    nonzero = y_true_arr != 0
    mape = np.mean(np.abs((y_true_arr[nonzero] - np.array(y_pred)[nonzero]) / y_true_arr[nonzero])) * 100
    return {
        "MAE": mean_absolute_error(y_true, y_pred),
        "RMSE": rmse,
        "R2": r2_score(y_true, y_pred),
        "MAPE": mape,
    }


def print_report(report: dict) -> None:
    labels = {"MAE": "MAE ", "RMSE": "RMSE", "R2": "R²  ", "MAPE": "MAPE"}
    for key, val in report.items():
        suffix = "%" if key == "MAPE" else ""
        print(f"  {labels.get(key, key)}: {val:.4f}{suffix}")
