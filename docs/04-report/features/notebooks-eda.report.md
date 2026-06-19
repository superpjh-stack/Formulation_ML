# PDCA 완료 보고서: notebooks-eda

> 작성일: 2026-06-17 | Match Rate: **100%** | 반복: 0회

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| Feature | notebooks-eda |
| 목표 | `notebooks/01_eda.ipynb` EDA 노트북 작성 |
| PDCA 사이클 | Plan → Design → Do → Check (100%) → Report |
| 반복 횟수 | 0회 (1회차 구현에서 100% 달성) |
| 산출물 | `notebooks/01_eda.ipynb` |

---

## 2. PDCA 단계별 요약

### Plan
- 분석 목표 8개 항목 정의 (기본 통계 / 결측치 / 이상치 / 타겟 분포 / 상관관계 / 성분 편차 / 공급사별 / 피처 중요도)
- 기존 `src/` 모듈(`loader`, `engineering`, `train`) 활용 방침 결정
- 추가 패키지 불필요(기존 requirements.txt 범위 내) 확인

### Design
- 10개 섹션 셀 구조 설계 ([0]~[9])
- 섹션별 코드 스켈레톤 + 시각화 타입 명세
- `build_features()` 호출 방식, 모델 조건부 로드 패턴 설계

### Do
- 기존 노트북(스텁 상태) 대비 4개 항목 개선:
  1. `pd.read_csv` → `loader.load_raw()` 교체
  2. 섹션 [4] 타겟 변수 KDE + 왜도 신규 추가
  3. 섹션 [6] `build_features()` 연동 + scatter 추세선
  4. 섹션 [8] 피처 중요도 (조건부 실행) 신규 추가
  5. 섹션 [9] 수치 자동계산 요약 + 시사점 3줄

### Check (Gap Analysis)
| ID | 항목 | 결과 |
|----|------|------|
| C-01 | 환경 설정 (`loader.py`) | PASS |
| C-02 | 기본 정보 | PASS |
| C-03 | 결측치 분석 | PASS |
| C-04 | 이상치 탐지 (IQR + boxplot) | PASS |
| C-05 | 타겟 변수 분포 (hist+KDE+왜도) | PASS |
| C-06 | 상관관계 히트맵 | PASS |
| C-07 | 성분 편차 (`build_features()` + scatter) | PASS |
| C-08 | 공급사별 품질 분포 | PASS |
| C-09 | 피처 중요도 (조건부 로드) | PASS |
| C-10 | 분석 요약 (자동계산) | PASS |

**Match Rate: 10/10 = 100%**

---

## 3. 최종 산출물

```
notebooks/
  01_eda.ipynb    ✅ 24개 셀 (markdown 8 + code 16)
```

### 시각화 목록 (6종)

| # | 시각화 | 타입 |
|---|--------|------|
| 1 | 수치형 피처 Boxplot (2×4) | matplotlib |
| 2 | quality_score Histogram + KDE | matplotlib |
| 3 | 피처 상관관계 Heatmap | seaborn |
| 4 | 성분 편차 Histogram (1×3) | matplotlib |
| 5 | 성분 편차 vs 품질점수 Scatter + 추세선 (1×3) | matplotlib |
| 6 | 공급사별 Boxplot + Bar (1×2) | matplotlib |
| 7 | 피처 중요도 Horizontal Bar TOP 10 | matplotlib |

---

## 4. 기술적 결정 사항

| 결정 | 이유 |
|------|------|
| `loader.load_raw()` 사용 | `DATA_DIR` 절대경로 보장, 노트북 위치 무관 |
| `build_features(fit=True)` 호출 | 파생 피처 생성 로직 중복 방지 |
| 피처 중요도 조건부 실행 | 모델 미존재 시에도 노트북 전체 실행 가능 |
| 섹션 [9] 수치 자동계산 | 실데이터 재실행 시 값 자동 갱신 |

---

## 5. 실행 방법

```bash
# 1. 샘플 데이터 생성 (최초 1회)
python data/raw/generate_sample.py

# 2. 모델 학습 (피처 중요도 섹션 활용 시)
python scripts/train.py --data formulation_history.csv \
                        --target quality_score \
                        --model gradient_boosting

# 3. 노트북 실행
jupyter notebook notebooks/01_eda.ipynb
# Kernel > Restart & Run All
```

---

## 6. 다음 후보 작업

| 우선순위 | 항목 |
|---------|------|
| 높음 | 실데이터 투입 & 재학습 (R² ≥ 0.85 목표) |
| 중간 | Streamlit 모니터링 대시보드 |
| 낮음 | 추가 단위 테스트 (loader, engineering, metrics) |

> 실데이터 투입 시: `notebooks/01_eda.ipynb` Restart & Run All 로 분석 결과 자동 갱신
