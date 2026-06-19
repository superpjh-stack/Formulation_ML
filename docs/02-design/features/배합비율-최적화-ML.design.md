# Design: 배합비율-최적화-ML

> 이 문서는 docs/spec.md, docs/기획서.md, docs/problem.md를 PDCA 설계 기준으로 통합한 문서입니다.

## 요구사항 (docs/기획서.md 기반)

### 기능 요구사항

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-01 | 성분분석 CSV 로드 및 전처리 | 필수 |
| FR-02 | 파생 피처 생성: sn/ag/cu_deviation (목표값 대비 편차) | 필수 |
| FR-03 | train/predict 간 imputer + scaler 일관 적용 (저장/로드) | 필수 |
| FR-04 | Ridge / RandomForest / GradientBoosting / XGBoost 학습 | 필수 |
| FR-05 | 5-Fold 교차검증 → RMSE, R², MAPE 출력 | 필수 |
| FR-06 | 테스트셋 성능 평가 (MAE, RMSE, R², MAPE) | 필수 |
| FR-07 | 피처 중요도 TOP 10 출력 | 권장 |
| FR-08 | scipy SLSQP 기반 최적 배합비율 역추적 | 필수 |
| FR-09 | 주요 성분 합계 95~100% 부등식 밴드 제약 + pb_pct 잔량 보정으로 출력 합계 100% 보장 | 필수 |
| FR-10 | 최적화 실패 시 표준 배합비율 fallback 반환 | 필수 |
| FR-11 | 신규 LOT 단건 추천 CLI (recommend.py) | 필수 |
| FR-12 | 배치 예측 CLI (predict.py) | 필수 |
| FR-13 | 단위 테스트 (test_optimize.py) | 필수 |

### 성능 요구사항

| 지표 | 목표 |
|------|------|
| MAPE | ≤ 10% |
| R² | ≥ 0.85 (실데이터 기준) |
| 추천 응답시간 | < 30초 |

## 아키텍처 설계 (docs/spec.md 기반)

### 모듈 구조

```
src/
  data/loader.py          load_raw(), load_processed(), save_processed()
  features/engineering.py build_features(df, target, imputer, scaler, fit)
                          save_preprocessors(), load_preprocessors()
  models/train.py         REGISTRY, train(), cross_validate(),
                          save_model(), load_model(), get_feature_importance()
  models/optimize.py      recommend_ratios(process_conditions, model, imputer, scaler)
  evaluation/metrics.py   regression_report() → {MAE, RMSE, R², MAPE}
scripts/
  train.py                학습 CLI
  predict.py              배치 추론 CLI
  recommend.py            단건 추천 CLI
tests/
  test_optimize.py        최적화 단위 테스트 3개
```

### 데이터 흐름

```
data/raw/*.csv
  → build_features(fit=True) → imputer + scaler 저장
  → train() → 모델 저장
  → cross_validate() → 성능 출력
  → regression_report() → 최종 평가

data/raw/*.csv (신규 LOT)
  → load_preprocessors()
  → build_features(fit=False)
  → model.predict() 또는 recommend_ratios()
  → 추천 결과 출력
```

### 피처 정의

| 피처 | 타입 | 설명 |
|------|------|------|
| sn_pct, ag_pct, cu_pct, pb_pct, other_pct | float | XRF 성분값 |
| melt_temp_c, melt_time_min | float | 공정 조건 |
| sn_deviation, ag_deviation, cu_deviation | float | 파생: 목표값 대비 편차 |
| supplier_id_SUP_B, supplier_id_SUP_C | int | 공급사 one-hot |

### 타겟 변수

- `quality_score` (float, 0~100) — 회귀 1차 모델
- `is_defect` (int, 0/1) — 후처리 분류

## 완료 기준

- [ ] FR-01~FR-13 모두 구현 완료
- [ ] 3개 단위 테스트 통과
- [ ] scripts/ 3개 CLI end-to-end 동작 확인
- [ ] MAPE ≤ 10% 달성 (샘플 또는 실데이터)
