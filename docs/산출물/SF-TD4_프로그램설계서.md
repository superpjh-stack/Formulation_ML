# SF-TD4 프로그램설계서

**문서번호**: SF-TD4 | **버전**: V1.0 | **작성일**: 2026-06-19 | **작성자**: 개발팀  
**프로젝트명**: 성분분석 데이터 기반 배합비율 최적화 ML 시스템 (Formulation ML)  
**적용 범위**: Backend API 서버(FastAPI), ML 파이프라인, DOE 시뮬레이터

---

## 1. 문서 개요

### 1.1 목적

본 문서는 Formulation ML 시스템의 프로그램 설계를 기술한다. 모듈 구성, API 엔드포인트 명세, 핵심 함수 설계, 오류 처리 방식, 성능 최적화 전략을 포함하며, 개발자 구현 지침 및 유지보수 참조 문서로 활용된다.

### 1.2 대상 독자

- 백엔드 개발자 / ML 엔지니어
- 시스템 통합 및 API 연동 담당자
- 유지보수 담당자

### 1.3 시스템 개요

| 항목 | 내용 |
|------|------|
| 언어 | Python 3.10+ |
| 프레임워크 | FastAPI 0.137.1 |
| ML 라이브러리 | scikit-learn, XGBoost, scipy |
| 서버 포트 | 8000 (FastAPI), 3000 (Next.js) |
| 진입점 | `app.py` (uvicorn app:app --reload --port 8000) |

---

## 2. 모듈 구성

### 2.1 전체 모듈 목록

| 모듈ID | 모듈명 | 파일 경로 | 담당 기능 | 의존성 |
|--------|--------|-----------|-----------|--------|
| MOD-01 | API 서버 진입점 | `app.py` | FastAPI 앱 초기화, 전역 모델 캐시 관리, 라우터 등록, CORS 설정 | MOD-02, MOD-03, MOD-04, MOD-05, MOD-09 |
| MOD-02 | 데이터 로더 | `src/data/loader.py` | 원시 CSV 로드(`load_raw`), 전처리 CSV 저장/로드 | pandas |
| MOD-03 | 피처 엔지니어링 | `src/features/engineering.py` | 파생 피처 생성, 결측값 처리, 표준화, 전처리기 저장/로드 | sklearn, joblib |
| MOD-04 | 모델 학습/추론 | `src/models/train.py` | REGISTRY 관리, 학습·교차검증·저장·로드, 피처 중요도 | sklearn, xgboost, joblib |
| MOD-05 | 배합비율 최적화 | `src/models/optimize.py` | SLSQP 제약 최적화, 최적 배합비율 추천 | scipy, MOD-03 |
| MOD-06 | 평가 지표 | `src/evaluation/metrics.py` | MAE, RMSE, R², MAPE 계산 | sklearn, numpy |
| MOD-07 | DOE 라우터 | `src/doe/routes.py` | DOE 관련 API 엔드포인트 6종 구현 | MOD-03, MOD-04, MOD-05, MOD-08, MOD-10 |
| MOD-08 | DOE 설계 행렬 | `src/doe/designs.py` | DESIGN_REGISTRY — 6종 DOE 설계 행렬 생성 함수 | numpy, pandas |
| MOD-09 | DOE 샘플 생성기 | `src/doe/sample_generator.py` | 모델 없이 결정론적 샘플 DOE 데이터 생성 | numpy, pandas |
| MOD-10 | 학습 스크립트 | `scripts/train.py` | CLI — 모델 + 전처리기 학습 및 메타데이터 저장 | MOD-03, MOD-04, MOD-06 |
| MOD-11 | 예측 스크립트 | `scripts/predict.py` | CLI — 배치 추론, 결과 CSV 저장 | MOD-03, MOD-04 |
| MOD-12 | 추천 스크립트 | `scripts/recommend.py` | CLI — 단건 배합비율 추천 | MOD-04, MOD-05 |
| MOD-13 | 샘플 데이터 생성 | `data/raw/generate_sample.py` | 300 LOT 합성 학습 데이터 생성 | numpy, pandas |

### 2.2 디렉터리 구조

```
04 Formulation ML/
├── app.py                          # FastAPI 진입점 (MOD-01)
├── src/
│   ├── data/
│   │   └── loader.py               # MOD-02
│   ├── features/
│   │   └── engineering.py          # MOD-03
│   ├── models/
│   │   ├── train.py                # MOD-04
│   │   └── optimize.py             # MOD-05
│   ├── evaluation/
│   │   └── metrics.py              # MOD-06
│   └── doe/
│       ├── routes.py               # MOD-07
│       ├── designs.py              # MOD-08
│       └── sample_generator.py     # MOD-09
├── scripts/
│   ├── train.py                    # MOD-10
│   ├── predict.py                  # MOD-11
│   └── recommend.py                # MOD-12
├── data/
│   ├── raw/
│   │   ├── generate_sample.py      # MOD-13
│   │   └── formulation_history.csv # 원시 학습 데이터 (git-ignored)
│   └── processed/                  # 추론 결과 (git-ignored)
├── models/
│   └── artifacts/                  # 모델 + 전처리기 저장 (git-ignored)
└── frontend/                       # Next.js 14 프론트엔드
```

---

## 3. API 설계서

### 3.1 공통 규칙

#### Base URL

```
http://localhost:8000
```

#### 인증

현재 버전은 인증 없음 (내부망 전용). 향후 JWT Bearer Token 방식 도입 예정.

#### 공통 헤더

| 헤더 | 값 | 설명 |
|------|----|------|
| Content-Type | application/json | 요청 Body 형식 |
| Accept | application/json | 응답 형식 |

#### CORS 허용 Origin

```
http://localhost:3000
```

#### 공통 오류 응답 형식

```json
{
  "detail": "오류 설명 문자열 또는 오류 객체"
}
```

#### HTTP 오류 코드 정의

| 코드 | 의미 | 발생 조건 |
|------|------|-----------|
| 400 | Bad Request | 알 수 없는 모델명, 잘못된 파라미터 |
| 404 | Not Found | 모델 아티팩트 파일 없음, 데이터 파일 없음 |
| 422 | Unprocessable Entity | Pydantic 유효성 검사 실패, 성분 합계 초과 |
| 500 | Internal Server Error | 예측 연산 실패, 예기치 않은 예외 |
| 503 | Service Unavailable | 데이터 파일 없음 (EDA 엔드포인트) |

---

### 3.2 엔드포인트별 상세 명세

---

#### [1] GET /

**설명**: 서버 상태 확인 및 로드된 모델 목록 반환 (헬스체크)  
**태그**: 상태

**Request**
- Body: 없음
- Query Parameter: 없음

**Response 200 OK**

```json
{
  "status": "ok",
  "loaded_models": ["xgboost", "gradient_boosting"],
  "available_models": ["ridge", "random_forest", "gradient_boosting", "xgboost"]
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| status | string | 항상 "ok" |
| loaded_models | string[] | 현재 메모리에 캐시된 모델 이름 목록 |
| available_models | string[] | REGISTRY에 등록된 전체 모델 이름 목록 |

**오류 응답**: 없음 (항상 200 반환)

---

#### [2] GET /models

**설명**: 학습 완료된 모델 목록 + 성능 지표 + 피처 중요도 반환  
**태그**: 상태

**Request**
- Body: 없음

**Response 200 OK**

```json
[
  {
    "name": "gradient_boosting",
    "metrics": {
      "mae": 2.31,
      "rmse": 3.05,
      "r2": 0.627,
      "mape": 2.78
    },
    "feature_importances": [
      {"feature": "sn_deviation", "importance": 0.312},
      {"feature": "melt_temp_c", "importance": 0.198}
    ],
    "trained_at": "2026-06-19T10:30:00"
  }
]
```

| 필드 | 타입 | 설명 |
|------|------|------|
| name | string | 모델 식별자 |
| metrics.mae | float | Mean Absolute Error |
| metrics.rmse | float | Root Mean Squared Error |
| metrics.r2 | float | 결정계수 (0~1) |
| metrics.mape | float | Mean Absolute Percentage Error (%) |
| feature_importances | object[] | 피처명·중요도 목록 (상위 10개) |
| trained_at | string \| null | 학습 완료 시각 (ISO 8601) |

**조건**: `models/artifacts/{name}.joblib` 파일이 존재하는 모델만 반환됨.

---

#### [3] POST /recommend

**설명**: 공정 조건 입력 → SLSQP 최적화로 최적 SN/AG/CU/PB 배합비율 추천  
**태그**: 추천

**Request Body**

```json
{
  "model": "xgboost",
  "temperature": 250.0,
  "process_time": 45.0,
  "supplier": "SUP_A",
  "sn_bounds": [58.0, 68.0],
  "ag_bounds": [1.0, 5.0],
  "cu_bounds": [0.1, 1.5]
}
```

| 필드 | 타입 | 제약 | 기본값 | 설명 |
|------|------|------|--------|------|
| model | string | ridge \| random_forest \| gradient_boosting \| xgboost | "xgboost" | 사용 ML 모델 |
| temperature | float | 200 ≤ x ≤ 320 | 250.0 | 용해 온도 (°C) |
| process_time | float | 10 ≤ x ≤ 120 | 45.0 | 가열 시간 (분) |
| supplier | string | ^SUP_[ABC]$ | "SUP_A" | 공급사 코드 |
| sn_bounds | [float, float] \| null | — | null | SN 비율 허용 범위 (미지정 시 55~70) |
| ag_bounds | [float, float] \| null | — | null | AG 비율 허용 범위 (미지정 시 0~5) |
| cu_bounds | [float, float] \| null | — | null | CU 비율 허용 범위 (미지정 시 0~2) |

**Response 200 OK**

```json
{
  "recommended_ratios": {
    "sn": 62.5,
    "ag": 3.1,
    "cu": 0.52,
    "pb": 33.88
  },
  "predicted_quality": 88.341,
  "optimization_success": true,
  "message": "최적화 성공"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| recommended_ratios.sn | float | 최적 SN 비율 (%) |
| recommended_ratios.ag | float | 최적 AG 비율 (%) |
| recommended_ratios.cu | float | 최적 CU 비율 (%) |
| recommended_ratios.pb | float | 최적 PB 비율 (%, 100 - sn - ag - cu) |
| predicted_quality | float \| null | 예측 품질 점수. 최적화 실패 시 null |
| optimization_success | boolean | SLSQP 수렴 성공 여부 |
| message | string | 결과 메시지 |

**오류 응답**

| 코드 | 조건 | detail 예시 |
|------|------|------------|
| 404 | 모델 아티팩트 없음 | "모델 'xgboost' 아티팩트 없음. 먼저 학습하세요: python scripts/train.py --model xgboost" |
| 422 | 유효성 검사 실패 (온도 범위 초과 등) | Pydantic ValidationError 상세 |

---

#### [4] POST /predict

**설명**: 성분 비율 + 공정 조건 직접 입력 → 품질 점수 단건 예측  
**태그**: 예측

**Request Body**

```json
{
  "model": "xgboost",
  "sn_ratio": 62.0,
  "ag_ratio": 3.0,
  "cu_ratio": 0.5,
  "pb_ratio": 34.5,
  "temperature": 250.0,
  "process_time": 45.0,
  "supplier": "SUP_A"
}
```

| 필드 | 타입 | 제약 | 기본값 | 설명 |
|------|------|------|--------|------|
| model | string | 등록 모델 중 하나 | "xgboost" | 사용 모델 |
| sn_ratio | float | 필수 | — | SN 비율 (%) |
| ag_ratio | float | 필수 | — | AG 비율 (%) |
| cu_ratio | float | 필수 | — | CU 비율 (%) |
| pb_ratio | float | 필수 | — | PB 비율 (%) |
| temperature | float | — | 250.0 | 용해 온도 (°C) |
| process_time | float | — | 45.0 | 가열 시간 (분) |
| supplier | string | ^SUP_[ABC]$ | "SUP_A" | 공급사 코드 |

**Response 200 OK**

```json
{
  "predicted_quality": 87.523,
  "model_used": "xgboost"
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| predicted_quality | float | 예측 품질 점수 (소수 3자리) |
| model_used | string | 실제 사용된 모델 이름 |

**오류 응답**

| 코드 | 조건 |
|------|------|
| 404 | 모델 아티팩트 없음 |
| 422 | 필수 필드 누락 또는 타입 오류 |

---

#### [5] GET /eda/stats

**설명**: EDA 통계 데이터 반환 — SN/AG/CU 성분 분포, 품질 통계, SN-품질 상관 산점도  
**태그**: EDA

**Request**
- Body: 없음

**동작 로직**
1. `data/raw/formulation_history.csv` 로드 시도
2. 파일 없으면 `data/raw/generate_sample.py` 자동 실행 후 재시도
3. 재시도 실패 시 503 반환

**Response 200 OK**

```json
{
  "sn_distribution": [
    {"range": "58.0-60.4", "count": 42},
    {"range": "60.4-62.8", "count": 88}
  ],
  "ag_distribution": [
    {"range": "2.0-2.6", "count": 61}
  ],
  "cu_distribution": [
    {"range": "0.2-0.5", "count": 55}
  ],
  "sn_vs_quality": [
    {"sn": 62.1, "quality": 85.3}
  ],
  "stats": {
    "total_lots": 300,
    "mean_quality": 81.45,
    "std_quality": 6.21
  }
}
```

| 필드 | 타입 | 설명 |
|------|------|------|
| sn_distribution | object[] | SN 비율 히스토그램 (5구간) |
| ag_distribution | object[] | AG 비율 히스토그램 (5구간) |
| cu_distribution | object[] | CU 비율 히스토그램 (5구간) |
| sn_vs_quality | object[] | SN vs 품질 산점도 샘플 (최대 60개) |
| stats.total_lots | int | 전체 LOT 수 |
| stats.mean_quality | float | 평균 품질 점수 |
| stats.std_quality | float | 품질 점수 표준편차 |

**오류 응답**

| 코드 | 조건 |
|------|------|
| 503 | 데이터 파일 생성 및 로드 모두 실패 |

---

#### [6] GET /doe/methods

**설명**: 지원하는 6가지 DOE 방법의 설명, 권장 인자 수, 실험 수 메타데이터 반환  
**태그**: DOE

**Request**
- Body: 없음

**Response 200 OK**

```json
{
  "supported_methods": ["full_factorial", "fractional_factorial", "ccd", "box_behnken", "taguchi", "lhs"],
  "metadata": {
    "full_factorial": {
      "name": "Full Factorial",
      "description": "모든 인자 수준 조합 — 교호작용 완전 추정 가능",
      "recommended_factors": "2~4",
      "typical_experiments": "8~81",
      "pros": "완전한 정보, 교호작용 파악",
      "cons": "인자 수 증가 시 실험 수 급증"
    },
    "ccd": { "..." : "..." }
  }
}
```

---

#### [7] POST /doe/design

**설명**: DOE 방법과 인자 범위를 입력받아 설계 행렬 생성  
**태그**: DOE

**Request Body**

```json
{
  "method": "ccd",
  "factors": {
    "sn_pct": {"min": 58.0, "max": 68.0, "levels": 3},
    "ag_pct": {"min": 1.0, "max": 5.0, "levels": 3},
    "cu_pct": {"min": 0.1, "max": 1.5, "levels": 3}
  },
  "n_samples": 30
}
```

| 필드 | 타입 | 제약 | 기본값 | 설명 |
|------|------|------|--------|------|
| method | string | full_factorial \| fractional_factorial \| ccd \| box_behnken \| taguchi \| lhs | "ccd" | DOE 방법 |
| factors | object | 인자명: {min, max, levels} | 필수 | 인자별 범위 및 수준 수 |
| factors.*.min | float | min < max | 필수 | 인자 최솟값 |
| factors.*.max | float | min < max | 필수 | 인자 최댓값 |
| factors.*.levels | int | 2 ≤ x ≤ 10 | 3 | 수준 수 |
| n_samples | int | 5 ≤ x ≤ 500 | 30 | LHS 전용 샘플 수 |

**Response 200 OK**

```json
{
  "method": "ccd",
  "method_name": "Central Composite Design",
  "n_experiments": 21,
  "design_matrix": [
    {"sn_pct": 58.0, "ag_pct": 1.0, "cu_pct": 0.1, "pb_pct": 40.9, "other_pct": 0.0},
    {"sn_pct": 63.0, "ag_pct": 3.0, "cu_pct": 0.8, "pb_pct": 33.2, "other_pct": 0.0}
  ],
  "factor_info": {
    "sn_pct": {"min": 58.0, "max": 68.0, "levels": 3}
  }
}
```

**오류 응답**

| 코드 | 조건 |
|------|------|
| 422 | method 값 오류, min >= max, sn+ag+cu 합계가 100% 초과 |

---

#### [8] POST /doe/simulate

**설명**: 설계 행렬의 각 실험 조건에 대해 ML 모델로 품질 점수 배치 예측  
**태그**: DOE

**Request Body**

```json
{
  "design_matrix": [
    {"sn_pct": 62.0, "ag_pct": 3.0, "cu_pct": 0.5}
  ],
  "model": "xgboost",
  "supplier": "SUP_A",
  "melt_temp_c": 250.0,
  "melt_time_min": 45.0,
  "add_noise": false,
  "noise_std": 1.0
}
```

| 필드 | 타입 | 제약 | 기본값 | 설명 |
|------|------|------|--------|------|
| design_matrix | object[] | 필수 | — | POST /doe/design 반환값 |
| model | string | 등록 모델 중 하나 | "xgboost" | 예측 모델 |
| supplier | string | ^SUP_[ABC]$ | "SUP_A" | 공급사 코드 |
| melt_temp_c | float | 200 ≤ x ≤ 320 | 250.0 | 용해 온도 (°C) |
| melt_time_min | float | 10 ≤ x ≤ 120 | 45.0 | 가열 시간 (분) |
| add_noise | boolean | — | false | Monte Carlo 노이즈 추가 여부 |
| noise_std | float | ≥ 0.0 | 1.0 | 노이즈 표준편차 (add_noise=true 시 사용) |

**Response 200 OK**

```json
{
  "simulated_data": [
    {
      "sn_pct": 62.0, "ag_pct": 3.0, "cu_pct": 0.5,
      "melt_temp_c": 250.0, "melt_time_min": 45.0,
      "supplier": "SUP_A", "predicted_quality": 87.523
    }
  ],
  "summary": {
    "mean": 84.21, "std": 4.31, "min": 72.1, "max": 91.5,
    "n_experiments": 21, "model": "xgboost", "noise_applied": false
  },
  "optimal_point": {
    "sn_pct": 63.2, "ag_pct": 3.1, "cu_pct": 0.52,
    "predicted_quality": 91.5
  }
}
```

**오류 응답**

| 코드 | 조건 |
|------|------|
| 400 | 알 수 없는 모델명 |
| 404 | 모델 아티팩트 없음 |
| 422 | pb_pct 음수 (sn+ag+cu > 100), 유효 예측 결과 없음 |

---

#### [9] POST /doe/analyze

**설명**: 시뮬레이션 결과를 받아 주효과, 2인자 교호작용, 2차 RSM 계수, 간이 ANOVA 테이블, 최적 조건 반환  
**태그**: DOE

**Request Body**

```json
{
  "simulated_data": [
    {"sn_pct": 62.0, "ag_pct": 3.0, "cu_pct": 0.5, "predicted_quality": 87.5}
  ],
  "response_col": "predicted_quality",
  "factor_cols": ["sn_pct", "ag_pct", "cu_pct"]
}
```

| 필드 | 타입 | 제약 | 기본값 | 설명 |
|------|------|------|--------|------|
| simulated_data | object[] | 필수 | — | POST /doe/simulate 반환 simulated_data |
| response_col | string | — | "predicted_quality" | 반응값 컬럼명 |
| factor_cols | string[] \| null | — | null (자동 탐색) | 분석할 인자 컬럼 목록 |

**Response 200 OK**

```json
{
  "n_experiments": 21,
  "factor_cols": ["sn_pct", "ag_pct", "cu_pct"],
  "response_col": "predicted_quality",
  "r_squared": 0.8921,
  "rsm_coefficients": {
    "intercept": 85.2, "sn_pct": 2.31, "ag_pct": 0.95,
    "sn_pct^2": -0.42, "sn_pct*ag_pct": 0.18
  },
  "main_effects": {"sn_pct": 2.31, "ag_pct": 0.95, "cu_pct": 0.62},
  "interactions": {"sn_pct*ag_pct": 0.18, "sn_pct*cu_pct": 0.07},
  "anova_table": [
    {"source": "Model", "df": 9, "SS": 821.3, "MS": 91.3, "F": 24.5},
    {"source": "Error", "df": 11, "SS": 41.2, "MS": 3.74, "F": null},
    {"source": "Total", "df": 20, "SS": 862.5, "MS": null, "F": null}
  ],
  "optimal_conditions": {
    "sn_pct": 63.4, "ag_pct": 3.2, "cu_pct": 0.55,
    "rsm_predicted_quality": 91.2
  }
}
```

**오류 응답**

| 코드 | 조건 |
|------|------|
| 422 | response_col이 데이터에 없음, 수치형 인자 컬럼 없음 |

---

#### [10] POST /doe/optimize

**설명**: SLSQP 제약 최적화 또는 LHS 전수탐색으로 품질 최대화 배합비율 탐색  
**태그**: DOE

**Request Body**

```json
{
  "factors": {
    "sn_pct": {"min": 58.0, "max": 68.0},
    "ag_pct": {"min": 1.0, "max": 5.0},
    "cu_pct": {"min": 0.1, "max": 1.5}
  },
  "model": "xgboost",
  "supplier": "SUP_A",
  "method": "slsqp",
  "melt_temp_c": 250.0,
  "melt_time_min": 45.0,
  "n_candidates": 200
}
```

| 필드 | 타입 | 제약 | 기본값 | 설명 |
|------|------|------|--------|------|
| factors | object | 인자명: {min, max} | 기본 범위 | 탐색 범위 |
| model | string | 등록 모델 중 하나 | "xgboost" | 사용 ML 모델 |
| supplier | string | ^SUP_[ABC]$ | "SUP_A" | 공급사 코드 |
| method | string | slsqp \| lhs_best | "slsqp" | 최적화 방법 |
| melt_temp_c | float | — | 250.0 | 용해 온도 (°C) |
| melt_time_min | float | — | 45.0 | 가열 시간 (분) |
| n_candidates | int | 50 ≤ x ≤ 2000 | 200 | lhs_best 후보 수 |

**최적화 방법 비교**

| 방법 | 알고리즘 | 특징 |
|------|----------|------|
| slsqp | scipy SLSQP 제약 최적화 | 빠름, 지역 최적 위험 |
| lhs_best | LHS n_candidates개 예측 후 상위 5개 선택 | 안전, 전역 탐색 |

**Response 200 OK**

```json
{
  "method": "slsqp",
  "model": "xgboost",
  "supplier": "SUP_A",
  "process_conditions": {"melt_temp_c": 250.0, "melt_time_min": 45.0},
  "optimal_conditions": {
    "sn_pct": 63.2, "ag_pct": 3.1, "cu_pct": 0.52, "pb_pct": 33.18,
    "predicted_quality": 91.5, "success": true, "message": "최적화 성공"
  },
  "top5_candidates": [
    {"sn_pct": 63.2, "ag_pct": 3.1, "cu_pct": 0.52, "predicted_quality": 91.5}
  ],
  "factor_ranges": {
    "sn_pct": {"min": 58.0, "max": 68.0}
  }
}
```

---

#### [11] GET /doe/sample

**설명**: ML 모델 없이 결정론적 샘플 DOE 데이터 반환 (데모용)  
**태그**: DOE

**Query Parameters**

| 파라미터 | 타입 | 제약 | 기본값 | 설명 |
|----------|------|------|--------|------|
| method | string | DOE 방법 6종 중 하나 | "lhs" | DOE 방법 |
| n_points | int | 20 ≤ x ≤ 1000 | 100 | 샘플 수 (LHS 전용; 다른 방법은 기본 설계 후 보충) |

**Response 200 OK**

```json
{
  "method": "lhs",
  "method_name": "Latin Hypercube Sampling",
  "note": "100개 결정론적 샘플 데이터 (ML 모델 없이 생성됨)",
  "n_points": 100,
  "n_experiments": 100,
  "simulated_data": [
    {"sn_pct": 62.1, "ag_pct": 3.05, "cu_pct": 0.51, "predicted_quality": 85.3}
  ],
  "summary": {
    "mean": 81.2, "std": 5.4, "min": 60.1, "max": 93.2,
    "n_defect": 8, "defect_rate": 8.0
  },
  "optimal_point": {"sn_pct": 63.0, "predicted_quality": 93.2},
  "factor_cols": ["sn_pct", "ag_pct", "cu_pct", "melt_temp_c", "melt_time_min"],
  "metadata": {}
}
```

**오류 응답**

| 코드 | 조건 |
|------|------|
| 400 | 알 수 없는 method 값 |
| 500 | 샘플 생성 실패 |

---

#### [12] GET /doe/compare

**설명**: formulation_history.csv 실생산 이력 vs 공급사별 품질 통계 비교 반환  
**태그**: DOE

**Query Parameters**

| 파라미터 | 타입 | 제약 | 기본값 | 설명 |
|----------|------|------|--------|------|
| lot_count | int | 5 ≤ x ≤ 200 | 30 | 로드할 이력 샘플 수 |

**Response 200 OK**

```json
{
  "lot_count": 30,
  "history": [
    {"lot_id": "LOT_001", "sn_pct": 62.1, "quality_score": 85.3}
  ],
  "supplier_stats": [
    {
      "supplier": "SUP_A", "n": 15,
      "mean_quality": 83.2, "std_quality": 4.1,
      "sn_mean": 62.3, "sn_bias": 0.3
    }
  ],
  "calibrated_effects": {
    "SUP_A": {"sn_bias": 0.3, "ag_bias": -0.1, "cu_bias": 0.02, "noise_mult": 0.95}
  },
  "current_vs_calibrated": [
    {
      "supplier": "SUP_A",
      "current_sn_bias": 0.2, "calibrated_sn_bias": 0.3,
      "current_noise_mult": 0.8, "calibrated_noise_mult": 0.95
    }
  ],
  "summary": {"overall_mean": 82.1, "overall_std": 5.2, "n_suppliers": 3}
}
```

**오류 응답**

| 코드 | 조건 |
|------|------|
| 404 | formulation_history.csv 없음 |

---

## 4. 클래스/함수 설계

### 4.1 핵심 함수 명세

---

#### `build_features(df, target_col, imputer, scaler, fit)`

**위치**: `src/features/engineering.py`

**시그니처**:
```python
def build_features(
    df: pd.DataFrame,
    target_col: str,
    imputer: SimpleImputer | None,
    scaler: StandardScaler | None,
    fit: bool = True,
) -> tuple[pd.DataFrame, pd.Series, SimpleImputer, StandardScaler]
```

**입력**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| df | pd.DataFrame | 원시 또는 중간 처리된 배합 데이터 |
| target_col | str | 예측 대상 컬럼명 (예: "quality_score") |
| imputer | SimpleImputer \| None | fit=False 시 저장된 imputer 전달, fit=True 시 None 가능 |
| scaler | StandardScaler \| None | fit=False 시 저장된 scaler 전달 |
| fit | bool | True=학습 시 새로 fitting, False=추론 시 기존 객체 사용 |

**출력**

| 반환값 | 타입 | 설명 |
|--------|------|------|
| X | pd.DataFrame | 전처리 완료된 피처 행렬 |
| y | pd.Series | 타겟 시리즈 (target_col 미존재 시 빈 Series) |
| imputer | SimpleImputer | fit=True 시 새로 학습된 객체, fit=False 시 입력 그대로 반환 |
| scaler | StandardScaler | 동일 |

**처리 로직**:
1. 파생 피처 3개 생성: `sn_deviation = sn_pct - 62.0`, `ag_deviation = ag_pct - 3.0`, `cu_deviation = cu_pct - 0.5`
2. target_col, lot_id, is_defect, quality_score 컬럼 제거
3. 범주형 컬럼 원-핫 인코딩 (`get_dummies`, drop_first=True) — supplier_id → supplier_id_SUP_B, supplier_id_SUP_C
4. NUM_COLS(`sn_pct`, `ag_pct`, `cu_pct`, `pb_pct`, `melt_temp_c`, `melt_time_min`, `sn_deviation`, `ag_deviation`, `cu_deviation`) 에 imputer(중앙값) + scaler(StandardScaler) 적용

**주의사항**:
- fit=False 사용 시 반드시 저장된 imputer/scaler를 전달해야 함
- other_pct 컬럼은 NUM_COLS에 포함되지 않아 스케일링 미적용

---

#### `recommend_ratios(process_conditions, model, imputer, scaler, bounds, standard_ratios)`

**위치**: `src/models/optimize.py`

**시그니처**:
```python
def recommend_ratios(
    process_conditions: dict,
    model,
    imputer,
    scaler,
    bounds: dict | None = None,
    standard_ratios: dict | None = None,
) -> dict
```

**입력**

| 파라미터 | 타입 | 설명 |
|----------|------|------|
| process_conditions | dict | {"melt_temp_c": 250, "melt_time_min": 45, "supplier_id_SUP_B": 0, "supplier_id_SUP_C": 0} |
| model | sklearn/XGB 모델 | 학습된 품질 예측 모델 |
| imputer | SimpleImputer | 저장된 전처리기 |
| scaler | StandardScaler | 저장된 전처리기 |
| bounds | dict \| None | {"sn_pct": (55.0, 70.0), "ag_pct": (0.0, 5.0), ...}. None 시 DEFAULT_BOUNDS 사용 |
| standard_ratios | dict \| None | 최적화 초기값. None 시 STANDARD_RATIOS(SN62/AG3/CU0.5/PB34.5) 사용 |

**출력**

```python
{
  "sn_pct": float, "ag_pct": float, "cu_pct": float, "pb_pct": float,
  "predicted_quality": float | None,
  "success": bool,
  "message": str
}
```

**처리 로직**:
1. scipy.optimize.minimize(method="SLSQP") 실행
2. objective function: `−model.predict(row)` (최대화를 위해 부호 반전)
3. 제약: `95 ≤ sn+ag+cu+pb ≤ 100`
4. 수렴 성공 시 pb_pct 재계산 (100 - 나머지 합)
5. 실패 시 STANDARD_RATIOS 반환, predicted_quality=None, success=False

**DEFAULT_BOUNDS**:

| 성분 | 하한 | 상한 |
|------|------|------|
| sn_pct | 55.0 | 70.0 |
| ag_pct | 0.0 | 5.0 |
| cu_pct | 0.0 | 2.0 |
| pb_pct | 0.0 | 45.0 |

---

#### `train(X, y, model_name, X_val, y_val)`

**위치**: `src/models/train.py`

**시그니처**:
```python
def train(
    X: pd.DataFrame,
    y: pd.Series,
    model_name: str = "random_forest",
    X_val=None,
    y_val=None,
) -> sklearn estimator
```

**처리 로직**:
- REGISTRY에서 모델 clone (원본 보존)
- model_name == "xgboost" and X_val 제공 시: early_stopping_rounds=20 적용
- 그 외: 단순 fit(X, y)

---

#### `cross_validate(X, y, model_name, cv)`

**위치**: `src/models/train.py`

**시그니처**:
```python
def cross_validate(
    X: pd.DataFrame,
    y: pd.Series,
    model_name: str = "random_forest",
    cv: int = 5,
) -> dict
```

**출력**:
```python
{
  "rmse_mean": float, "rmse_std": float,
  "r2_mean": float, "r2_std": float,
  "mape_mean": float, "mape_std": float
}
```

**평가 지표**: neg_root_mean_squared_error, r2, neg_mean_absolute_percentage_error

---

#### `save_model(model, name)` / `load_model(name)`

**위치**: `src/models/train.py`

**저장 경로**: `models/artifacts/{name}.joblib`

---

#### `regression_report(y_true, y_pred)`

**위치**: `src/evaluation/metrics.py`

**시그니처**:
```python
def regression_report(y_true, y_pred) -> dict
```

**출력**:
```python
{
  "MAE": float,   # sklearn mean_absolute_error
  "RMSE": float,  # sqrt(mean_squared_error)
  "R2": float,    # sklearn r2_score
  "MAPE": float   # 수동 계산, 0값 제외, 단위 %
}
```

**MAPE 계산식**:
```
MAPE = mean(|y_true - y_pred| / |y_true|) × 100  (y_true ≠ 0인 샘플만)
```

---

### 4.2 REGISTRY 모델 하이퍼파라미터

| 모델키 | 클래스 | 주요 파라미터 |
|--------|--------|---------------|
| ridge | Ridge | alpha=1.0 |
| random_forest | RandomForestRegressor | n_estimators=200, random_state=42, n_jobs=-1 |
| gradient_boosting | GradientBoostingRegressor | n_estimators=200, random_state=42 |
| xgboost | XGBRegressor | n_estimators=300, learning_rate=0.05, max_depth=5, subsample=0.8, colsample_bytree=0.8, random_state=42 |

---

### 4.3 ML 파이프라인 흐름

```
[데이터 준비]
  generate_sample.py → formulation_history.csv (300 LOT)
  또는 실생산 데이터 CSV

[학습 파이프라인]  scripts/train.py
  ① load_raw("formulation_history.csv")
  ② build_features(df, target_col, fit=True)
       → 파생 피처 생성 (sn/ag/cu_deviation)
       → 원-핫 인코딩 (supplier_id)
       → SimpleImputer(strategy="median") fit_transform
       → StandardScaler fit_transform
       → (X, y, imputer, scaler)
  ③ train/test split (80/20)
  ④ cross_validate(X_train, y_train, cv=5) → CV 지표
  ⑤ train(X_train, y_train, model_name)    → 최종 모델
  ⑥ regression_report(y_test, model.predict(X_test)) → 테스트 지표
  ⑦ save_model(model, name)                → models/artifacts/{name}.joblib
  ⑧ save_preprocessors(imputer, scaler, name) → preprocessors_{name}.joblib
  ⑨ {name}_meta.json 저장                  → name/metrics/feature_importances/trained_at

[추론 파이프라인]  POST /predict
  ① _load(model_name) → _cache 확인 → load_model + load_preprocessors
  ② build_features(df, fit=False, imputer, scaler)
  ③ feature_names_in_ 정렬 (피처 순서 보장)
  ④ model.predict(X) → predicted_quality

[최적화 파이프라인]  POST /recommend
  ① _load(model_name)
  ② recommend_ratios(process_conditions, model, imputer, scaler, bounds)
       → scipy.minimize(SLSQP)
       → objective: -model.predict(row)
       → constraints: 95 ≤ Σ ≤ 100
  ③ pb_pct 재계산 → 결과 반환
```

---

## 5. 오류 처리 설계

### 5.1 예외 유형별 처리

| 예외 유형 | 발생 위치 | 처리 방법 | HTTP 코드 |
|-----------|-----------|-----------|-----------|
| FileNotFoundError (모델 아티팩트) | `_load()`, `_get_model()` | HTTPException 변환, 학습 명령어 안내 | 404 |
| FileNotFoundError (CSV 데이터) | `/eda/stats` | 자동 샘플 생성 재시도 → 실패 시 503 | 503 |
| FileNotFoundError (이력 CSV) | `/doe/compare` | HTTPException 변환 | 404 |
| Pydantic ValidationError | 모든 POST 엔드포인트 | FastAPI 자동 처리 | 422 |
| ValueError (pb_pct 음수) | `_fill_pb_pct()` | HTTPException 변환, 행 번호 포함 | 422 |
| HTTPException (알 수 없는 모델) | `_get_model()` | 그대로 전파 | 400 |
| numpy.linalg.LinAlgError | `/doe/analyze` | 계수 0으로 처리 후 정상 응답 | — |
| 최적화 실패 (result.success=False) | `recommend_ratios()` | 표준 배합비율 fallback 반환, success=False | 200 |

### 5.2 오류 코드 정의

| 오류코드 | 설명 | 조치 |
|----------|------|------|
| E-001 | 모델 아티팩트 없음 | `python scripts/train.py --model {name}` 실행 |
| E-002 | 데이터 파일 없음 | `python data/raw/generate_sample.py` 실행 |
| E-003 | 성분 합계 100% 초과 | sn+ag+cu 범위 조정 필요 |
| E-004 | SLSQP 최적화 미수렴 | bounds 범위 확대 또는 lhs_best 방법으로 변경 |
| E-005 | 피처 불일치 | 모델 재학습 필요 (feature_names_in_ 불일치) |

---

## 6. 성능 설계

### 6.1 모델 캐싱 (_cache dict)

**캐시 구조**:
```python
_cache: dict = {
    "xgboost": {
        "model":   XGBRegressor (학습 완료),
        "imputer": SimpleImputer,
        "scaler":  StandardScaler,
    },
    "gradient_boosting": { ... },
}
```

**캐시 정책**:
- 서버 시작(`lifespan`) 시 xgboost → gradient_boosting → random_forest 순서로 사전 로드 시도
- 아티팩트 없는 모델은 skip (오류 없이 무시)
- 첫 요청 시 lazy load: `_load(model_name)` 호출 시 캐시 미존재 확인 후 로드
- DOE 엔드포인트는 독립 캐시 `_doe_cache` 사용 (키 충돌 없음)
- 캐시 무효화: 서버 재시작 필요 (런타임 무효화 미지원)

**캐시 효과**:
- XGBoost 모델 로드 시간: ~200ms → 두 번째 요청부터 0ms
- 전처리기 로드: ~10ms → 캐시 후 0ms

### 6.2 응답 시간 최적화

| 엔드포인트 | 예상 응답 시간 | 최적화 방법 |
|------------|----------------|-------------|
| GET / | < 1ms | 캐시 딕셔너리 조회만 |
| GET /models | < 50ms | JSON 파일 읽기 (메타데이터) |
| POST /predict | < 50ms (캐시 후) | 모델 캐싱, 단일 행 추론 |
| POST /recommend | 100~500ms | SLSQP maxiter=500, ftol=1e-6 |
| POST /doe/simulate | N × 10ms | 배치 루프 (병렬화 미적용) |
| POST /doe/analyze | < 100ms | numpy lstsq (sklearn 미사용) |
| POST /doe/optimize (slsqp) | 100~500ms | SLSQP 재사용 |
| POST /doe/optimize (lhs_best) | N × 10ms | n_candidates 조정으로 제어 |

### 6.3 메모리 고려사항

- XGBoost 모델 메모리: ~5MB (n_estimators=300)
- 전처리기 메모리: < 1MB
- EDA 데이터 로드: 300 LOT × 11컬럼 ≈ 0.1MB (매 요청 로드)
- DOE 설계 행렬: 최대 500행 × 5컬럼 ≈ 무시할 수준

---

*문서 끝 — SF-TD4 프로그램설계서 V1.0*
