# Plan: notebooks-eda

> 작성일: 2026-06-17 | 담당: Formulation ML

## 1. 목표

`notebooks/01_eda.ipynb` 를 작성하여 배합비율 최적화 ML 시스템의 데이터를 탐색적으로 분석한다.
샘플 데이터 기준으로 작성하되, 실데이터 투입 시 즉시 재실행 가능한 구조로 설계한다.

## 2. 배경 & 문제

- 모델 학습(Do 단계)은 완료됐으나 **데이터 특성에 대한 이해 문서가 없음**
- R² = 0.627 (샘플 노이즈 σ=3 영향) → 실데이터 투입 전 분포·이상치 파악 필요
- 성분 편차(`sn/ag/cu_deviation`) 파생 피처의 분포 확인이 미실시
- 공급사(`supplier_id`) 별 품질 편차 시각화 부재

## 3. 범위 (Scope)

### In-scope

| # | 분석 항목 |
|---|-----------|
| 1 | 데이터 로드 및 기본 통계 (shape, dtypes, describe) |
| 2 | 결측치 & 이상치 탐색 (boxplot, IQR) |
| 3 | 타겟 변수(`quality_score`) 분포 (histogram, KDE) |
| 4 | 수치형 피처 상관관계 분석 (heatmap) |
| 5 | 성분 편차(`sn/ag/cu_deviation`) 분포 시각화 |
| 6 | 공급사별(`supplier_id`) 품질 분포 비교 (boxplot) |
| 7 | 피처 중요도 TOP 10 시각화 (저장된 모델 활용) |
| 8 | 성분 합계 검증 (sn+ag+cu+pb ≈ 100%) |

### Out-of-scope

- 모델 재학습 및 하이퍼파라미터 탐색
- 실데이터 기반 분석 (별도 노트북으로 분리)
- Streamlit 대시보드 (다음 feature)

## 4. 요구사항

| ID | 요구사항 | 우선순위 |
|----|----------|----------|
| FR-EDA-01 | `src/data/loader.py` 활용하여 데이터 로드 | 필수 |
| FR-EDA-02 | 각 셀에 한국어 마크다운 설명 포함 | 필수 |
| FR-EDA-03 | matplotlib/seaborn 시각화 (inline) | 필수 |
| FR-EDA-04 | 이상치 탐지 결과를 텍스트로 요약 | 필수 |
| FR-EDA-05 | 저장된 모델(`gradient_boosting.joblib`)로 피처 중요도 출력 | 권장 |
| FR-EDA-06 | 분석 결과 요약 셀 (마지막 셀) | 권장 |

## 5. 산출물

```
notebooks/
  01_eda.ipynb        ← 신규 작성
```

## 6. 선행 조건

- `data/raw/generate_sample.py` 실행 → `formulation_history.csv` 존재
- `models/artifacts/gradient_boosting.joblib` 존재 (피처 중요도용, 없으면 skip)

## 7. 일정

| 단계 | 작업 |
|------|------|
| Design | 노트북 셀 구조 설계 |
| Do | 셀 구현 (데이터 로드 → 시각화 → 요약) |
| Check | 샘플 데이터로 end-to-end 실행 확인 |
