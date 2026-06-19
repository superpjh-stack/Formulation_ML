# 실험계획법-DOE Design Document

> **Summary**: 솔더 합금 배합 최적화를 위한 6가지 DOE(실험계획법) 설계·ML 시뮬레이션·RSM/ANOVA 분석·시각화 웹 기능
>
> **Project**: Formulation ML (성분분석 기반 배합비율 최적화)
> **Version**: 1.0.0
> **Author**: gap-detector (역설계 / reverse-engineered from implementation)
> **Date**: 2026-06-17
> **Status**: Draft
> **Planning Doc**: (Plan 문서 없음 — 구현 후 역설계로 작성됨)

> **Note**: 이 설계 문서는 이미 완료된 구현(Do Phase)을 바탕으로 역설계(reverse-engineering)되었습니다. 따라서 본 문서는 "구현된 사실"이 아니라 "기획 당시 합의된 요구사항"을 설계 형태로 복원한 것이며, Gap 분석은 이 복원된 설계 의도 vs 실제 구현 코드를 비교합니다.

---

## 1. Overview

### 1.1 Design Goals

- 기존 배합 추천(`/recommend`, `/predict`) 메뉴와 **독립적인** 실험계획법(DOE) 기능을 제공한다.
- 6가지 표준 DOE 방법으로 실험 설계 행렬을 생성한다.
- 학습된 ML 회귀 모델(XGBoost/GBM/RF/Ridge)로 각 실험점의 품질 점수를 시뮬레이션한다.
- ML 모델 아티팩트가 없어도 동작하는 **데모 모드**를 제공한다.
- RSM(반응표면법)·ANOVA·주효과·교호작용 분석과 Plotly 기반 시각화를 제공한다.

### 1.2 Design Principles

- **모듈 분리**: 설계 알고리즘 / 분석 / 샘플 생성 / 라우팅 / UI 계층 분리
- **의존성 최소화**: pyDOE2 등 외부 DOE 라이브러리 없이 numpy 순수 구현
- **데모 우선 (Graceful Degradation)**: API 실패 시 클라이언트 측 데모 데이터로 폴백
- **도메인 일관성**: 성분 목표값(`SN_TARGET`, `AG_TARGET`, `CU_TARGET`)과 성분 합계 제약(≈100%) 유지

---

## 2. Architecture

### 2.1 Component Diagram

```
static/doe.html (Plotly UI)  --HTTP/JSON-->  src/doe/routes.py (FastAPI)  --import-->  src/features/engineering.py, src/models/train.py
                              <--(or demo)--
routes.py  --(의도된 의존: 실제 미사용)-->  designs.py / analysis.py / sample_generator.py (core 모듈)
```

### 2.2 Data Flow

```
사용자 인자 범위 입력
  -> POST /doe/design (설계 행렬 생성)
  -> POST /doe/simulate (ML 예측 + 공급사/공정조건 반영)
  -> POST /doe/analyze (주효과/교호작용/RSM/ANOVA)
  -> Plotly 시각화 (3D 표면, 등고선, Box plot, 산점도)
  -> CSV 내보내기
```

### 2.3 Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `src/doe/routes.py` | `src/features/engineering`, `src/models/train` | 전처리기·모델 로드 후 예측 |
| `static/doe.html` | `routes.py` (HTTP), Plotly CDN | UI 렌더링 및 시각화 |
| `app.py` | `src/doe/routes.router` | DOE 라우터 마운트, StaticFiles |

---

## 3. Data Model

### 3.1 핵심 개념

DOE 기능은 영속 엔티티(DB)를 갖지 않는 **stateless 연산 기능**이다. 주요 데이터 구조:

```python
# 인자 정의 (FactorSpec)
{ "sn_pct": {"min": 58.0, "max": 68.0, "levels": 3}, ... }

# 설계 행렬 (design_matrix) — dict 목록
[ {"sn_pct": 59.0, "ag_pct": 2.0, "cu_pct": 0.2, "pb_pct": 38.8, "other_pct": 0.0}, ... ]

# 시뮬레이션 결과 (simulated_data)
[ {... 인자, "supplier": "SUP_A", "predicted_quality": 87.3, "is_defect": 0}, ... ]
```

### 3.2 도메인 상수 (engineering.py 와 일치)

| 상수 | 값 | 의미 |
|------|-----|------|
| `SN_TARGET` | 62.0 | Sn 목표 비율(%) |
| `AG_TARGET` | 3.0 | Ag 목표 비율(%) |
| `CU_TARGET` | 0.5 | Cu 목표 비율(%) |
| 성분 합계 | ≈ 100% | `pb_pct = 100 - sn - ag - cu - other` 자동 보정 |

---

## 4. API Specification

### 4.1 Endpoint List

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | /doe/methods | 지원 6가지 DOE 방법 + 메타데이터 | None |
| POST | /doe/design | 설계 행렬 생성 (method + factors) | None |
| POST | /doe/simulate | ML 모델 배치 예측 (공급사·공정조건 반영) | None |
| POST | /doe/analyze | 주효과/교호작용/RSM/ANOVA 분석 | None |
| GET | /doe/sample?n_points=N | 데모용 결정론적 샘플 데이터 (20~1000) | None |

### 4.2 Detailed Specification

#### `POST /doe/design`

Request:
```json
{ "method": "ccd", "factors": { "sn_pct": {"min": 58, "max": 68, "levels": 3} }, "n_samples": 30 }
```
Response (200):
```json
{ "method": "ccd", "method_name": "Central Composite Design", "n_experiments": 27, "design_matrix": [ { "sn_pct": 59.0, "pb_pct": 38.0, "other_pct": 0.0 } ], "factor_info": { "sn_pct": {"min": 58, "max": 68, "levels": 3} } }
```

#### `GET /doe/sample?method=lhs&n_points=120`

Response (200):
```json
{ "method": "lhs", "n_points": 120, "n_experiments": 120, "simulated_data": [ {"supplier": "SUP_A", "predicted_quality": 87.3, "is_defect": 0} ], "summary": {"mean": 82.1, "std": 6.4, "n_defect": 4, "defect_rate": 3.3}, "optimal_point": { } }
```

Error Responses:
- `400 Bad Request`: 알 수 없는 method / model
- `404 Not Found`: 모델 아티팩트 없음
- `422 Unprocessable`: 성분 합계 100% 초과 (pb_pct 음수)

---

## 5. UI/UX Design

### 5.1 화면 구성 (static/doe.html, 단일 SPA)

| 그룹 | 페이지 |
|------|--------|
| 설계 (design) | full_factorial, fractional_factorial, ccd, box_behnken, taguchi, lhs |
| 시뮬레이션 (simulation) | batch_simulate, model_select |
| 최적화 (optimization) | single_objective, sensitivity, monte_carlo, pareto |
| 분석 (analysis) | response_surface, main_effects, anova, interaction, pareto-chart |

### 5.2 User Flow

```
DOE 방법 선택 -> 인자 활성화/범위 입력 -> 설계 생성 -> 시뮬레이션(N=120) -> 결과 테이블(50행 페이지네이션) -> 분석/시각화 -> CSV 내보내기
```

### 5.3 시각화 (Plotly)

| 차트 | 위치 |
|------|------|
| 3D 반응표면 (surface) | response_surface |
| 등고선도 (contour) | optimize, response_surface |
| Box plot (공급사별 품질) | batch_simulate |
| 산점도 (SN% vs 품질, 온도 vs 품질) | batch_simulate |
| 히스토그램 / CDF | monte_carlo, optimize |
| 파레토 프론트 | pareto |

### 5.4 데모 모드 / 페이지네이션

- API 호출 실패 시 `generateDemoDesign()` / `generateDemoSimResult()` 로 클라이언트 폴백
- 시뮬레이션 결과 테이블: 50행/페이지 페이지네이션 + 전체 스크롤(`max-height:400px; overflow-y:auto`)

---

## 6. Error Handling

| Code | 상황 | 처리 |
|------|------|------|
| 400 | 알 수 없는 method/model | 지원 목록 반환 |
| 404 | 모델 아티팩트 없음 | 학습 명령 안내 |
| 422 | 성분 합계 초과 / 반응 컬럼 없음 | 오류 행/컬럼 명시 |
| 500 | 샘플 생성 실패 | 일반 오류 |

---

## 7. Test Plan

| Type | Target | Tool |
|------|--------|------|
| 문법 검사 | 6개 신규 파일 | `python -m py_compile` |
| API 테스트 | `/doe/sample?n_points=120` | 수동/HTTP |
| 분포 검증 | SUP_A/B/C 균등 배분 | 수동 |

---

## 8. 요구사항 추적 매트릭스 (기획 합의 기준)

| # | 요구사항 | 설계 위치 |
|---|----------|-----------|
| 1 | DOE 메뉴를 기존 메뉴와 별도 구현 | 2.1, app.py 라우터 분리 |
| 2 | 6가지 DOE 방법 지원 | 4.1 /doe/methods, 5.1 |
| 3 | ML 시뮬레이션 (4개 모델) | 4.2 /doe/simulate |
| 4 | 100+ 샘플 생성 (n_points <= 1000) | 4.2 /doe/sample |
| 5 | 3개 공급사 균등 배분 | 5, sample 생성 로직 |
| 6 | 온도·시간 효과 품질 함수 | 3.2 품질 함수 |
| 7 | 반응표면 시각화 (3D/등고선/Box/산점도) | 5.3 |
| 8 | ANOVA 분석 테이블 | 4.2 /doe/analyze |
| 9 | 결과 CSV 내보내기 | 5.2 |
| 10 | API 없이 데모 모드 동작 | 5.4 |
| 11 | 페이지네이션(50행) + 스크롤 | 5.4 |

---

## 9. Clean Architecture

> 본 프로젝트는 Python ML 시스템(Starter~Dynamic 수준)이며 TS/React 4-layer 규약은 적용 대상이 아니다. Python 모듈 계층 관점으로 평가한다.

| Layer | 책임 | 위치 |
|-------|------|------|
| Presentation | UI/시각화 | `static/doe.html` |
| Application (routing) | HTTP 핸들링, 검증, 오케스트레이션 | `src/doe/routes.py` |
| Domain/Core | DOE 알고리즘, 분석, 샘플 생성 | `src/doe/{designs,analysis,sample_generator}.py` |
| Infrastructure | 모델/전처리기 로드 | `src/models/train.py`, `src/features/engineering.py` |

### 9.1 의존성 규칙

- routes.py -> engineering/train (Infrastructure): 허용 방향 OK
- routes.py -> designs/analysis/sample_generator (Core): 의도된 방향이나 실제 미사용 (Gap 항목 참조)

---

## 10. Coding Convention Reference

| Target | Rule | 적용 |
|--------|------|------|
| 함수 | snake_case (Python) | `full_factorial`, `response_surface_analysis` |
| 상수 | UPPER_SNAKE_CASE | `SN_TARGET`, `DESIGN_REGISTRY` |
| 모듈 파일 | snake_case.py | `sample_generator.py` |
| 도메인 상수 일관성 | engineering.py 기준 재사용 | `SN/AG/CU_TARGET` |

---

## 11. Implementation Guide

### 11.1 File Structure

```
src/doe/
  __init__.py            # 패키지 export
  designs.py             # 6 DOE 알고리즘 (numpy, coded 컬럼)
  analysis.py            # RSM/ANOVA/주효과/교호작용
  sample_generator.py    # ML 시뮬 + 데모 샘플
  routes.py              # FastAPI 라우터 (5 엔드포인트)
static/doe.html          # SPA UI
app.py                   # 라우터 마운트
```

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 0.1 | 2026-06-17 | 구현 기반 역설계 초안 | gap-detector |
