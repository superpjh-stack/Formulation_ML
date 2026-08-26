# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Formulation ML** — 성분분석 데이터 기반 배합비율 최적화 ML 시스템. 원재료 성분 편차를 반영한 최적 배합비율 자동 추천, 품질 예측(회귀), DOE(실험계획법) 시뮬레이션을 제공한다. Backend: Python 3.10+ / FastAPI, scikit-learn, XGBoost, scipy. Frontend: Next.js 14 (`frontend/`). 레거시 대시보드로 Streamlit(`streamlit_app.py`)이 남아있으나 Next.js 프론트엔드로 전환 완료된 상태.

`docs/산출물/`은 이 레포와 별개로 진행 중인 "스마트공장 구축" 컨설팅 산출물(현행업무분석서, 설계서, 테스트결과서 등)이며, `sf_*` 계열 스킬로 생성/관리된다 — ML 코드 작업 시에는 통상 무관하다.

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

# FastAPI 서버 (ML API + DOE API), 프론트엔드가 붙는 백엔드
python -m uvicorn app:app --reload --port 8000
# API 문서: http://localhost:8000/docs
# 레거시 단독 DOE UI: http://localhost:8000/static/doe.html

# Next.js 프론트엔드 (frontend/ 디렉토리에서)
cd frontend && npm install && npm run dev   # http://localhost:3000
cd frontend && npm run type-check
cd frontend && npm run lint

# (레거시) Streamlit 대시보드
streamlit run streamlit_app.py
```

## Architecture

```
app.py                        FastAPI 진입점 — GET /models, POST /recommend, POST /predict, GET /eda/stats
                              모델·전처리기를 전역 캐시(_cache)에 로드, src/doe/routes.py 라우터 마운트
                              CORS: http://localhost:3000 (frontend) 허용

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
  doe/                      실험계획법(DOE) 모듈 — app.py 와 독립된 모델 캐시(_doe_cache) 사용
    designs.py               설계 행렬 생성: full/fractional factorial, CCD, Box-Behnken, Taguchi, LHS
                              (pyDOE2 불필요, numpy 순수 구현) — DESIGN_REGISTRY
    analysis.py               response_surface_analysis / main_effects_data / anova_table / find_optimum
    sample_generator.py       데모용 샘플 DOE 데이터 (SUPPLIER_EFFECTS 재보정치 포함)
    routes.py                 FastAPI APIRouter(prefix="/doe") — /doe/methods, /doe/design,
                              /doe/simulate, /doe/analyze, /doe/sample, /doe/compare
  evaluation/metrics.py     regression_report() → {MAE, RMSE, R², MAPE}

scripts/
  train.py                  학습 CLI — 모델 + 전처리기 저장, {name}_meta.json (metrics + feature_importances)도 함께 저장
  predict.py                배치 추론 CLI — 저장된 전처리기 로드해서 사용
  recommend.py               단건 배합 추천 CLI
  md_to_docx.py              마크다운 산출물 → docx 변환 (docs/산출물 용)

frontend/                   Next.js 14 (App Router) + TypeScript + Tailwind + Recharts
  app/                       라우트: /, /predict, /recommend, /model, /eda, /doe, (dashboard)/*
  lib/api.ts, doe-api.ts, koryo-api.ts   백엔드(app.py, src/doe/routes.py) 호출 래퍼
  types/index.ts, doe.ts    백엔드 응답 스키마와 1:1로 맞춰야 하는 TS 타입 — API 응답 필드 변경 시 함께 수정

static/doe.html             레거시 단독 HTML DOE 시뮬레이터 (~2100줄, frontend/app/doe 로 대체 예정이나 아직 병존)
streamlit_app.py            레거시 모니터링 대시보드 (Next.js 프론트엔드로 대체됨, 참고용으로만 유지)

data/raw/                   원본 CSV (git-ignored)
data/processed/             추론 결과 CSV (git-ignored)
models/artifacts/           모델(.joblib) + 전처리기 + {name}_meta.json 저장 (git-ignored)
notebooks/01_eda.ipynb      EDA (분포, 상관관계, 이상치, 성분 편차 분석)
```

## Key Conventions

- `build_features(fit=True)` — 학습 시, `fit=False` + 저장된 imputer/scaler — 추론 시
- 모델과 전처리기는 항상 같은 이름으로 쌍으로 저장됨: `{name}.joblib` + `preprocessors_{name}.joblib` (+ `{name}_meta.json`)
- `recommend_ratios()` 는 `model.feature_names_in_` 유무에 따라 피처 정렬 방식이 분기됨
- 피처 목표값: `SN_TARGET=62.0`, `AG_TARGET=3.0`, `CU_TARGET=0.5` (engineering.py 상단)
- 성분 합계 제약: `sum(sn+ag+cu+pb) ≈ 100%` (optimize.py constraints), `STANDARD_RATIOS`가 최적화 초기값
- `app.py`의 모델 캐시(`_cache`)와 `src/doe/routes.py`의 캐시(`_doe_cache`)는 독립적 — 같은 모델을 두 번 로드할 수 있음, 키 충돌은 없음
- 프론트엔드 타입(`frontend/types/`)은 백엔드 Pydantic 응답 모델과 수동으로 동기화되어야 함 — 백엔드 응답 필드를 바꾸면 프론트엔드 타입/훅도 함께 확인

## Performance Baseline (합성 시드 데이터 기준, 2026-08-25 실측)

`data/raw/generate_sample.py` 로 생성한 2,000행 학습 결과다. 값의 출처는 `models/artifacts/{name}_meta.json`.

| 모델 | RMSE | R² | MAPE | 비고 |
|------|------|-----|------|------|
| gradient_boosting | **3.6210** | **0.8739** | 3.47% | **서빙 모델** (`ml_models.active=true`) |
| xgboost | 3.8319 | 0.8588 | 3.63% | 후보 |
| random_forest | 3.9217 | 0.8521 | 3.71% | 후보 |
| ridge | 7.1481 | 0.5086 | 6.44% | 선형 베이스라인 |

**계약 게이트는 `RMSE ≤ 5.0, R² ≥ 0.60`(SF-AD2 NFR-P-05)이며 서빙 모델에만 적용한다.**
Ridge 는 `tier: "baseline"` 으로 분류되어 게이트 대상이 아니고 `/recommend` 드롭다운에서도 제외된다
(선형모델은 SLSQP 가 경계로 튄다). SF-TD4 §2.3 기준선도 ridge R² 를 0.421 로 적어 두었다.

> ⚠️ **이 수치를 실공정 성능으로 인용하지 마라.** 우리가 신호/노이즈비를 정한 시뮬레이션 결과다.
> GB 의 R² 0.8739 가 SF-AD1 희망치 0.85 를 넘지만 **"R² 0.87 달성" 표기는 허위**다.
> 실데이터 근거가 필요하면 SF-TI2 실측 **R² 0.782**(2,891건 재학습)를 인용한다.
