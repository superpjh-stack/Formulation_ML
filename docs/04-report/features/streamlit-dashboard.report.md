# PDCA 완료 보고서: streamlit-dashboard

> 작성일: 2026-06-17 | Match Rate: **100%** | 반복: 0회

---

## 1. 개요

| 항목 | 내용 |
|------|------|
| Feature | streamlit-dashboard |
| 목표 | `streamlit_app.py` — 5페이지 배합비율 최적화 ML 웹 UI |
| PDCA 사이클 | Plan → Design → Do → Check (100%) → Report |
| 반복 횟수 | 0회 (1회차 구현에서 100% 달성) |
| 산출물 | `streamlit_app.py`, `requirements.txt` 업데이트 |

---

## 2. PDCA 단계별 요약

### Plan
- 5개 페이지 기능 정의 (홈 / 배합 추천 / 배치 예측 / 데이터 탐색 / 모델 정보)
- 필수 요구사항 10개 정의 (`FR-ST-01` ~ `FR-ST-10`)
- Streamlit 선택 이유: ML 결과 시각화 특화, 설치 단순

### Design
- 앱 구조 설계 (함수 단위: `_load_artifacts`, `_load_data`, `page_*`)
- `@st.cache_resource` / `@st.cache_data` 캐싱 전략 결정
- 공급사 one-hot 인코딩 자동화 (`_get_suppliers()` + drop_first 패턴)
- 모델/데이터 없을 때 fallback 컴포넌트 (`_warn_no_model()`) 설계

### Do
- 기존 `app.py` (FastAPI 서버) 충돌로 `streamlit_app.py`로 분리
- `src/` 모듈 전면 재사용 (`loader`, `engineering`, `optimize`, `train`)
- `requirements.txt`에 `streamlit>=1.32` 추가
- syntax OK + 핵심 imports OK 검증 완료

### Check (Gap Analysis)

| ID | 항목 | 결과 |
|----|------|------|
| C-01 | `_load_artifacts()` + `@st.cache_resource` | PASS |
| C-02 | `_load_data()` + `@st.cache_data` | PASS |
| C-03 | 사이드바 5페이지 네비게이션 | PASS |
| C-04 | 홈 — 4개 metric 카드 | PASS |
| C-05 | 배합 추천 — slider + selectbox + bar chart + metric | PASS |
| C-06 | 배치 예측 — CSV 업로드 + `build_features(fit=False)` + 다운로드 | PASS |
| C-07 | 데이터 탐색 — 탭 3개 (분포/상관관계/공급사별) | PASS |
| C-08 | 모델 정보 — 사양 테이블 + 피처 중요도 | PASS |
| C-09 | 모델/데이터 없을 때 fallback 안내 | PASS |
| C-10 | `streamlit>=1.32` requirements.txt 추가 | PASS |
| C-11 | 파일명 변경 (`app.py` → `streamlit_app.py`) | PASS (의도적 결정) |

**Match Rate: 11/11 = 100%**

---

## 3. 최종 산출물

```
streamlit_app.py         ✅ 5페이지 Streamlit 앱 (신규, ~270줄)
requirements.txt         ✅ streamlit>=1.32 추가
```

### 페이지별 구현 요약

| 페이지 | 핵심 컴포넌트 | 연결 모듈 |
|--------|--------------|-----------|
| 홈 | 4× `st.metric`, 기능 안내 테이블 | `loader`, `_load_artifacts` |
| 배합 추천 | 2× `st.slider` + `st.selectbox` → bar chart + metric | `optimize.recommend_ratios()` |
| 배치 예측 | `st.file_uploader` → 예측 → `st.download_button` | `engineering.build_features()` |
| 데이터 탐색 | `st.tabs` 3개 — histogram/KDE/heatmap/boxplot/bar | `loader`, seaborn, matplotlib |
| 모델 정보 | `st.table` + 4× metric + barh | `train.get_feature_importance()` |

---

## 4. 기술적 결정 사항

| 결정 | 이유 |
|------|------|
| `streamlit_app.py` 파일명 | 기존 FastAPI `app.py` 유지 — 두 서버 공존 가능 |
| `@st.cache_resource` | 모델 객체는 앱 전체에서 1회 로드 (메모리 효율) |
| `@st.cache_data` | DataFrame은 함수 인자 기반 캐시 |
| matplotlib + seaborn | 기존 EDA 코드 재사용, plotly 의존성 추가 없음 |
| `fit=False` 배치 예측 | 저장된 imputer/scaler 재사용 — 학습-추론 일관성 보장 |

---

## 5. 실행 방법

```bash
# 의존성 설치 (최초 1회)
pip install streamlit>=1.32

# 샘플 데이터 생성 (최초 1회)
python data/raw/generate_sample.py

# 모델 학습 (최초 1회)
python scripts/train.py --data formulation_history.csv \
                        --target quality_score \
                        --model gradient_boosting

# Streamlit 앱 실행
streamlit run streamlit_app.py
# → http://localhost:8501 에서 접속
```

---

## 6. 남은 후보 작업

| 우선순위 | 항목 |
|---------|------|
| 높음 | 실데이터 투입 & 재학습 (R² ≥ 0.85 목표) |
| 낮음 | 추가 단위 테스트 (loader, engineering, metrics) |
