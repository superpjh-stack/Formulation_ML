# SF-TD5 데이터베이스설계서

**문서번호**: SF-TD5 | **버전**: V1.0 | **작성일**: 2026-06-19 | **작성자**: 개발팀  
**프로젝트명**: 성분분석 데이터 기반 배합비율 최적화 ML 시스템 (Formulation ML)  
**적용 범위**: 파일 기반 데이터 저장소 현행 설계 및 향후 RDB 전환 계획

---

## 1. 문서 개요

### 1.1 목적

본 문서는 Formulation ML 시스템의 데이터 저장소 구조를 정의한다. 현행 파일 기반(CSV + Joblib) 저장소의 스키마를 상세히 기술하고, 확장성 확보를 위한 관계형 데이터베이스(RDB) 전환 설계안을 제시한다.

### 1.2 현행 저장소 개요

본 시스템은 데이터베이스 서버 없이 파일 시스템만으로 동작한다. 학습 데이터는 CSV 파일로, 학습된 모델과 전처리기는 Joblib 바이너리로, 모델 성능 메타데이터는 JSON으로 저장된다.

| 저장소 유형 | 기술 | 주 용도 |
|------------|------|---------|
| CSV 파일 | pandas CSV | 배합 이력 데이터 (학습/평가) |
| Joblib 바이너리 | joblib | ML 모델 + 전처리기 직렬화 |
| JSON 파일 | json | 모델 성능 메타데이터 |

### 1.3 데이터 흐름

```
[원시 데이터]
  data/raw/formulation_history.csv (300 LOT)
        ↓
[피처 엔지니어링]
  src/features/engineering.py → build_features()
        ↓
[모델 학습]
  scripts/train.py
        ↓ 저장
  models/artifacts/{name}.joblib          ← 학습된 모델
  models/artifacts/preprocessors_{name}.joblib ← 전처리기 (imputer + scaler)
  models/artifacts/{name}_meta.json       ← 성능 지표 + 피처 중요도
        ↓
[추론]
  POST /predict, POST /recommend → 결과 반환 (파일 저장 없음)
  scripts/predict.py              → data/processed/{output}.csv 저장
```

---

## 2. 데이터 저장소 설계

### 2.1 현행 파일 기반 저장소

| 파일명 | 경로 | 형식 | 내용 | 크기(예상) |
|--------|------|------|------|-----------|
| formulation_history.csv | `data/raw/` | CSV (UTF-8) | 배합 공정 이력 300 LOT (학습 데이터) | ~50KB |
| {name}.joblib | `models/artifacts/` | Joblib 바이너리 | 학습된 ML 모델 객체 | 1~10MB (모델별) |
| preprocessors_{name}.joblib | `models/artifacts/` | Joblib 바이너리 | imputer + scaler 딕셔너리 | ~10KB |
| {name}_meta.json | `models/artifacts/` | JSON (UTF-8) | 모델명·성능지표·피처중요도·학습일시 | ~5KB |
| {output}.csv | `data/processed/` | CSV (UTF-8) | 배치 추론 결과 (scripts/predict.py 출력) | 가변 |

**{name} 치환값**: `ridge`, `random_forest`, `gradient_boosting`, `xgboost`

### 2.2 파일 존재 여부와 시스템 동작

| 파일 | 없을 경우 동작 |
|------|---------------|
| formulation_history.csv | `/eda/stats` — generate_sample.py 자동 실행 후 재시도; `/doe/compare` — 404 반환 |
| {name}.joblib | API 요청 시 404 반환, 학습 명령어 안내 |
| preprocessors_{name}.joblib | API 요청 시 FileNotFoundError → 404 반환 |
| {name}_meta.json | `/models` — 빈 metrics(0.0) 반환, 기능 저하 없음 |

---

## 3. 데이터 스키마 설계

### 3.1 formulation_history.csv — 핵심 학습 데이터

**용도**: ML 모델 학습 및 교차검증의 유일한 학습 데이터 소스  
**행 수**: 300 LOT (샘플 데이터 기준), 실데이터 도입 시 확장 가능  
**인코딩**: UTF-8, 헤더 포함, 구분자: 쉼표(,)

| # | 컬럼명 | 타입 | 제약 | 설명 | 예시 |
|---|--------|------|------|------|------|
| 1 | lot_id | string | NOT NULL, 고유값 | LOT 식별자 | LOT_001 |
| 2 | sn_pct | float | NOT NULL, 0 < x < 100 | 주석(Sn) 함량 비율 (%) | 62.31 |
| 3 | ag_pct | float | NOT NULL, 0 ≤ x < 100 | 은(Ag) 함량 비율 (%) | 3.05 |
| 4 | cu_pct | float | NOT NULL, 0 ≤ x < 100 | 구리(Cu) 함량 비율 (%) | 0.48 |
| 5 | pb_pct | float | NOT NULL, 0 ≤ x < 100 | 납(Pb) 함량 비율 (%) | 34.02 |
| 6 | other_pct | float | NOT NULL, ≥ 0 | 기타 성분 비율 (%) | 0.14 |
| 7 | melt_temp_c | float | NOT NULL, 200 ≤ x ≤ 320 | 용해 온도 (°C) | 252.0 |
| 8 | melt_time_min | float | NOT NULL, 10 ≤ x ≤ 120 | 가열 시간 (분) | 44.5 |
| 9 | supplier_id | string | NOT NULL, SUP_A \| SUP_B \| SUP_C | 공급사 코드 | SUP_A |
| 10 | quality_score | float | NOT NULL, 50 ≤ x ≤ 100 | 품질 점수 (예측 대상) | 85.31 |
| 11 | is_defect | int | NOT NULL, 0 또는 1 | 불량 여부 (quality_score < 75 → 1) | 0 |

**파생 피처** (CSV에는 없고, `build_features()` 런타임 생성):

| 파생 컬럼명 | 계산식 | 설명 |
|-------------|--------|------|
| sn_deviation | sn_pct − 62.0 | SN 목표값(62%) 대비 편차 |
| ag_deviation | ag_pct − 3.0 | AG 목표값(3%) 대비 편차 |
| cu_deviation | cu_pct − 0.5 | CU 목표값(0.5%) 대비 편차 |

**성분 합계 제약**:
```
sn_pct + ag_pct + cu_pct + pb_pct + other_pct ≈ 100.0%
(허용 오차: ±0.5% — 측정 오차 범위)
```

**공급사별 성분 편차 특성 (샘플 데이터 기준)**:

| 공급사 | 점유율 | SN 편차 경향 | 노이즈 배율 |
|--------|--------|-------------|------------|
| SUP_A | 50% | +0.2% | 0.8 |
| SUP_B | 30% | 기준 (0) | 1.0 |
| SUP_C | 20% | -0.5% | 1.2 |

**CSV 샘플 (최초 3행)**:
```
lot_id,sn_pct,ag_pct,cu_pct,pb_pct,other_pct,melt_temp_c,melt_time_min,supplier_id,quality_score,is_defect
LOT_001,62.31,3.05,0.48,34.02,0.14,252.0,44.5,SUP_A,85.31,0
LOT_002,61.89,2.98,0.51,34.48,0.14,248.0,46.0,SUP_B,82.14,0
LOT_003,57.23,2.71,0.41,39.51,0.14,255.0,43.0,SUP_C,71.05,1
```

---

### 3.2 모델 아티팩트 파일

#### 3.2.1 {name}.joblib — 학습된 ML 모델

| 항목 | 내용 |
|------|------|
| 파일명 패턴 | `{name}.joblib` |
| 경로 | `models/artifacts/` |
| 직렬화 라이브러리 | joblib 1.x |
| 내용 | sklearn/XGBoost 모델 객체 전체 (가중치 포함) |
| 생성 시점 | `scripts/train.py` 실행 완료 시 |
| 로드 함수 | `src/models/train.load_model(name)` |
| 저장 함수 | `src/models/train.save_model(model, name)` |

**파일명별 모델 클래스**:

| 파일명 | 모델 클래스 | 파일 크기(예상) |
|--------|------------|----------------|
| ridge.joblib | sklearn Ridge | ~10KB |
| random_forest.joblib | sklearn RandomForestRegressor | ~5MB |
| gradient_boosting.joblib | sklearn GradientBoostingRegressor | ~2MB |
| xgboost.joblib | xgboost XGBRegressor | ~1MB |

#### 3.2.2 preprocessors_{name}.joblib — 전처리기

| 항목 | 내용 |
|------|------|
| 파일명 패턴 | `preprocessors_{name}.joblib` |
| 경로 | `models/artifacts/` |
| 직렬화 형식 | Python dict: `{"imputer": SimpleImputer, "scaler": StandardScaler}` |
| 생성 시점 | `scripts/train.py` 실행 완료 시 (`save_preprocessors()`) |
| 로드 함수 | `src/features/engineering.load_preprocessors(name)` |

**내부 구조**:
```python
{
    "imputer": SimpleImputer(strategy="median"),  # 학습 데이터 중앙값 저장
    "scaler": StandardScaler(),                   # 학습 데이터 mean/std 저장
}
```

**쌍 저장 원칙**: `{name}.joblib`과 `preprocessors_{name}.joblib`은 항상 동일한 학습 데이터로 생성된 쌍으로 관리되어야 함. 불일치 시 추론 오류 발생.

---

### 3.3 {name}_meta.json — 모델 성능 메타데이터

**용도**: `/models` API 응답 소스, 프론트엔드 모델 현황 대시보드  
**인코딩**: UTF-8  
**경로**: `models/artifacts/{name}_meta.json`

**JSON 스키마 전체 정의**:

```json
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
    {"feature": "melt_temp_c",  "importance": 0.198},
    {"feature": "sn_pct",       "importance": 0.154},
    {"feature": "ag_deviation", "importance": 0.121},
    {"feature": "melt_time_min","importance": 0.089}
  ],
  "trained_at": "2026-06-19T10:30:00"
}
```

**필드 상세**:

| 필드명 | 타입 | 필수 | 설명 |
|--------|------|------|------|
| name | string | 필수 | 모델 식별자 (REGISTRY 키와 동일) |
| metrics | object | 필수 | 테스트셋 성능 지표 |
| metrics.mae | float | 필수 | Mean Absolute Error |
| metrics.rmse | float | 필수 | Root Mean Squared Error |
| metrics.r2 | float | 필수 | 결정계수 (R², 0~1) |
| metrics.mape | float | 필수 | Mean Absolute Percentage Error (%, 0값 제외) |
| feature_importances | array | 필수 | 피처 중요도 목록 (상위 10개, 내림차순) |
| feature_importances[].feature | string | 필수 | 피처명 |
| feature_importances[].importance | float | 필수 | 중요도 (합계 ≈ 1.0 또는 Ridge coef 절대값) |
| trained_at | string \| null | 필수 | 학습 완료 시각 (ISO 8601 형식) |

**모델별 성능 기준 (샘플 데이터)**:

| 모델 | MAE | RMSE | R² | MAPE |
|------|-----|------|----|------|
| Ridge | 3.51 | 4.12 | 0.421 | 4.12% |
| RandomForest | 2.51 | 3.21 | 0.588 | 3.03% |
| GradientBoosting | 2.31 | 3.05 | 0.627 | 2.78% |
| XGBoost | 2.20 | 2.98 | 0.641 | 2.65% |

> R² < 0.85는 샘플 데이터 노이즈(σ=3) 때문. 실데이터 교체 시 재측정 필요.

---

### 3.4 data/processed/{output}.csv — 배치 추론 결과

**생성 방법**: `python scripts/predict.py --output predictions.csv`  
**용도**: 외부 시스템 연동, 품질 모니터링

**스키마**: 원본 입력 데이터 컬럼 전체 + 하단 컬럼 추가

| 추가 컬럼명 | 타입 | 설명 |
|-------------|------|------|
| predicted_quality | float | ML 모델 예측 품질 점수 |

---

## 4. 향후 RDB 전환 설계 (권장)

### 4.1 전환 필요성

| 현행 문제점 | 해결 방안 |
|------------|-----------|
| CSV 파일 동시 접근 충돌 위험 | RDB 트랜잭션 보장 |
| 예측 이력 미저장 (감사 불가) | PREDICTION_LOG 테이블 도입 |
| 모델 버전 관리 부재 | MODEL_ARTIFACT 테이블 버전 관리 |
| 공급사 정보 하드코딩 | SUPPLIER 테이블 외부화 |
| 대용량 데이터 조회 성능 | 인덱스 기반 빠른 조회 |

**권장 DBMS**: PostgreSQL 15+ (또는 MySQL 8.0+)

### 4.2 ERD (Entity-Relationship Diagram)

```mermaid
erDiagram
    LOT {
        VARCHAR(20)  lot_id       PK  "LOT 식별자"
        FLOAT        sn_pct           "SN 함량 (%)"
        FLOAT        ag_pct           "AG 함량 (%)"
        FLOAT        cu_pct           "CU 함량 (%)"
        FLOAT        pb_pct           "PB 함량 (%)"
        FLOAT        other_pct        "기타 함량 (%)"
        FLOAT        melt_temp_c      "용해 온도 (°C)"
        FLOAT        melt_time_min    "가열 시간 (분)"
        FLOAT        quality_score    "품질 점수"
        SMALLINT     is_defect        "불량 여부 (0/1)"
        TIMESTAMP    created_at       "데이터 등록 일시"
        VARCHAR(10)  supplier_id  FK  "공급사 코드"
    }

    SUPPLIER {
        VARCHAR(10)  supplier_id  PK  "공급사 코드 (SUP_A/B/C)"
        VARCHAR(100) supplier_name    "공급사명"
        FLOAT        sn_effect        "SN 편차 효과"
        FLOAT        ag_effect        "AG 편차 효과"
        FLOAT        cu_effect        "CU 편차 효과"
        FLOAT        noise_mult       "노이즈 배율"
        TIMESTAMP    updated_at       "최종 갱신 일시"
    }

    MODEL_ARTIFACT {
        SERIAL       model_id     PK  "모델 고유 ID"
        VARCHAR(50)  model_name       "모델 식별자"
        VARCHAR(20)  version          "버전 (v1.0, v1.1 ...)"
        FLOAT        rmse             "RMSE"
        FLOAT        r2               "R²"
        FLOAT        mape             "MAPE (%)"
        FLOAT        mae              "MAE"
        VARCHAR(200) artifact_path    "Joblib 파일 경로"
        BOOLEAN      is_active        "현재 활성 모델 여부"
        TIMESTAMP    trained_at       "학습 완료 일시"
    }

    PREDICTION_LOG {
        BIGSERIAL    pred_id      PK  "예측 고유 ID"
        INTEGER      model_id     FK  "사용 모델 ID"
        VARCHAR(20)  lot_ref          "참조 LOT ID (nullable)"
        FLOAT        predicted_quality "예측 품질 점수"
        FLOAT        actual_quality   "실측 품질 점수 (nullable)"
        JSONB        input_features   "입력 피처 원본 JSON"
        TIMESTAMP    created_at       "예측 실행 일시"
    }

    DOE_EXPERIMENT {
        SERIAL       exp_id       PK  "실험 고유 ID"
        VARCHAR(30)  method           "DOE 방법"
        INTEGER      n_experiments    "실험 수"
        JSONB        factor_ranges    "인자 범위 JSON"
        JSONB        design_matrix    "설계 행렬 JSON"
        JSONB        simulation_result "시뮬레이션 결과 JSON"
        JSONB        analysis_result  "분석 결과 JSON"
        TIMESTAMP    created_at       "실험 생성 일시"
        VARCHAR(100) created_by       "생성자 (사용자/시스템)"
    }

    LOT         }|--||  SUPPLIER          : "belongs_to"
    PREDICTION_LOG }|--||  MODEL_ARTIFACT : "uses"
    PREDICTION_LOG }o--o{  LOT            : "references"
```

### 4.3 테이블 정의서

---

#### 테이블: LOT

**설명**: 배합 공정 이력 데이터. 현행 formulation_history.csv 대응.

| 컬럼명 | 데이터 타입 | PK | FK | NOT NULL | 기본값 | 설명 |
|--------|------------|----|----|----------|--------|------|
| lot_id | VARCHAR(20) | PK | | YES | | LOT 식별자 (예: LOT_001) |
| sn_pct | FLOAT | | | YES | | 주석(Sn) 함량 비율 (%) |
| ag_pct | FLOAT | | | YES | | 은(Ag) 함량 비율 (%) |
| cu_pct | FLOAT | | | YES | | 구리(Cu) 함량 비율 (%) |
| pb_pct | FLOAT | | | YES | | 납(Pb) 함량 비율 (%) |
| other_pct | FLOAT | | | YES | 0.0 | 기타 성분 비율 (%) |
| melt_temp_c | FLOAT | | | YES | | 용해 온도 (°C, 200~320) |
| melt_time_min | FLOAT | | | YES | | 가열 시간 (분, 10~120) |
| quality_score | FLOAT | | | YES | | 품질 점수 (50~100) |
| is_defect | SMALLINT | | | YES | 0 | 불량 여부 (0=양품, 1=불량) |
| created_at | TIMESTAMP | | | YES | NOW() | 데이터 등록 일시 |
| supplier_id | VARCHAR(10) | | FK | YES | | 공급사 코드 → SUPPLIER.supplier_id |

**인덱스**:
```sql
CREATE INDEX idx_lot_supplier ON LOT(supplier_id);
CREATE INDEX idx_lot_created ON LOT(created_at DESC);
CREATE INDEX idx_lot_quality ON LOT(quality_score);
```

**체크 제약**:
```sql
CONSTRAINT chk_quality CHECK (quality_score BETWEEN 50 AND 100),
CONSTRAINT chk_temp CHECK (melt_temp_c BETWEEN 200 AND 320),
CONSTRAINT chk_is_defect CHECK (is_defect IN (0, 1))
```

---

#### 테이블: SUPPLIER

**설명**: 공급사 정보 및 성분 편차 효과. 현행 `sample_generator.py` SUPPLIER_EFFECTS 상수 대응.

| 컬럼명 | 데이터 타입 | PK | FK | NOT NULL | 기본값 | 설명 |
|--------|------------|----|----|----------|--------|------|
| supplier_id | VARCHAR(10) | PK | | YES | | 공급사 코드 (SUP_A, SUP_B, SUP_C) |
| supplier_name | VARCHAR(100) | | | YES | | 공급사명 |
| sn_effect | FLOAT | | | YES | 0.0 | SN 성분 편차 효과 (%, 기준: SUP_B=0) |
| ag_effect | FLOAT | | | YES | 0.0 | AG 성분 편차 효과 (%) |
| cu_effect | FLOAT | | | YES | 0.0 | CU 성분 편차 효과 (%) |
| noise_mult | FLOAT | | | YES | 1.0 | 노이즈 배율 (SUP_B 기준 상대값) |
| updated_at | TIMESTAMP | | | YES | NOW() | 최종 갱신 일시 |

**초기 데이터 (현행 SUPPLIER_EFFECTS 기준)**:
```sql
INSERT INTO SUPPLIER VALUES
  ('SUP_A', '공급사 A', 0.2,  0.0,  0.0,  0.8, NOW()),
  ('SUP_B', '공급사 B', 0.0,  0.0,  0.0,  1.0, NOW()),
  ('SUP_C', '공급사 C', -0.5, 0.1, -0.05, 1.2, NOW());
```

---

#### 테이블: MODEL_ARTIFACT

**설명**: 학습된 ML 모델 버전 관리. 현행 {name}.joblib + {name}_meta.json 대응.

| 컬럼명 | 데이터 타입 | PK | FK | NOT NULL | 기본값 | 설명 |
|--------|------------|----|----|----------|--------|------|
| model_id | SERIAL | PK | | YES | AUTO | 모델 고유 ID |
| model_name | VARCHAR(50) | | | YES | | 모델 식별자 (ridge, random_forest 등) |
| version | VARCHAR(20) | | | YES | 'v1.0' | 버전 문자열 |
| rmse | FLOAT | | | NO | null | RMSE (테스트셋) |
| r2 | FLOAT | | | NO | null | R² (테스트셋) |
| mape | FLOAT | | | NO | null | MAPE % (테스트셋) |
| mae | FLOAT | | | NO | null | MAE (테스트셋) |
| artifact_path | VARCHAR(200) | | | YES | | Joblib 파일 절대 경로 |
| is_active | BOOLEAN | | | YES | false | 현재 활성 모델 여부 |
| trained_at | TIMESTAMP | | | YES | NOW() | 학습 완료 일시 |

**인덱스**:
```sql
CREATE INDEX idx_model_name ON MODEL_ARTIFACT(model_name);
CREATE INDEX idx_model_active ON MODEL_ARTIFACT(is_active) WHERE is_active = true;
```

**제약**: 동일 model_name에서 is_active=true 는 최대 1개
```sql
CREATE UNIQUE INDEX idx_one_active_per_model
  ON MODEL_ARTIFACT(model_name) WHERE is_active = true;
```

---

#### 테이블: PREDICTION_LOG

**설명**: API 예측 요청 이력 저장. 감사(Audit) 및 품질 모니터링 목적.

| 컬럼명 | 데이터 타입 | PK | FK | NOT NULL | 기본값 | 설명 |
|--------|------------|----|----|----------|--------|------|
| pred_id | BIGSERIAL | PK | | YES | AUTO | 예측 고유 ID |
| model_id | INTEGER | | FK | YES | | 사용 모델 ID → MODEL_ARTIFACT.model_id |
| lot_ref | VARCHAR(20) | | | NO | null | 참조 LOT ID (nullable, 추천 API는 null) |
| predicted_quality | FLOAT | | | YES | | 예측 품질 점수 |
| actual_quality | FLOAT | | | NO | null | 실측 품질 점수 (사후 업데이트) |
| input_features | JSONB | | | YES | | 입력 피처 원본 JSON 저장 |
| created_at | TIMESTAMP | | | YES | NOW() | 예측 실행 일시 |

**input_features JSONB 예시**:
```json
{
  "sn_ratio": 62.0, "ag_ratio": 3.0, "cu_ratio": 0.5, "pb_ratio": 34.5,
  "temperature": 250.0, "process_time": 45.0, "supplier": "SUP_A"
}
```

**인덱스**:
```sql
CREATE INDEX idx_pred_model ON PREDICTION_LOG(model_id);
CREATE INDEX idx_pred_created ON PREDICTION_LOG(created_at DESC);
CREATE INDEX idx_pred_lot ON PREDICTION_LOG(lot_ref) WHERE lot_ref IS NOT NULL;
```

**활용 쿼리 예시 (예측 오차 모니터링)**:
```sql
SELECT
    model_id,
    AVG(ABS(predicted_quality - actual_quality)) AS mae,
    COUNT(*) AS n
FROM PREDICTION_LOG
WHERE actual_quality IS NOT NULL
  AND created_at > NOW() - INTERVAL '30 days'
GROUP BY model_id;
```

---

#### 테이블: DOE_EXPERIMENT

**설명**: DOE 시뮬레이터 실험 이력 저장. 설계 행렬·시뮬레이션 결과·분석 결과 보존.

| 컬럼명 | 데이터 타입 | PK | FK | NOT NULL | 기본값 | 설명 |
|--------|------------|----|----|----------|--------|------|
| exp_id | SERIAL | PK | | YES | AUTO | 실험 고유 ID |
| method | VARCHAR(30) | | | YES | | DOE 방법 (full_factorial, ccd 등) |
| n_experiments | INTEGER | | | YES | | 설계 실험 수 |
| factor_ranges | JSONB | | | YES | | 인자 범위 JSON |
| design_matrix | JSONB | | | NO | null | 설계 행렬 JSON 배열 |
| simulation_result | JSONB | | | NO | null | 시뮬레이션 결과 JSON |
| analysis_result | JSONB | | | NO | null | 분석 결과 JSON (주효과, ANOVA 등) |
| created_at | TIMESTAMP | | | YES | NOW() | 실험 생성 일시 |
| created_by | VARCHAR(100) | | | NO | null | 생성자 (사용자 ID 또는 'system') |

**factor_ranges JSONB 예시**:
```json
{
  "sn_pct": {"min": 58.0, "max": 68.0, "levels": 3},
  "ag_pct": {"min": 1.0,  "max": 5.0,  "levels": 3},
  "cu_pct": {"min": 0.1,  "max": 1.5,  "levels": 3}
}
```

**인덱스**:
```sql
CREATE INDEX idx_doe_method ON DOE_EXPERIMENT(method);
CREATE INDEX idx_doe_created ON DOE_EXPERIMENT(created_at DESC);
```

---

### 4.4 RDB 전환 시 마이그레이션 계획

#### 단계별 전환

| 단계 | 작업 | 우선순위 |
|------|------|---------|
| 1단계 | PostgreSQL 설치 및 스키마 생성 | 높음 |
| 2단계 | formulation_history.csv → LOT + SUPPLIER 테이블 이관 | 높음 |
| 3단계 | PREDICTION_LOG 테이블 활성화 (API 로깅 추가) | 중간 |
| 4단계 | MODEL_ARTIFACT 테이블 연동 (meta.json 병행 유지) | 중간 |
| 5단계 | DOE_EXPERIMENT 이력 저장 활성화 | 낮음 |
| 6단계 | CSV 파일 방식 단계적 폐기 | 낮음 |

#### CSV → LOT 테이블 이관 스크립트 (예시)

```python
import pandas as pd
import sqlalchemy

df = pd.read_csv("data/raw/formulation_history.csv")
engine = sqlalchemy.create_engine("postgresql://user:pass@localhost:5432/formulation_ml")
df.to_sql("lot", engine, if_exists="append", index=False)
```

---

## 5. 데이터 품질 관리

### 5.1 현행 데이터 유효성 검사

현행 시스템에서는 FastAPI Pydantic 모델이 API 입력 유효성을 검사하며, CSV 데이터 자체에 대한 자동 검사는 없다.

| 검사 항목 | 현행 검사 위치 | RDB 전환 후 |
|-----------|--------------|------------|
| 온도 범위 (200~320°C) | RecommendRequest Field(ge=200, le=320) | CHECK 제약 |
| 공급사 코드 형식 | Field(pattern="^SUP_[ABC]$") | FK 참조 무결성 |
| 품질 점수 범위 | 없음 (CSV 신뢰) | CHECK 제약 |
| 성분 합계 ≈ 100% | _fill_pb_pct() 런타임 검사 | CHECK 제약 또는 트리거 |
| lot_id 고유성 | 없음 | PK 제약 |

### 5.2 학습 데이터 품질 기준

| 기준 | 임계값 | 조치 |
|------|--------|------|
| 최소 학습 데이터 수 | 100 LOT 이상 권장 | 미달 시 경고 로그 출력 |
| 불량률 | 5~30% 권장 (과소/과다 불균형 방지) | 데이터 재수집 권고 |
| 결측값 비율 | 컬럼별 10% 미만 | SimpleImputer 중앙값 대체 |
| 이상치 기준 | quality_score 3σ 이외 | 학습 전 검토 필요 |

---

*문서 끝 — SF-TD5 데이터베이스설계서 V1.0*
