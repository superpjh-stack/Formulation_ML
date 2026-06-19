# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Formulation ML** — 성분분석 데이터 기반 배합비율 최적화 ML 시스템. 원재료 성분 편차를 반영한 최적 배합비율 자동 추천 및 품질 예측(회귀). Stack: Python 3.10+, scikit-learn, XGBoost, scipy.

## Common Commands

```bash
# 환경 설치
pip install -r requirements.txt

# 샘플 데이터 생성 (실데이터 없을 때)
python data/raw/generate_sample.py

# 모델 학습 (random_forest | gradient_boosting | xgboost | ridge)
python scripts/train.py --data formulation_history.csv --target quality_score --model gradient_boosting

# 배치 예측
python scripts/predict.py --data formulation_history.csv --target quality_score --model gradient_boosting --output predictions.csv

# 신규 LOT 배합비율 추천
python scripts/recommend.py --model gradient_boosting --temp 250 --time 45 --supplier SUP_A

# 테스트
python -m pytest tests/ -v
```

## Architecture

```
src/
  data/loader.py            load_raw() / load_processed() / save_processed()
  features/engineering.py   build_features(df, target, imputer, scaler, fit)
                            → (X, y, imputer, scaler)
                            파생 피처: sn/ag/cu_deviation (목표값 대비 편차)
                            save_preprocessors() / load_preprocessors()
  models/train.py           REGISTRY {ridge, random_forest, gradient_boosting, xgboost}
                            train() / cross_validate() / save_model() / load_model()
                            get_feature_importance()
  models/optimize.py        recommend_ratios() — scipy SLSQP 최적화
                            품질 예측 모델을 objective function으로 사용
  evaluation/metrics.py     regression_report() → {MAE, RMSE, R², MAPE}
scripts/
  train.py                  학습 CLI — 모델 + 전처리기 함께 저장
  predict.py                배치 추론 CLI — 저장된 전처리기 로드해서 사용
  recommend.py              단건 배합 추천 CLI
data/raw/                   원본 CSV (git-ignored)
data/processed/             추론 결과 CSV (git-ignored)
models/artifacts/           모델(.joblib) + 전처리기 저장 (git-ignored)
notebooks/01_eda.ipynb      EDA (분포, 상관관계, 이상치, 성분 편차 분석)
```

## Key Conventions

- `build_features(fit=True)` — 학습 시, `fit=False` + 저장된 imputer/scaler — 추론 시
- 모델과 전처리기는 항상 같은 이름으로 쌍으로 저장됨: `{name}.joblib` + `preprocessors_{name}.joblib`
- `recommend_ratios()` 는 `model.feature_names_in_` 유무에 따라 피처 정렬 방식이 분기됨
- 피처 목표값: `SN_TARGET=62.0`, `AG_TARGET=3.0`, `CU_TARGET=0.5` (engineering.py 상단)
- 성분 합계 제약: `sum(sn+ag+cu+pb) ≈ 100%` (optimize.py constraints)

## Performance Baseline (샘플 데이터 기준)

| 모델 | RMSE | R² | MAPE |
|------|------|-----|------|
| RandomForest | 3.21 | 0.588 | 3.03% |
| GradientBoosting | 3.05 | 0.627 | 2.78% |

> R²<0.85는 샘플 데이터의 노이즈(σ=3) 때문. 실데이터로 교체 시 재측정 필요.
