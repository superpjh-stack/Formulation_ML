# Design: notebooks-eda

> 작성일: 2026-06-17 | Plan 문서: `docs/01-plan/features/notebooks-eda.plan.md`

## 1. 노트북 셀 구조

총 **10개 섹션**, 각 섹션은 마크다운 헤더 셀 + 코드 셀로 구성.

```
[0] 환경 설정 & 데이터 로드
[1] 기본 정보 (shape, dtypes, describe)
[2] 결측치 분석
[3] 이상치 탐지 (IQR / boxplot)
[4] 타겟 변수 분포 (quality_score)
[5] 피처 상관관계 히트맵
[6] 성분 편차 분포 (sn/ag/cu_deviation)
[7] 공급사별 품질 비교
[8] 피처 중요도 (저장된 모델 활용)
[9] 분석 요약
```

---

## 2. 셀별 상세 설계

### [0] 환경 설정 & 데이터 로드

**목적**: 의존성 임포트 + `loader.py`로 원본 데이터 로드

```python
import sys
sys.path.insert(0, '..')

import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path

from src.data.loader import load_raw

plt.rcParams['figure.figsize'] = (10, 5)
plt.rcParams['font.family'] = 'DejaVu Sans'
sns.set_theme(style='whitegrid')

DATA_PATH = Path('../data/raw/formulation_history.csv')
df = load_raw(DATA_PATH)
print(f"데이터 로드 완료: {df.shape}")
```

---

### [1] 기본 정보

**목적**: 전체 구조 파악

```python
print("=== Shape ===")
print(df.shape)

print("\n=== 컬럼 & 타입 ===")
print(df.dtypes)

print("\n=== 기술통계 ===")
df.describe().T
```

---

### [2] 결측치 분석

**목적**: 결측치 개수 및 비율 확인

```python
missing = df.isnull().sum()
missing_pct = (missing / len(df) * 100).round(2)
pd.DataFrame({'count': missing, 'pct(%)': missing_pct}).query('count > 0')
```

결측치 없으면: `"결측치 없음 ✓"` 출력

---

### [3] 이상치 탐지

**목적**: 수치형 피처 IQR 기반 이상치 비율 계산 + boxplot

```python
numeric_cols = ['sn_pct', 'ag_pct', 'cu_pct', 'pb_pct',
                'melt_temp_c', 'melt_time_min', 'quality_score']

# IQR 이상치 비율
outlier_summary = {}
for col in numeric_cols:
    Q1, Q3 = df[col].quantile(0.25), df[col].quantile(0.75)
    IQR = Q3 - Q1
    n_out = ((df[col] < Q1 - 1.5*IQR) | (df[col] > Q3 + 1.5*IQR)).sum()
    outlier_summary[col] = {'count': n_out, 'pct(%)': round(n_out/len(df)*100, 2)}

pd.DataFrame(outlier_summary).T
```

```python
# Boxplot
fig, axes = plt.subplots(2, 4, figsize=(16, 8))
for ax, col in zip(axes.flatten(), numeric_cols):
    df.boxplot(column=col, ax=ax)
    ax.set_title(col)
plt.tight_layout()
plt.suptitle('수치형 피처 이상치 분포', y=1.02, fontsize=14)
plt.show()
```

---

### [4] 타겟 변수 분포

**목적**: `quality_score` 분포 확인 (정규성 여부)

```python
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 4))

# Histogram + KDE
df['quality_score'].plot.hist(bins=30, ax=ax1, alpha=0.7, color='steelblue')
ax1.set_title('quality_score 분포 (Histogram)')
ax1.set_xlabel('quality_score')

df['quality_score'].plot.kde(ax=ax2, color='darkorange')
ax2.set_title('quality_score 분포 (KDE)')
ax2.set_xlabel('quality_score')

plt.tight_layout()
plt.show()

print(f"평균: {df['quality_score'].mean():.2f}")
print(f"표준편차: {df['quality_score'].std():.2f}")
print(f"왜도(skewness): {df['quality_score'].skew():.3f}")
```

---

### [5] 피처 상관관계

**목적**: 수치형 피처 간 선형 상관관계 파악

```python
corr = df[numeric_cols].corr()

plt.figure(figsize=(10, 8))
sns.heatmap(corr, annot=True, fmt='.2f', cmap='RdBu_r',
            center=0, square=True, linewidths=0.5)
plt.title('피처 상관관계 히트맵')
plt.tight_layout()
plt.show()
```

---

### [6] 성분 편차 분포

**목적**: `sn/ag/cu_deviation` 파생 피처 분포 확인

```python
from src.features.engineering import build_features

# fit=True로 파생 피처 생성
X, y, imputer, scaler = build_features(df, target='quality_score', fit=True)

deviation_cols = [c for c in X.columns if 'deviation' in c]

fig, axes = plt.subplots(1, len(deviation_cols), figsize=(14, 4))
for ax, col in zip(axes, deviation_cols):
    pd.Series(X[col]).plot.hist(bins=30, ax=ax, alpha=0.7)
    ax.axvline(0, color='red', linestyle='--', label='목표값')
    ax.set_title(col)
    ax.legend()

plt.suptitle('성분 편차 분포 (목표값 대비)', fontsize=13)
plt.tight_layout()
plt.show()

print("편차 기술통계:")
pd.DataFrame(X[deviation_cols]).describe().T
```

---

### [7] 공급사별 품질 비교

**목적**: `supplier_id` 카테고리별 `quality_score` 차이 확인

```python
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(12, 5))

# Boxplot
df.boxplot(column='quality_score', by='supplier_id', ax=ax1)
ax1.set_title('공급사별 quality_score 분포')
ax1.set_xlabel('supplier_id')

# 평균 bar
df.groupby('supplier_id')['quality_score'].mean().sort_values().plot.bar(ax=ax2, color='steelblue')
ax2.set_title('공급사별 평균 품질 점수')
ax2.set_xlabel('supplier_id')
ax2.set_ylabel('mean quality_score')

plt.tight_layout()
plt.show()

print("공급사별 통계:")
df.groupby('supplier_id')['quality_score'].agg(['mean', 'std', 'count'])
```

---

### [8] 피처 중요도

**목적**: 저장된 모델에서 피처 중요도 TOP 10 시각화

```python
import joblib
from pathlib import Path

MODEL_PATH = Path('../models/artifacts/gradient_boosting.joblib')

if MODEL_PATH.exists():
    model = joblib.load(MODEL_PATH)
    from src.models.train import get_feature_importance
    fi = get_feature_importance(model, X.columns.tolist())

    top10 = fi.head(10)
    top10.plot.barh(x='feature', y='importance', figsize=(10, 6),
                    legend=False, color='coral')
    plt.gca().invert_yaxis()
    plt.title('피처 중요도 TOP 10 (GradientBoosting)')
    plt.xlabel('importance')
    plt.tight_layout()
    plt.show()
else:
    print("모델 파일 없음 — 먼저 train.py를 실행하세요.")
    print("python scripts/train.py --data formulation_history.csv "
          "--target quality_score --model gradient_boosting")
```

---

### [9] 분석 요약

**목적**: 주요 발견사항 정리 (마크다운 셀)

```markdown
## 분석 요약

| 항목 | 결과 |
|------|------|
| 데이터 크기 | {shape} |
| 결측치 | 없음 / {N}개 |
| 이상치 비율 | quality_score 기준 {N}% |
| quality_score 평균 | {mean:.1f} (std={std:.1f}) |
| 왜도 | {skew:.3f} (정규분포 근사 / 편향) |
| 최다 이상치 피처 | {col} ({pct}%) |
| 공급사 품질 격차 | 최대 {diff:.1f}점 차이 |
| quality_score 최고 상관 피처 | {feature} (r={r:.2f}) |

### 주요 시사점
1. ...
2. ...
3. ...
```

---

## 3. 시각화 목록

| # | 시각화 | 라이브러리 | 셀 |
|---|--------|-----------|-----|
| 1 | 수치형 피처 Boxplot (2×4) | matplotlib | [3] |
| 2 | quality_score Histogram + KDE | matplotlib | [4] |
| 3 | 상관관계 Heatmap | seaborn | [5] |
| 4 | 성분 편차 Histogram (1×3) | matplotlib | [6] |
| 5 | 공급사별 Boxplot + Bar | matplotlib | [7] |
| 6 | 피처 중요도 Horizontal Bar | matplotlib | [8] |

---

## 4. 의존성

```
기존 requirements.txt 범위 내 — 추가 패키지 불필요
- pandas, numpy (기존)
- matplotlib, seaborn (기존)
- joblib (기존)
- src/ 모듈: loader, features/engineering, models/train
```

---

## 5. 실행 방법

```bash
# 1. 샘플 데이터 생성
python data/raw/generate_sample.py

# 2. (선택) 모델 학습 — 피처 중요도 셀 활용 시
python scripts/train.py --data formulation_history.csv --target quality_score --model gradient_boosting

# 3. 노트북 실행
jupyter notebook notebooks/01_eda.ipynb
# 또는
jupyter lab
```

---

## 6. 구현 순서 (Do Phase 참고)

1. 노트북 파일 생성 (`notebooks/01_eda.ipynb`)
2. `[0]` 환경 설정 & 데이터 로드 셀 작성 및 실행 확인
3. `[1]~[3]` 기본 정보 / 결측치 / 이상치 셀 순차 작성
4. `[4]~[5]` 타겟 분포 / 상관관계 시각화
5. `[6]` `build_features()` 호출하여 파생 피처 분포
6. `[7]` 공급사별 분석
7. `[8]` 피처 중요도 (모델 파일 존재 조건부)
8. `[9]` 요약 마크다운 작성 (수동 채우기)
9. 전체 셀 재실행(`Kernel > Restart & Run All`) 확인
