# SF-TD5 데이터베이스설계서

| 항목 | 내용 |
|------|------|
| 문서번호 | SF-TD5 |
| 문서명 | 데이터베이스설계서 |
| 사업명 | 성분분석 데이터 기반 배합비율 최적화 ML 시스템 구축 |
| 도입기업 | (주)고려솔더 |
| 작성자 | 장다운 |
| 검토자 | 이성민 |
| 승인자 | 김현수 |
| 작성일 | 2026-04-28 |
| 버전 | v1.0 |

---

## 1. DB 개요

| 항목 | 내용 |
|------|------|
| DBMS | PostgreSQL 15 |
| 문자셋 | UTF-8 |
| 콜레이션 | ko_KR.UTF-8 |
| 스키마 | public |
| DB명 | koryo_solder_db |
| 접속 포트 | 5432 |

---

## 2. ERD (Entity Relationship Diagram)

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│   suppliers  │       │  lots        │       │   quality    │
│──────────────│       │──────────────│       │──────────────│
│ id (PK)      │◄──┐   │ id (PK)      │──────►│ id (PK)      │
│ code         │   │   │ lot_id (UK)  │       │ lot_id (FK)  │
│ name         │   │   │ date         │       │ score        │
│ contact      │   └───│ supplier_id  │       │ passed       │
│ material     │       │ sn_ratio     │       │ model_used   │
│ created_at   │       │ ag_ratio     │       │ tested_at    │
└──────────────┘       │ cu_ratio     │       └──────────────┘
                       │ pb_ratio     │
┌──────────────┐       │ status       │       ┌──────────────┐
│  components  │       │ created_at   │       │  shipments   │
│──────────────│       └──────────────┘       │──────────────│
│ id (PK)      │                              │ id (PK)      │
│ date         │       ┌──────────────┐       │ lot_id (FK)  │
│ sn           │       │  equipment   │       │ customer     │
│ ag           │       │──────────────│       │ product      │
│ cu           │       │ id (PK)      │       │ quantity     │
│ pb           │       │ eq_id (UK)   │       │ unit         │
│ sn_deviation │       │ name         │       │ shipped_at   │
│ ag_deviation │       │ status       │       └──────────────┘
│ cu_deviation │       │ temperature  │
│ lot_id (FK)  │       │ uptime       │       ┌──────────────┐
│ created_at   │       │ last_maint.  │       │  users       │
└──────────────┘       └──────────────┘       │──────────────│
                                              │ id (PK)      │
┌──────────────┐       ┌──────────────┐       │ username     │
│  ml_models   │       │  alerts      │       │ password_hash│
│──────────────│       │──────────────│       │ role         │
│ id (PK)      │       │ id (PK)      │       │ email        │
│ name         │       │ level        │       │ created_at   │
│ model_type   │       │ message      │       └──────────────┘
│ rmse         │       │ timestamp    │
│ r2           │       │ resolved     │       ┌──────────────┐
│ trained_at   │       └──────────────┘       │  audit_logs  │
│ artifact_path│                              │──────────────│
└──────────────┘                              │ id (PK)      │
                                              │ user_id (FK) │
                                              │ action       │
                                              │ target       │
                                              │ created_at   │
                                              └──────────────┘
```

---

## 3. 테이블 정의

### 3.1 lots (LOT 정보)

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK/UK | 기본값 | 설명 |
|--------|-----------|----------|----------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| lot_id | VARCHAR(20) | Y | UK | — | LOT 식별자 (예: LOT-2026-001) |
| date | DATE | Y | — | — | 생산 날짜 |
| supplier_id | BIGINT | Y | FK(suppliers) | — | 공급사 ID |
| sn_ratio | DECIMAL(6,3) | Y | — | — | Sn 비율 (%) |
| ag_ratio | DECIMAL(6,3) | Y | — | — | Ag 비율 (%) |
| cu_ratio | DECIMAL(6,3) | Y | — | — | Cu 비율 (%) |
| pb_ratio | DECIMAL(6,3) | Y | — | — | Pb 비율 (%) |
| temperature | DECIMAL(5,1) | N | — | — | 용해 온도 (°C) |
| time_min | INTEGER | N | — | — | 처리 시간 (분) |
| quality_score | DECIMAL(5,2) | N | — | — | 품질 점수 (0~100) |
| status | VARCHAR(10) | Y | — | 'pending' | pass/fail/warning/pending |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |
| updated_at | TIMESTAMP | Y | — | NOW() | 수정 시각 |

**인덱스**:
```sql
CREATE INDEX idx_lots_date ON lots(date DESC);
CREATE INDEX idx_lots_supplier ON lots(supplier_id);
CREATE INDEX idx_lots_status ON lots(status);
```

---

### 3.2 components (성분 데이터)

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| lot_id | BIGINT | Y | FK(lots) | — | LOT ID |
| date | DATE | Y | — | — | 측정 날짜 |
| sn | DECIMAL(6,3) | Y | — | — | Sn 실측값 (%) |
| ag | DECIMAL(6,3) | Y | — | — | Ag 실측값 (%) |
| cu | DECIMAL(6,3) | Y | — | — | Cu 실측값 (%) |
| pb | DECIMAL(6,3) | Y | — | — | Pb 실측값 (%) |
| sn_deviation | DECIMAL(6,3) | Y | — | — | Sn 편차 (실측-62.0) |
| ag_deviation | DECIMAL(6,3) | Y | — | — | Ag 편차 (실측-3.0) |
| cu_deviation | DECIMAL(6,3) | Y | — | — | Cu 편차 (실측-0.5) |
| analysis_method | VARCHAR(20) | N | — | 'XRF' | 분석 방법 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

---

### 3.3 suppliers (공급사)

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| code | VARCHAR(10) | Y | UK | — | 공급사 코드 (SUP_A, SUP_B, ...) |
| name | VARCHAR(100) | Y | — | — | 공급사명 |
| contact | VARCHAR(200) | N | — | — | 담당자 연락처 |
| primary_material | VARCHAR(50) | N | — | — | 주 공급 원재료 |
| active | BOOLEAN | Y | — | TRUE | 활성 여부 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

---

### 3.4 quality (품질 검사 결과)

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| lot_id | BIGINT | Y | FK(lots) | — | LOT ID |
| score | DECIMAL(5,2) | Y | — | — | 품질 점수 |
| passed | BOOLEAN | Y | — | — | 합격 여부 (점수≥70) |
| model_used | VARCHAR(30) | Y | — | — | 예측 모델명 |
| predicted_score | DECIMAL(5,2) | N | — | — | ML 예측 점수 |
| tested_at | TIMESTAMP | Y | — | NOW() | 검사 시각 |

---

### 3.5 equipment (설비)

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| eq_id | VARCHAR(10) | Y | UK | — | 설비 코드 (EQ-001) |
| name | VARCHAR(100) | Y | — | — | 설비명 |
| status | VARCHAR(15) | Y | — | 'normal' | normal/warning/error/maintenance |
| temperature | DECIMAL(5,1) | N | — | — | 현재 온도 (°C) |
| uptime | INTEGER | N | — | 0 | 가동시간 (시간) |
| last_maintenance | DATE | N | — | — | 마지막 점검일 |
| updated_at | TIMESTAMP | Y | — | NOW() | 상태 업데이트 시각 |

---

### 3.6 ml_models (ML 모델 이력)

| 컬럼명 | 데이터타입 | NOT NULL | PK | 기본값 | 설명 |
|--------|-----------|----------|-----|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| name | VARCHAR(30) | Y | — | — | 모델명 (gradient_boosting) |
| model_type | VARCHAR(30) | Y | — | — | 알고리즘 유형 |
| rmse | DECIMAL(6,4) | N | — | — | RMSE 성능 |
| r2 | DECIMAL(6,4) | N | — | — | R² 성능 |
| mape | DECIMAL(6,4) | N | — | — | MAPE 성능 |
| train_samples | INTEGER | N | — | — | 학습 데이터 수 |
| artifact_path | VARCHAR(255) | Y | — | — | 모델 파일 경로 |
| active | BOOLEAN | Y | — | FALSE | 현재 서빙 중 여부 |
| trained_at | TIMESTAMP | Y | — | NOW() | 학습 완료 시각 |

---

### 3.7 alerts (알림)

| 컬럼명 | 데이터타입 | NOT NULL | PK | 기본값 | 설명 |
|--------|-----------|----------|-----|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| level | VARCHAR(10) | Y | — | — | info/warning/critical |
| message | TEXT | Y | — | — | 알림 메시지 |
| source | VARCHAR(30) | N | — | — | 발생 소스 (system/ml/equipment) |
| lot_id | BIGINT | N | FK(lots) | NULL | 관련 LOT |
| resolved | BOOLEAN | Y | — | FALSE | 처리 여부 |
| resolved_at | TIMESTAMP | N | — | NULL | 처리 시각 |
| created_at | TIMESTAMP | Y | — | NOW() | 발생 시각 |

---

### 3.8 users (사용자)

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| username | VARCHAR(50) | Y | UK | — | 사용자명 |
| email | VARCHAR(100) | Y | UK | — | 이메일 |
| password_hash | VARCHAR(255) | Y | — | — | bcrypt 해시 |
| role | VARCHAR(20) | Y | — | 'viewer' | admin/manufacture/quality/sales/viewer |
| active | BOOLEAN | Y | — | TRUE | 활성 여부 |
| last_login | TIMESTAMP | N | — | NULL | 마지막 로그인 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

---

### 3.9 audit_logs (감사 로그)

| 컬럼명 | 데이터타입 | NOT NULL | PK | 기본값 | 설명 |
|--------|-----------|----------|-----|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| user_id | BIGINT | N | FK(users) | NULL | 사용자 ID (NULL=시스템) |
| action | VARCHAR(50) | Y | — | — | CREATE/UPDATE/DELETE/LOGIN/PREDICT |
| target_table | VARCHAR(50) | N | — | NULL | 대상 테이블명 |
| target_id | BIGINT | N | — | NULL | 대상 레코드 ID |
| detail | JSONB | N | — | NULL | 상세 내용 (변경 전후 값) |
| ip_address | INET | N | — | NULL | 클라이언트 IP |
| created_at | TIMESTAMP | Y | — | NOW() | 발생 시각 |

**파티셔닝**: 월별 파티션 (데이터 빠른 증가 대응)

---

## 4. 데이터 보관 정책

| 테이블 | 보관 기간 | 삭제 정책 |
|--------|---------|-----------|
| lots | 무기한 | 삭제 없음 (이력 영구 보관) |
| components | 무기한 | 삭제 없음 |
| quality | 무기한 | 삭제 없음 |
| audit_logs | 1년 | 1년 초과 자동 삭제 (배치) |
| alerts | 6개월 | resolved + 6개월 초과 자동 삭제 |
| ml_models | 무기한 | active=false는 유지 (이력 관리) |

---

## 5. 백업 정책

| 항목 | 내용 |
|------|------|
| 전체 백업 | 매일 01:00 (pg_dump) |
| 보관 기간 | 90일 |
| 백업 위치 | /backup/postgres/ (별도 디스크) |
| 암호화 | AES-256 |
| 복구 테스트 | 분기별 1회 복구 훈련 |
