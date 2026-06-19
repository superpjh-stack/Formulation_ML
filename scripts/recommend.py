"""신규 LOT 배합비율 추천 스크립트.

Usage:
    python scripts/recommend.py --model random_forest --temp 250 --time 45 --supplier SUP_A
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.models.train import load_model
from src.features.engineering import load_preprocessors
from src.models.optimize import recommend_ratios


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="random_forest")
    parser.add_argument("--temp", type=float, default=250.0, help="용해 온도 (°C)")
    parser.add_argument("--time", type=float, default=45.0, help="가열 시간 (분)")
    parser.add_argument("--supplier", default="SUP_A",
                        choices=["SUP_A", "SUP_B", "SUP_C"])
    args = parser.parse_args()

    model = load_model(args.model)
    imputer, scaler = load_preprocessors(name=args.model)

    # 공정 조건 구성 (supplier one-hot 인코딩)
    process_conditions = {
        "melt_temp_c": args.temp,
        "melt_time_min": args.time,
        "supplier_id_SUP_B": 1 if args.supplier == "SUP_B" else 0,
        "supplier_id_SUP_C": 1 if args.supplier == "SUP_C" else 0,
    }

    print(f"\n공정 조건: 온도={args.temp}°C, 시간={args.time}분, 공급사={args.supplier}")
    print(f"사용 모델: {args.model}\n")

    result = recommend_ratios(
        process_conditions=process_conditions,
        model=model,
        imputer=imputer,
        scaler=scaler,
    )

    print("=" * 45)
    print("최적 배합비율 추천 결과")
    print("=" * 45)
    for k, v in result.items():
        if k not in ("success", "message"):
            unit = "%" if k.endswith("_pct") else ("점" if k == "predicted_quality" else "")
            print(f"  {k:25s}: {v}{unit}")
    print(f"\n상태: {result['message']}")


if __name__ == "__main__":
    main()
