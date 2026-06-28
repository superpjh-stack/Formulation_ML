# SF-TD4 프로그램설계서

| 항목 | 내용 |
|------|------|
| 문서번호 | SF-TD4 |
| 문서명 | 프로그램설계서 |
| 사업명 | 성분분석 데이터 기반 배합비율 최적화 ML 시스템 구축 |
| 도입기업 | (주)고려솔더 |
| 작성자 | 이성민 |
| 검토자 | 오태양, 장다운 |
| 승인자 | 김현수 |
| 작성일 | 2026-04-28 |
| 버전 | v1.0 |

---

## 1. 프로그램 구조

### 1.1 프론트엔드 디렉토리

```
frontend/
├── app/
│   ├── page.tsx                    # 루트 → /dashboard/production 리다이렉트
│   ├── (dashboard)/
│   │   ├── layout.tsx              # DashboardGroupLayout (AppLayout 래퍼)
│   │   ├── dashboard/
│   │   │   ├── production/page.tsx # 생산 현황 대시보드
│   │   │   ├── quality/page.tsx    # 품질 현황 대시보드
│   │   │   ├── equipment/page.tsx  # 설비 현황 대시보드
│   │   │   └── shipping/page.tsx   # 출하 현황 대시보드
│   │   ├── receiving/
│   │   │   ├── page.tsx            # 입고 현황
│   │   │   ├── history/page.tsx    # 입고 이력
│   │   │   ├── data/page.tsx       # 성분 데이터
│   │   │   ├── supplier/page.tsx   # 공급사 관리
│   │   │   └── agent/page.tsx      # 입고 AI Agent
│   │   ├── mixing/
│   │   │   ├── collect/page.tsx    # 학습 데이터 수집
│   │   │   ├── deviation/page.tsx  # 성분 편차 분석
│   │   │   ├── predict/page.tsx    # 품질 예측
│   │   │   ├── optimize/page.tsx   # 배합 최적화
│   │   │   └── agent/page.tsx      # 배합 AI Agent
│   │   ├── shipping/               # 포장출하관리 (5개)
│   │   ├── process/                # 공정관리 (5개)
│   │   ├── system/                 # 시스템관리 (4개)
│   │   ├── master/                 # 기준정보관리 (3개)
│   │   ├── data/                   # 데이터관리 (5개)
│   │   ├── agent/                  # AI Agent 관리 (5개)
│   │   └── kpi/                    # KPI 관리 (3개)
├── components/
│   ├── layout/
│   │   ├── AppLayout.tsx           # export function AppLayout
│   │   └── Sidebar.tsx             # export function Sidebar
│   └── charts/
│       └── MiniSparkline.tsx       # SVG 스파크라인
├── lib/
│   ├── api.ts                      # ML API 함수
│   ├── mock-data.ts                # 개발용 목 데이터
│   └── koryo-api.ts                # API 래퍼
├── hooks/
│   └── useKoryoData.ts             # React 커스텀 훅
└── types/                          # TypeScript 타입 정의
```

### 1.2 백엔드(ML) 디렉토리

```
src/
├── data/
│   └── loader.py                   # load_raw() / load_processed() / save_processed()
├── features/
│   └── engineering.py              # build_features() / save_preprocessors() / load_preprocessors()
├── models/
│   ├── train.py                    # REGISTRY / train() / cross_validate() / save_model()
│   └── optimize.py                 # recommend_ratios() — scipy SLSQP
└── evaluation/
    └── metrics.py                  # regression_report() → {MAE, RMSE, R², MAPE}

scripts/
├── train.py                        # 학습 CLI
├── predict.py                      # 배치 추론 CLI
└── recommend.py                    # 단건 추천 CLI
```

---

## 2. API 설계

### 2.1 ML 예측 API

**엔드포인트**: `POST /api/v1/predict`

**요청 흐름**:
```
[프론트엔드]
  fetchPrediction({sn, ag, cu, pb, model})
       │ HTTP POST
       ▼
[FastAPI /api/v1/predict]
  ① 입력값 검증 (Pydantic)
     - sn+ag+cu+pb ≈ 100 검증
  ② 전처리기 로드
     - load_preprocessors(model_name)
     - imputer + scaler
  ③ Feature Engineering
     - sn_deviation = sn - 62.0
     - ag_deviation = ag - 3.0
     - cu_deviation = cu - 0.5
  ④ 모델 로드 & 추론
     - model = load_model(model_name)
     - score = model.predict(X)[0]
  ⑤ 응답 반환
     - {"quality_score": 86.4, "model": "gradient_boosting"}
       │ HTTP 200
       ▼
[프론트엔드]
  결과 카드 업데이트
```

**Request Body**:
```json
{
  "sn": 62.0,
  "ag": 3.0,
  "cu": 0.5,
  "pb": 34.5,
  "temperature": 250,
  "time": 45,
  "model": "gradient_boosting"
}
```

**Response**:
```json
{
  "quality_score": 86.4,
  "model": "gradient_boosting",
  "rmse": 3.05,
  "r2": 0.627
}
```

---

### 2.2 배합 최적화 API

**엔드포인트**: `POST /api/v1/recommend`

**요청 흐름**:
```
[프론트엔드]
  fetchRecommendation({temperature, time, supplier, model})
       │ HTTP POST
       ▼
[FastAPI /api/v1/recommend]
  ① 공급사 성분 편차 로드
     - DB에서 최근 30일 공급사 성분 이력 조회
     - 평균 편차 계산
  ② scipy SLSQP 최적화 실행
     recommend_ratios(model, temperature, time, supplier)
     - 목적함수: -predict(x)
     - 제약: x[0]+x[1]+x[2]+x[3] = 100
     - 경계: Sn(55~70), Ag(1~5), Cu(0.1~1.5), Pb(25~45)
  ③ 최적 배합비율 반환
     - {"sn": 62.3, "ag": 3.0, "cu": 0.5, "pb": 34.2, "quality_score": 89.2}
       │ HTTP 200
       ▼
[프론트엔드]
  최적화 결과 카드 업데이트
```

**Request Body**:
```json
{
  "temperature": 250,
  "time": 45,
  "supplier": "SUP_A",
  "model": "gradient_boosting"
}
```

**Response**:
```json
{
  "sn": 62.3,
  "ag": 3.0,
  "cu": 0.5,
  "pb": 34.2,
  "quality_score": 89.2,
  "optimization_success": true,
  "iterations": 24
}
```

---

### 2.3 모델 목록 API

**엔드포인트**: `GET /api/v1/models`

**응답**:
```json
{
  "models": [
    {"id": "gradient_boosting", "name": "Gradient Boosting", "rmse": 3.05, "r2": 0.627},
    {"id": "random_forest", "name": "Random Forest", "rmse": 3.21, "r2": 0.588},
    {"id": "xgboost", "name": "XGBoost", "rmse": 3.38, "r2": 0.551},
    {"id": "ridge", "name": "Ridge", "rmse": 4.82, "r2": 0.421}
  ]
}
```

---

### 2.4 EDA 통계 API

**엔드포인트**: `GET /api/v1/eda-stats`

**응답**:
```json
{
  "component_stats": {
    "sn": {"mean": 62.1, "std": 0.9, "min": 60.2, "max": 64.5},
    "ag": {"mean": 3.01, "std": 0.18, "min": 2.6, "max": 3.5},
    "cu": {"mean": 0.502, "std": 0.05, "min": 0.41, "max": 0.62}
  },
  "quality_stats": {
    "mean": 84.3, "std": 8.2, "min": 60.2, "max": 92.1
  },
  "correlation": {
    "sn_quality": 0.41,
    "ag_quality": 0.28,
    "cu_quality": 0.15
  }
}
```

---

## 3. 핵심 함수 설계

### 3.1 Feature Engineering

**파일**: `src/features/engineering.py`

| 함수명 | 입력 | 출력 | 설명 |
|--------|------|------|------|
| `build_features(df, target, imputer, scaler, fit)` | DataFrame, str, imputer, scaler, bool | (X, y, imputer, scaler) | 피처 생성 및 전처리 |
| `save_preprocessors(imputer, scaler, name)` | imputer, scaler, str | None | 전처리기 joblib 저장 |
| `load_preprocessors(name)` | str | (imputer, scaler) | 전처리기 로드 |

**피처 목록**:
```python
SN_TARGET = 62.0
AG_TARGET = 3.0
CU_TARGET = 0.5

파생 피처:
- sn_deviation = sn - SN_TARGET
- ag_deviation = ag - AG_TARGET
- cu_deviation = cu - CU_TARGET

원본 피처:
- sn, ag, cu, pb (성분 비율)
- temperature (용해 온도)
- time (처리 시간)
- supplier_encoded (공급사 레이블 인코딩)
```

---

### 3.2 모델 학습 및 저장

**파일**: `src/models/train.py`

| 함수명 | 입력 | 출력 | 설명 |
|--------|------|------|------|
| `train(X, y, model_name)` | array, array, str | model | 모델 학습 |
| `cross_validate(X, y, model_name)` | array, array, str | dict | 5-Fold CV 평가 |
| `save_model(model, name)` | model, str | None | models/artifacts/ 저장 |
| `load_model(name)` | str | model | 모델 로드 |
| `get_feature_importance(model)` | model | dict | 피처 중요도 반환 |

**모델 레지스트리**:
```python
REGISTRY = {
    "ridge": Ridge(alpha=1.0),
    "random_forest": RandomForestRegressor(n_estimators=200, random_state=42),
    "gradient_boosting": GradientBoostingRegressor(n_estimators=200, random_state=42),
    "xgboost": XGBRegressor(n_estimators=200, random_state=42)
}
```

---

### 3.3 배합 최적화

**파일**: `src/models/optimize.py`

| 함수명 | 입력 | 출력 | 설명 |
|--------|------|------|------|
| `recommend_ratios(model, temperature, time, supplier)` | model, float, int, str | dict | SLSQP 최적 배합비 추천 |

**최적화 설정**:
```python
# 초기값
x0 = [62.0, 3.0, 0.5, 34.5]

# 경계
bounds = [(55, 70), (1, 5), (0.1, 1.5), (25, 45)]

# 제약 조건 (합계 = 100)
constraints = [{'type': 'eq', 'fun': lambda x: sum(x) - 100.0}]

# 목적 함수 (품질 최대화)
def objective(x):
    features = build_prediction_input(x, temperature, time, supplier)
    return -model.predict(features)[0]
```

---

## 4. 데이터 흐름

### 4.1 품질 예측 데이터 흐름

```
사용자 입력 (Sn/Ag/Cu/Pb %)
     │
     ▼ (프론트엔드 lib/api.ts)
fetchPrediction() → POST /api/v1/predict
     │
     ▼ (백엔드 FastAPI)
1. 입력 검증
2. 전처리: imputer → scaler
3. 피처 생성: deviation 계산
4. 모델 추론: model.predict()
5. 결과 반환
     │
     ▼ (프론트엔드)
품질 점수 카드 렌더링
```

### 4.2 배합 최적화 데이터 흐름

```
공정 조건 입력 (온도/시간/공급사)
     │
     ▼ (프론트엔드 lib/api.ts)
fetchRecommendation() → POST /api/v1/recommend
     │
     ▼ (백엔드 FastAPI)
1. 공급사 성분 편차 조회
2. scipy SLSQP 최적화 실행
3. 목적함수: -predict(x)
4. 최적 배합비율 계산
5. 최적 배합의 예상 품질 점수
6. 결과 반환
     │
     ▼ (프론트엔드)
최적 배합비율 카드 렌더링
```

---

## 5. 오류 처리

| 오류 유형 | HTTP 코드 | 처리 방식 |
|-----------|-----------|-----------|
| 성분 합계 ≠ 100% | 422 | Validation error 반환 |
| 모델 파일 없음 | 404 | "모델을 찾을 수 없습니다" 메시지 |
| 최적화 수렴 실패 | 200 | optimization_success: false 반환 |
| DB 연결 실패 | 503 | "서비스 일시 중단" 메시지 |
| 인증 실패 | 401 | "로그인이 필요합니다" 메시지 |
| 권한 없음 | 403 | "접근 권한이 없습니다" 메시지 |
