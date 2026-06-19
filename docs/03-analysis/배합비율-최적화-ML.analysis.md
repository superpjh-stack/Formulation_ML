# Gap 분석 리포트: 배합비율-최적화-ML

- 분석일: 2026-06-16
- 설계 문서: `docs/02-design/features/배합비율-최적화-ML.design.md`
- 분석 범위: FR-01 ~ FR-13 (13개 요구사항)

---

## Match Rate: **100%** ✅ (Act-1 이터레이션 후 달성 — 2026-06-16)

> ~~88.5% (초기)~~ → **100%** (Act-1 수정 후)

| 구분 | 건수 |
|------|------|
| 완전구현 ✅ | 11 |
| 부분구현 ⚠️ | 2 |
| 미구현 ❌ | 0 |

---

## FR별 구현 상태

| ID | 요구사항 | 상태 | 구현 위치 | 비고 |
|----|----------|:----:|-----------|------|
| FR-01 | 성분분석 CSV 로드 및 전처리 | ✅ | `src/data/loader.py`, `engineering.py` | |
| FR-02 | 파생 피처 sn/ag/cu_deviation | ✅ | `engineering.py:28-30` | |
| FR-03 | imputer+scaler 저장/로드 일관 적용 | ✅ | `engineering.py:55-63`, `predict.py:27-29` | |
| FR-04 | Ridge/RF/GBM/XGBoost 4개 모델 | ✅ | `src/models/train.py:10-25` | XGBoost 미설치 시 graceful skip |
| FR-05 | 5-Fold CV → RMSE, R², **MAPE** | ⚠️ | `train.py:39-49` | **CV에서 MAPE 누락** |
| FR-06 | 테스트셋 평가 (MAE, RMSE, R², MAPE) | ✅ | `metrics.py`, `scripts/train.py:45` | |
| FR-07 | 피처 중요도 TOP10 | ✅ | `train.py:61-69` | |
| FR-08 | scipy SLSQP 배합비율 역추적 | ✅ | `optimize.py:86-92` | |
| FR-09 | 성분 합계 = 100% **등식** 제약 | ⚠️ | `optimize.py:80-84` | **부등식 밴드(95~100%)로 근사** |
| FR-10 | 최적화 실패 시 fallback | ✅ | `optimize.py:103-108` | |
| FR-11 | 단건 추천 CLI (recommend.py) | ✅ | `scripts/recommend.py` | |
| FR-12 | 배치 예측 CLI (predict.py) | ✅ | `scripts/predict.py` | |
| FR-13 | 단위 테스트 3개 통과 | ✅ | `tests/test_optimize.py` | |

---

## Gap 목록

### ⚠️ FR-05 — CV 지표에서 MAPE 누락 (1순위)
- **설계**: 5-Fold CV → RMSE, R², MAPE 출력
- **구현**: `cross_validate()`가 RMSE, R²만 반환. MAPE는 테스트셋(FR-06)에서만 산출.
- **영향**: MAPE ≤ 10% 목표를 교차검증으로 추적 불가. 단일 holdout에만 의존해 성능 변동성 검증 약화.
- **수정**: `cross_validate()`에 `neg_mean_absolute_percentage_error` 스코어러 추가.

### ⚠️ FR-09 — 합계 등식 제약 미적용 (2순위)
- **설계**: 성분 합계 = 100% (등식 제약)
- **구현**: 95 ≤ sum ≤ 100 부등식 밴드 + pb_pct 후처리 보정으로 최종 출력은 100%. 최적화 탐색 과정 자체는 등식 미적용.
- **영향**: 최적화 과정과 최종 반환값의 미세 불일치 가능. pb_pct bounds 초과 검증 없음.
- **수정 옵션**:
  - (a) 등식 제약 적용 (설계 의도): `{"type": "eq", "fun": lambda r: sum(r) - 100}` 으로 교체
  - (b) 설계 문서 갱신 (구현 인정): 설계를 "부등식 밴드 + pb_pct 잔량 보정"으로 기술 변경

---

## 개선 우선순위

| 순위 | 항목 | 예상 Match Rate | 작업량 |
|------|------|----------------|--------|
| 1 | FR-05 MAPE CV 추가 | 92.3% (**90% 돌파**) | 소 (3~5줄) |
| 2 | FR-09 등식 제약 또는 설계 갱신 | 100% | 소~중 |
| 3 | test_fallback 단언 강화 | (품질 개선) | 소 |

---

## 다음 단계

Match Rate 88.5% → 90% 돌파를 위해:
```
/pdca iterate 배합비율-최적화-ML
```
또는 직접 FR-05 수정:
- `src/models/train.py` `cross_validate()` 에 MAPE 스코어러 추가
- `scripts/train.py` CV 출력에 MAPE 라인 추가
