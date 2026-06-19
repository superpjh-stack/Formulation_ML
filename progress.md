# Formulation ML — Progress

> 최종 업데이트: 2026-06-19 (nodejs-frontend 완료)

## PDCA 전체 상태

```
[Plan] ✅ → [Design] ✅ → [Do] ✅ → [Check] ✅ → [Act-1] ✅ → [Report] ✅
```

| 항목 | 결과 |
|------|------|
| Match Rate | **100%** (초기 88.5% → Act-1 후 100%) |
| MAPE | **2.77%** (목표 ≤10% 초과 달성) |
| R² | 0.627 (샘플 노이즈 σ=3 영향, 실데이터 재측정 필요) |
| 단위 테스트 | **3/3 PASSED** |

---

## Feature 이력

| Feature | Match Rate | 완료일 | 비고 |
|---------|-----------|--------|------|
| 배합비율-최적화-ML | 100% | 2026-06-17 | 기본 ML 파이프라인 |
| notebooks-eda | 100% | 2026-06-17 | EDA 노트북 |
| streamlit-dashboard | 100% | 2026-06-17 | 모니터링 대시보드 |
| iteration2 (DOE UI) | 100% | 2026-06-19 | DOE 시뮬레이터 + 통계 분석 |
| **nodejs-frontend** | **100%** | **2026-06-19** | Next.js 14 + FastAPI API 정합성 완성 |

---

## Iteration 2 주요 변경 내역 (2026-06-18~19)

### 신규 구현
- `static/doe.html` — DOE 시뮬레이션 전체 UI (6가지 설계법, ML 시뮬레이션, 최적화, 통계 분석)
- `src/doe/routes.py` — DOE API 엔드포인트 (`/doe/sample`, `/doe/optimize`, `/doe/design`, `/doe/compare`)
- `src/doe/sample_generator.py` — 샘플 데이터 생성 + SUPPLIER_EFFECTS

### 핵심 수정
- `renderAnova()` Math.random() 제거 → 공분산 기반 F통계량 (실데이터 계산)
- `renderPareto()` 하드코딩 제거 → `_effectSS()` 실데이터 기반 효과 크기
- `GET /doe/compare` 추가: 실이력 vs DOE 비교, 공급사 효과 재보정 제안
- `SUPPLIER_EFFECTS` 실이력 200 LOT 재보정 (SUP_B 기준 상대편차)
- 시뮬레이션 기본 샘플 수 120 → **100개**
- FastAPI 0.115 → 0.137.1 업그레이드 (Starlette 1.3.1 호환)
- UnicodeEncodeError 수정 (`✓` → `[OK]`)

### 생성 문서
- `docs/03-analysis/iteration2.analysis.md`
- `docs/04-report/features/iteration2.report.md`
- `DOE_UI_사용자가이드.docx` — 사용자 관점 메뉴 설명서

---

## 현재 파일 구조

```
src/
  data/loader.py              ✅
  features/engineering.py     ✅
  models/train.py             ✅
  models/optimize.py          ✅
  evaluation/metrics.py       ✅
  doe/
    routes.py                 ✅ (iteration2)
    sample_generator.py       ✅ (iteration2)
scripts/
  train.py                    ✅
  predict.py                  ✅
  recommend.py                ✅
static/
  doe.html                    ✅ (iteration2 — ~2100줄)
data/raw/generate_sample.py   ✅
tests/test_optimize.py        ✅ (3 tests)
DOE_UI_사용자가이드.docx        ✅ (iteration2)
```

---

## 서버 실행

```bash
python -m uvicorn app:app --port 8000 --reload
# UI:  http://localhost:8000/static/doe.html
# API: http://localhost:8000/docs
```

---

## Iteration 3 — nodejs-frontend ✅ 완료

**목표**: Streamlit → Next.js 14 + FastAPI 아키텍처 전환  
**완료일**: 2026-06-19 | **Match Rate**: 100%

### 완료 내역
- `app.py` — CORS 추가, `/models`·`/recommend`·`/predict` 응답 형식 frontend 타입과 일치, `GET /eda/stats` 신규
- `scripts/train.py` — `{name}_meta.json` 저장 (metrics + feature_importances)
- `frontend/types/index.ts` — `EdaStats` 타입 추가
- `frontend/lib/api.ts` — `fetchEdaStats()` 추가
- `frontend/app/eda/page.tsx` — 더미 데이터 제거, 실 API 연동

### 잔여 작업 (다음 고려사항)
| 우선순위 | 항목 |
|---------|------|
| 높음 | 실데이터 투입 & 재학습 (R² ≥ 0.85 목표) |
| 중간 | 브라우저 E2E 테스트 (`/recommend`, `/model` 페이지) |
| 낮음 | DOE UI (static/doe.html) → Next.js 통합 (Iteration 4 후보) |

---

## 빠른 시작

```bash
# 샘플 데이터 생성
python data/raw/generate_sample.py

# 모델 학습
python scripts/train.py --data formulation_history.csv --target quality_score --model gradient_boosting

# 배합 추천
python scripts/recommend.py --model gradient_boosting --temp 250 --time 45 --supplier SUP_A

# 테스트
python -m pytest tests/ -v

# DOE UI 서버
python -m uvicorn app:app --port 8000 --reload
```
