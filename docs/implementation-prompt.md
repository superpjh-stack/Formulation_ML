# 배합비율 최적화 ML — 구현 프롬프트 모음

Claude Code에서 `/goal` 명령어로 각 Phase를 순서대로 실행하세요.
각 Phase를 시작할 때 아래 해당 프롬프트를 `/goal` 에 붙여넣으면 됩니다.

---

## 전체 프로젝트 한 번에 실행 (권장)

```
/goal

## 목표
docs/기획서.md에 정의된 배합비율 최적화 ML 시스템을 5개 Phase로 완전히 구현한다.

## 완료 조건
- [ ] Phase 1: notebooks/01_eda.ipynb 에 EDA 완료 (분포, 상관관계, 이상치 분석 포함)
- [ ] Phase 2: Ridge/RandomForest 베이스라인 학습 완료, CV 결과 출력
- [ ] Phase 3: XGBoost 모델 학습 완료, R²≥0.85 또는 MAPE≤10% 달성
- [ ] Phase 4: scipy.optimize 기반 최적 배합비율 추천 함수 구현 및 테스트
- [ ] Phase 5: scripts/train.py + scripts/predict.py 전체 파이프라인 동작 확인

## 컨텍스트
- 프로젝트 루트: 현재 디렉토리
- 기획서: docs/기획서.md
- 기술 명세: docs/spec.md
- 현재 코드: src/ (data/loader.py, features/engineering.py, models/train.py, evaluation/metrics.py)
- 데이터: data/raw/ 에 CSV 파일이 있을 때 시작

## 실행 순서
Phase 1 → 2 → 3 → 4 → 5 순서로 진행.
각 Phase 완료 시 완료 조건 체크박스를 업데이트하고 다음 Phase로 넘어간다.
```

---

## Phase별 개별 프롬프트

### Phase 1 — 데이터 수집 및 EDA

```
/goal

## 목표
배합비율 최적화 ML의 Phase 1을 완료한다: 데이터 탐색 및 분석.

## 완료 조건
- notebooks/01_eda.ipynb 생성 및 다음 분석 포함:
  - 각 피처(Sn, Ag, Cu 성분값, 온도, 시간 등) 분포 시각화
  - 피처-타겟 상관관계 히트맵
  - 이상치 탐지 (IQR 또는 Z-score)
  - 결측치 현황 요약
  - 타겟 변수(quality_score 또는 is_defect) 분포 확인
- src/features/engineering.py 의 피처 목록을 실데이터 컬럼에 맞게 업데이트

## 컨텍스트
- 데이터 위치: data/raw/*.csv
- 피처 정의: docs/spec.md 섹션 2 참조
- 사용 라이브러리: pandas, numpy, matplotlib, seaborn

## 주의사항
- 데이터가 없을 경우 샘플 데이터(50행)를 직접 생성하여 파이프라인 검증
- 컬럼명은 실제 CSV 헤더에 맞게 조정
```

---

### Phase 2 — 피처 엔지니어링 및 베이스라인

```
/goal

## 목표
배합비율 최적화 ML의 Phase 2를 완료한다: 피처 엔지니어링 및 베이스라인 모델 학습.

## 완료 조건
- src/features/engineering.py 의 build_features() 가 실데이터 기준으로 동작
  - 파생 피처: sn_deviation, ag_deviation (목표값 대비 편차)
  - 범주형 인코딩: supplier_id → get_dummies
  - 스케일링 + 결측치 처리 정상 동작 확인
- scripts/train.py 실행 시 Ridge, RandomForest 두 모델 모두 CV 결과 출력
- 각 모델의 RMSE, R², MAPE 결과를 출력하고 비교

## 컨텍스트
- 기존 코드: src/features/engineering.py, src/models/train.py
- 평가 지표 정의: docs/spec.md 섹션 4
- 실행 명령:
  python scripts/train.py --data <파일명>.csv --target quality_score --model random_forest

## 주의사항
- scaler와 imputer를 모델과 함께 저장해야 predict 시 일관성 보장
  → joblib.dump({'model': model, 'scaler': scaler, 'imputer': imputer}, path) 형태로 변경
```

---

### Phase 3 — XGBoost 고도화

```
/goal

## 목표
배합비율 최적화 ML의 Phase 3을 완료한다: XGBoost 모델 고도화 및 성능 목표 달성.

## 완료 조건
- requirements.txt 에 xgboost>=1.7 추가
- src/models/train.py REGISTRY 에 xgboost 모델 추가
- 하이퍼파라미터 탐색 완료 (GridSearchCV 또는 Optuna)
- 테스트셋 기준 R²≥0.85 또는 MAPE≤10% 달성
  (데이터 부족 시 샘플 데이터로 파이프라인 정합성만 확인하고 목표치는 별도 명시)
- 피처 중요도 상위 10개를 출력하여 docs/spec.md 피처 정의에 반영

## 컨텍스트
- 기존 모델 구조: src/models/train.py REGISTRY
- 목표 지표: docs/spec.md 섹션 4 (R²≥0.85, MAPE≤10%)
- docs/spec.md 에 XGBoost 하이퍼파라미터 결과 업데이트

## 주의사항
- xgboost 설치 후 import 오류 없는지 먼저 확인
- 과적합 방지: early_stopping_rounds 적용
```

---

### Phase 4 — 배합비율 최적화 로직

```
/goal

## 목표
배합비율 최적화 ML의 Phase 4를 완료한다: 최적 배합비율 역추적 로직 구현.

## 완료 조건
- src/models/optimize.py 신규 생성:
  - recommend_ratios(lot_analysis: dict, model, process_conditions: dict) → dict
  - scipy.optimize.minimize (SLSQP) 사용
  - 제약조건: 성분 합계 = 100%, 각 성분 ≥ 0%
  - 도메인 제약(성분별 Min/Max)을 파라미터로 받을 수 있도록 설계
- scripts/recommend.py 신규 생성:
  - 새 LOT의 XRF 분석값 입력 → 최적 배합비율 추천 → CSV 출력
- 간단한 단위 테스트: tests/test_optimize.py

## 컨텍스트
- 최적화 로직 참조: docs/spec.md 섹션 5
- 기존 모델 로드: src/models/train.py load_model()
- 사용 라이브러리: scipy.optimize

## 주의사항
- initial_ratios (초기값) 를 현재 표준 배합비율로 설정하면 수렴 안정성 향상
- 최적화 실패(수렴 안됨) 시 fallback으로 표준 배합비율 반환
```

---

### Phase 5 — 전체 파이프라인 완성 및 운영 체계

```
/goal

## 목표
배합비율 최적화 ML의 Phase 5를 완료한다: 전체 파이프라인 검증 및 운영 체계 구축.

## 완료 조건
- scripts/train.py 처음부터 끝까지 오류 없이 실행 완료
- scripts/predict.py 처음부터 끝까지 오류 없이 실행 완료
- scripts/recommend.py 처음부터 끝까지 오류 없이 실행 완료
- README.md (또는 docs/usage.md) 에 실행 방법 정리
- CLAUDE.md 업데이트:
  - 실제 컬럼명과 타겟 변수 반영
  - XGBoost 모델 추가 반영
  - 운영 명령어 업데이트
- 모델 성능 모니터링 방안 docs/운영가이드.md 에 간략히 정리
  (재학습 주기, R² 임계값, 알림 방법)

## 컨텍스트
- 전체 프로젝트 구조: CLAUDE.md 참조
- Phase 1~4 결과물이 모두 완료된 상태에서 실행

## 주의사항
- scaler/imputer가 train과 predict에서 동일하게 적용되는지 확인
- 샘플 데이터로 end-to-end 테스트 1회 실행하고 결과 확인
```

---

## 사용 방법

1. Claude Code 세션에서 `/goal` 입력
2. 위 프롬프트 중 원하는 Phase 블록을 붙여넣기
3. Claude가 완료 조건을 모두 충족할 때까지 자동으로 작업
4. 완료 후 다음 Phase 프롬프트로 이동

> **팁**: 데이터가 준비되지 않은 경우 Phase 1 프롬프트를 먼저 실행하면
> 샘플 데이터를 자동 생성하여 전체 파이프라인 구조를 먼저 검증할 수 있습니다.
