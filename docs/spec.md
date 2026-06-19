# 기술 명세서 (Technical Specification)

## 1. 시스템 구성

```
┌─────────────────────────────────────────────────────────┐
│                   데이터 파이프라인                        │
│  [성분분석 CSV] → [data/raw/] → [전처리] → [data/processed/] │
└──────────────────────────┬──────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                   ML 파이프라인                           │
│  피처 엔지니어링 → 모델 학습 → 성능 검증 → 모델 저장       │
│  (src/features)   (src/models)  (src/evaluation)        │
└──────────────────────────┬──────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────┐
│                   추론 파이프라인                          │
│  신규 LOT 성분값 입력 → 품질 예측 → 배합비율 추천          │
│  (scripts/predict.py)                                   │
└─────────────────────────────────────────────────────────┘
```

## 2. 피처 정의

### 입력 피처 (Feature)

| 피처명 | 타입 | 설명 | 비고 |
|--------|------|------|------|
| `sn_pct` | float | 주석(Sn) 함량 (%) | XRF 측정값 |
| `ag_pct` | float | 은(Ag) 함량 (%) | XRF 측정값 |
| `cu_pct` | float | 구리(Cu) 함량 (%) | XRF 측정값 |
| `pb_pct` | float | 납(Pb) 함량 (%) | RoHS 관련 |
| `other_pct` | float | 기타 성분 합계 (%) | |
| `melt_temp_c` | float | 용해 온도 (°C) | PLC 센서 |
| `melt_time_min` | float | 가열 시간 (분) | PLC 센서 |
| `sn_deviation` | float | Sn 목표값 대비 편차 | 파생 피처 |
| `ag_deviation` | float | Ag 목표값 대비 편차 | 파생 피처 |
| `supplier_id` | category | 원재료 공급사 코드 | 인코딩 필요 |
| `lot_seq` | int | 당일 LOT 순번 | 장비 열화 proxy |

### 타겟 변수 (Target)

| 변수명 | 타입 | 설명 |
|--------|------|------|
| `quality_score` | float | 품질 점수 (0~100) — 회귀 |
| `is_defect` | int | 불량 여부 (0/1) — 분류 |

> 두 타겟 중 **`quality_score` 회귀**를 1차 모델로 진행, 임계값 기반 불량 판단은 후처리로 구현.

---

## 3. 모델 아키텍처

### 모델 선택 근거 (사업계획서 명시)

> *"XGBoost/Random Forest 기반 배합비율-품질(불량률) 예측 및 최적 배합 추천 알고리즘 개발"*

| 모델 | 용도 | 장점 |
|------|------|------|
| `RandomForestRegressor` | 기본 모델 (베이스라인) | 피처 중요도 해석, 이상치에 강건 |
| `GradientBoostingRegressor` | 성능 향상 모델 | 낮은 RMSE, 배치 학습 적합 |
| `Ridge` | 선형 베이스라인 | 빠른 수렴, 해석 가능성 |
| XGBoost (`xgboost`) | 목표 모델 | 사업계획서 명시, 성능·속도 균형 |

> XGBoost는 현재 `requirements.txt`에 미포함 — 필요 시 `xgboost>=1.7` 추가.

### 하이퍼파라미터 탐색 (향후)

```python
from sklearn.model_selection import GridSearchCV

param_grid = {
    "n_estimators": [100, 200, 500],
    "max_depth": [3, 5, 7],
    "learning_rate": [0.01, 0.05, 0.1],   # GBM/XGBoost
}
```

---

## 4. 평가 지표

사업계획서 명시 지표: **RMSE, R², MAPE**

| 지표 | 수식 | 의미 |
|------|------|------|
| RMSE | √(Σ(ŷ-y)²/n) | 품질 예측 오차의 절대 크기 |
| R² | 1 - SS_res/SS_tot | 모델 설명력 (1에 가까울수록 좋음) |
| MAPE | mean(|ŷ-y|/y)×100 | 상대 오차율 (%) |
| MAE | mean(|ŷ-y|) | 이상치에 덜 민감한 오차 지표 |

> 목표 기준: **R² ≥ 0.85**, **MAPE ≤ 10%** (추후 실데이터 기반 조정)

---

## 5. 배합비율 최적화 로직

품질 예측 모델을 objective function으로 사용하는 수치 최적화:

```python
from scipy.optimize import minimize

def objective(ratios, model, process_conditions):
    # ratios: [sn_pct, ag_pct, cu_pct, ...]
    features = build_feature_vector(ratios, process_conditions)
    predicted_quality = model.predict([features])[0]
    return -predicted_quality  # 최대화 → 부호 반전

constraints = [
    {"type": "eq", "fun": lambda r: sum(r) - 100},   # 합계 = 100%
    {"type": "ineq", "fun": lambda r: r},             # 모든 성분 ≥ 0
]

result = minimize(objective, x0=initial_ratios,
                  args=(model, process_conditions),
                  constraints=constraints, method="SLSQP")
```

---

## 6. 파이프라인 실행 명령어

```bash
# 환경 설정
pip install -r requirements.txt

# 모델 학습
python scripts/train.py \
  --data formulation_history.csv \
  --target quality_score \
  --model gradient_boosting

# 신규 LOT 배합비율 추천
python scripts/predict.py \
  --data new_lot_analysis.csv \
  --target quality_score \
  --model gradient_boosting \
  --output recommendations.csv
```

---

## 7. 온라인 러닝 고려사항

사업계획서에 **"Online Learning 적용"** 명시. 현재 구현은 배치 학습(오프라인)이며,
향후 다음 방향으로 확장 가능:

- `warm_start=True` (sklearn) 또는 XGBoost `xgb_model` 파라미터로 증분 학습
- 신규 LOT 검사 완료 시 → 자동 재학습 트리거
- 모델 성능 모니터링: 주간 단위 R² 추적, 임계 하회 시 full retraining
