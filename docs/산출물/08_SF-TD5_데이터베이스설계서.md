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
| 개정일 | 2026-08-25 |
| 버전 | v1.2 |

---

## 0. 개정 이력

| 버전 | 개정일 | 변경관리번호 | 개정 사유 및 내용 | 작성자 | 승인자 |
|------|--------|------------|-----------------|--------|--------|
| v1.0 | 2026-04-28 | — | 최초 작성 (테이블 10종) | 장다운 | 김현수 |
| v1.1 | 2026-08-25 | **CR-DB-001** | 44개 화면 중 15개 화면이 데이터 저장 대상 테이블 없이 설계되어, 필수 요구사항 12건을 충족할 수 없는 문제를 확인함. 이를 해소하기 위해 테이블 8종을 추가함 (§3.11~§3.18). ERD(§2) 및 데이터 보관 정책(§4)에 반영. 기존 테이블 10종의 정의는 변경하지 않음 | 장다운 | 김현수 |
| v1.2 | 2026-08-25 | **CR-DB-002** | 참조 무결성 결함 2건을 반영함. ① `master_codes` 의 유일성 제약이 버전 단위로만 걸려 있어 동일 코드가 버전을 달리하여 동시에 활성 상태로 중복 등록되는 문제를 확인하고, 활성 행에 대한 부분 유일 인덱스를 추가함 (§3.17). ② 전체 외래키 11건의 삭제 규칙이 지정되지 않아 사용자 계정 삭제 시 감사 로그 참조로 인한 무결성 위반이 발생하는 문제를 확인하고, 삭제 규칙을 명시함 (§3.19 신설) | 장다운 | 김현수 |
| v1.2 | 2026-08-25 | **CR-DB-003** | 컬럼 누락 2건을 반영함. ① `receipts` 에 성분 실측값 컬럼이 없어 FR-R-02(입고 이력 조회)의 "성분 데이터 포함" 요구를 충족할 수 없는 문제를 확인하고, 성분 4종 및 분석 방법 컬럼을 추가함 (§3.11). ② `kpi_targets` 에 실적값 집계 시각을 담을 컬럼이 없어 집계 기준 시점을 표시할 수 없는 문제를 확인하고 `actual_updated_at` 을 추가함 (§3.18) | 장다운 | 김현수 |

### CR-DB-001 개요

| 항목 | 내용 |
|------|------|
| 변경관리번호 | CR-DB-001 |
| 제목 | 44개 화면 필수 요구사항 충족을 위한 테이블 8종 추가 |
| 제기 일자 | 2026-08-25 |
| 승인 일자 | 2026-08-25 |
| 영향 범위 | 본 문서(SF-TD5) 및 DB 스키마. 타 산출물 변경 없음 |
| 추가 테이블 | receipts, claims, process_conditions, condition_history, notification_rules, system_settings, master_codes, kpi_targets |
| 해소 요구사항 | FR-R-01, FR-R-02, FR-S-04, FR-P-03, FR-P-04, FR-SY-03, FR-SY-04, FR-M-01, FR-M-02, FR-M-03, FR-DT-01, FR-K-03 (필수 12건) |

> **미해소 잔여 항목**: FR-DT-05(학습 데이터 관리) 및 FR-AG-01~05(AI Agent) 계열은
> 우선순위가 "선택"이며 v1 범위에서 화면 동작까지만 구현하므로 본 개정에 포함하지 않는다.
> 향후 필요 시 별도 변경관리로 처리한다.

### CR-DB-002 개요

| 항목 | 내용 |
|------|------|
| 변경관리번호 | CR-DB-002 |
| 제목 | 참조 무결성 제약 보완 — 활성 코드 유일성 및 외래키 삭제 규칙 |
| 제기 일자 | 2026-08-25 |
| 승인 일자 | 2026-08-25 |
| 영향 범위 | 본 문서(SF-TD5) 및 DB 스키마. 테이블 추가 없음 |
| 변경 내용 | ① `uq_master_codes_active_code` 부분 유일 인덱스 신설 (§3.17) ② 외래키 11건 삭제 규칙 명시 (§3.19 신설) |
| 관련 요구사항 | FR-M-03(코드 관리), FR-SY-01(사용자 관리), NFR-S-04(감사 로그 1년 보관) |

### CR-DB-003 개요

| 항목 | 내용 |
|------|------|
| 변경관리번호 | CR-DB-003 |
| 제목 | 입고 성분 컬럼 및 KPI 실적 집계 시각 컬럼 추가 |
| 제기 일자 | 2026-08-25 |
| 승인 일자 | 2026-08-25 |
| 영향 범위 | 본 문서(SF-TD5) 및 DB 스키마. 테이블 추가 없음, 컬럼 6종 추가 |
| 변경 내용 | ① `receipts` 에 `sn_pct`·`ag_pct`·`cu_pct`·`pb_pct`·`analysis_method` 추가 (§3.11) ② `kpi_targets` 에 `actual_updated_at` 추가 (§3.18) |
| 관련 요구사항 | FR-R-02(입고 이력 조회), FR-R-03(성분 데이터 관리), FR-K-03(KPI 설정) |

> **v1.2 는 테이블을 추가하지 않는다.** 테이블 수는 v1.1 과 동일한 **18종**이며,
> 제약·인덱스·컬럼만 보완한다.

> **참고 — 요구사항 ID 중복 건**: SF-AD2 요구사항정의서에서 `FR-M-01/02/03` 이
> §1.3(배합비율 최적화 AI)과 §1.7(기준정보관리)에 중복 부여되어 있다.
> 기준정보관리 계열을 `FR-MD-01/02/03` 으로 변경할 것을 제안하나,
> **본 개정의 승인 범위가 아니므로 SF-AD2 는 수정하지 않았다.**

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

### 2.1 추가 엔터티 (v1.1 / CR-DB-001)

```
┌───────────────┐      ┌────────────────────┐      ┌────────────────────┐
│   receipts    │      │ process_conditions │      │    master_codes    │
│───────────────│      │────────────────────│      │────────────────────│
│ id (PK)       │      │ id (PK)            │◄──┐  │ id (PK)            │
│ receipt_no(UK)│      │ product_code (UK)  │   │  │ group_code (UK)(U*)│
│ date          │      │ temp_min / temp_max│   │  │ code       (UK)(U*)│
│ supplier_id(FK)│──┐  │ time_min / time_max│   │  │ name               │
│ material      │  │   │ speed              │   │  │ value (JSONB)      │
│ quantity      │  │   │ version      (UK)  │   │  │ sort_order         │
│ unit          │  │   │ active             │   │  │ version    (UK)    │
│ status        │  │   │ created_at         │   │  │ active     (U*)    │
│ sn_pct    ★   │  │   └────────────────────┘   │  │ created_at         │
│ ag_pct    ★   │  │                            │  └────────────────────┘
│ cu_pct    ★   │  │   ┌────────────────────┐   │   (U*) 부분 유일 인덱스
│ pb_pct    ★   │  └──►│     suppliers      │   │        WHERE active
│ analysis_     │      │    (기존 §3.3)      │   │
│   method  ★   │      └────────────────────┘   │  ┌────────────────────┐
│ created_at    │                               │  │    kpi_targets     │
└───────────────┘                               │  │────────────────────│
                                                │  │ id (PK)            │
┌───────────────┐      ┌────────────────────┐   │  │ kpi_key      (UK)  │
│    claims     │      │ condition_history  │   │  │ period       (UK)  │
│───────────────│      │────────────────────│   │  │ target_value       │
│ id (PK)       │      │ id (PK)            │   │  │ actual_value       │
│ claim_no (UK) │      │ condition_id (FK)  │───┘  │ actual_updated_at ★│
│               │      │                    │      │ created_at         │
│               │      │                    │      └────────────────────┘
│ lot_id   (FK) │──┐   │ changed_by   (FK)  │──┐
│ customer      │  │   │ before (JSONB)     │  │   ┌────────────────────┐
│ reason        │  │   │ after  (JSONB)     │  │   │ notification_rules │
│ status        │  │   │ created_at         │  │   │────────────────────│
│ resolution    │  │   └────────────────────┘  │   │ id (PK)            │
│ resolved_at   │  │                           │   │ event_type    (UK) │
│ created_at    │  │   ┌────────────────────┐  │   │ threshold          │
└───────────────┘  │   │  system_settings   │  │   │ channel       (UK) │
                   │   │────────────────────│  │   │ enabled            │
                   │   │ key (PK)           │  │   │ created_at         │
┌───────────────┐  │   │ value              │  │   └────────────────────┘
│     lots      │◄─┘   │ value_type         │  │
│   (기존 §3.1)  │      │ description        │  │   ┌───────────────┐
└───────────────┘      │ updated_by   (FK)  │──┴──►│     users     │
                       │ updated_at         │      │   (기존 §3.8)  │
                       └────────────────────┘      └───────────────┘
```

**참조 관계 요약 (v1.1 추가분)**

| 자식 테이블 | 부모 테이블 | 외래키 | 관계 | NULL 허용 | ON DELETE |
|------------|-----------|--------|------|----------|-----------|
| receipts | suppliers | supplier_id | N:1 | N | RESTRICT |
| claims | lots | lot_id | N:1 | N | RESTRICT |
| condition_history | process_conditions | condition_id | N:1 | N | RESTRICT |
| condition_history | users | changed_by | N:1 | Y (NULL=시스템) | SET NULL |
| system_settings | users | updated_by | N:1 | Y (NULL=시스템) | SET NULL |

`master_codes`, `notification_rules`, `kpi_targets` 는 타 테이블을 참조하지 않는 독립 테이블이다.

**★ 표시는 v1.2(CR-DB-003)에서 추가된 컬럼이다.**
기존 테이블 10종(§3.1~§3.9)의 외래키를 포함한 전체 11건의 삭제 규칙은 **§3.19** 에 정리한다.


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

### 3.10 shipments (출하)

> **결번 사유**: 본 절은 §2 ERD 에 정의된 `shipments` 엔터티에 배정된 번호이나,
> v1.0 작성 시 컬럼 정의표가 누락되었다. 해당 누락 건은 CR-DB-001 의 승인 범위가
> 아니므로 본 개정에서는 절 번호만 예약하고 정의를 추가하지 않는다.
> 구현은 ERD 필드(id, lot_id, customer, product, quantity, unit, shipped_at)를
> 기준으로 진행하며, 별도 변경관리로 정식 반영할 것을 제안한다.

---

### 3.11 receipts (원재료 입고)

**추가 근거**: FR-R-01(입고 현황 조회), FR-R-02(입고 이력 조회) — 우선순위 필수.
공급사별 원재료(Sn/Ag/Cu/Pb ingot)의 입고 수량 및 검사 상태를 저장할 테이블이 v1.0 에 없었다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK/UK | 기본값 | 설명 |
|--------|-----------|----------|----------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| receipt_no | VARCHAR(20) | Y | UK | — | 입고 번호 (예: RCV-001) |
| date | DATE | Y | — | — | 입고 날짜 |
| supplier_id | BIGINT | Y | FK(suppliers) | — | 공급사 ID |
| material | VARCHAR(50) | Y | — | — | 원재료명 (Sn ingot / Ag powder / Cu wire / Pb ingot) |
| quantity | DECIMAL(10,2) | Y | — | — | 입고 수량 |
| unit | VARCHAR(10) | Y | — | 'kg' | 수량 단위 |
| status | VARCHAR(15) | Y | — | 'inspecting' | accepted/rejected/inspecting |
| sn_pct | DECIMAL(6,3) | N | — | NULL | 입고 시점 Sn 실측값 (%) — v1.2 추가 |
| ag_pct | DECIMAL(6,3) | N | — | NULL | 입고 시점 Ag 실측값 (%) — v1.2 추가 |
| cu_pct | DECIMAL(6,3) | N | — | NULL | 입고 시점 Cu 실측값 (%) — v1.2 추가 |
| pb_pct | DECIMAL(6,3) | N | — | NULL | 입고 시점 Pb 실측값 (%) — v1.2 추가 |
| analysis_method | VARCHAR(20) | N | — | NULL | 분석 방법 (XRF 등) — v1.2 추가 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

**인덱스**:
```sql
CREATE INDEX idx_receipts_date ON receipts(date DESC);
CREATE INDEX idx_receipts_supplier ON receipts(supplier_id);
CREATE INDEX idx_receipts_status ON receipts(status);
```

**성분 컬럼 추가 사유 (v1.2 / CR-DB-003)**

FR-R-02(입고 이력 조회)는 "성분 데이터 포함"을 요구한다. 그러나 v1.1 의 `receipts` 에는
`lot_id` 외래키도 성분 컬럼도 없어 특정 입고 건의 성분 실측값에 도달할 경로가 존재하지 않았다.
`supplier_id` 만으로는 공급사 단위 조회에 그친다.

성분 실측값을 `components`(§3.2)에 저장하는 방안을 검토하였으나 채택하지 않았다.
`components.lot_id` 는 `NOT NULL` 외래키로 **생산 LOT 전용**이며, 입고 시점의 원재료에는
아직 LOT 이 부여되지 않는다. 해당 제약을 완화하는 것은 v1.0 §3.2 의 정의를 변경하는 것이므로,
입고 시점 실측값은 `receipts` 에 직접 보관한다.
두 테이블은 **측정 시점이 다르다** — `receipts` 는 입고 원재료, `components` 는 생산 LOT 이다.

성분 4종과 분석 방법은 전부 NULL 을 허용한다. `status='inspecting'` 구간에서는 아직 측정이
완료되지 않은 상태이기 때문이다.

**목표값 대비 편차는 저장하지 않는다.** FR-R-03 의 "편차 자동 계산"은 응용 계층에서
조회 시점에 산출한다. 원재료(예: `material='Sn ingot'`)의 Sn 함량은 99% 수준이므로
배합 목표값 62.0% 와의 차이를 품질 편차로 해석해서는 안 되며, 편차 경고 임계값은
생산 LOT(`components`)에만 적용한다.

---

### 3.12 claims (고객 클레임)

**추가 근거**: FR-S-04(클레임 관리) — 우선순위 필수.
고객 클레임 등록 및 원인 분석(해당 LOT 성분 데이터 연계), 처리 이력 관리를 위한 테이블이다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK/UK | 기본값 | 설명 |
|--------|-----------|----------|----------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| claim_no | VARCHAR(20) | Y | UK | — | 클레임 번호 (예: CLM-001) |
| lot_id | BIGINT | Y | FK(lots) | — | 대상 LOT ID |
| customer | VARCHAR(100) | Y | — | — | 고객사명 |
| reason | TEXT | Y | — | — | 클레임 사유 |
| status | VARCHAR(15) | Y | — | 'open' | open/analyzing/resolved/rejected |
| resolution | TEXT | N | — | NULL | 처리 내용 |
| resolved_at | TIMESTAMP | N | — | NULL | 처리 완료 시각 |
| created_at | TIMESTAMP | Y | — | NOW() | 접수 시각 |

**인덱스**:
```sql
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_claims_lot ON claims(lot_id);
```

---

### 3.13 process_conditions (표준 공정 조건)

**추가 근거**: FR-P-03(공정 조건 관리) — 우선순위 필수.
제품별 표준 공정 조건(온도, 시간, 속도)의 등록 및 버전 관리를 위한 테이블이다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| product_code | VARCHAR(30) | Y | UK* | — | 제품 코드 |
| temp_min | DECIMAL(5,1) | Y | — | — | 표준 용해 온도 하한 (°C) |
| temp_max | DECIMAL(5,1) | Y | — | — | 표준 용해 온도 상한 (°C) |
| time_min | INTEGER | Y | — | — | 표준 처리 시간 하한 (분) |
| time_max | INTEGER | Y | — | — | 표준 처리 시간 상한 (분) |
| speed | DECIMAL(6,2) | N | — | NULL | 표준 속도 |
| version | INTEGER | Y | UK* | 1 | 조건 버전 (개정 시 증가) |
| active | BOOLEAN | Y | — | TRUE | 현행 적용 여부 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

**제약 및 인덱스**:
```sql
ALTER TABLE process_conditions
  ADD CONSTRAINT uq_process_conditions_product_version UNIQUE (product_code, version);
CREATE INDEX idx_process_conditions_product ON process_conditions(product_code);
```

---

### 3.14 condition_history (공정 조건 변경 이력)

**추가 근거**: FR-P-04(이력 조회) — 우선순위 필수.
공정 조건의 변경 전후 값을 보관한다. §3.9 `audit_logs` 가 전 시스템 횡단 감사 기록(1년 보관)인 것과 달리,
본 테이블은 공정 조건이라는 업무 객체의 개정 이력으로서 무기한 보관한다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| condition_id | BIGINT | Y | FK(process_conditions) | — | 대상 공정 조건 ID |
| changed_by | BIGINT | N | FK(users) | NULL | 변경자 ID (NULL=시스템) |
| before | JSONB | N | — | NULL | 변경 전 값 |
| after | JSONB | N | — | NULL | 변경 후 값 |
| created_at | TIMESTAMP | Y | — | NOW() | 변경 시각 |

**인덱스**:
```sql
CREATE INDEX idx_condition_history_created ON condition_history(created_at DESC);
```

---

### 3.15 notification_rules (알림 규칙)

**추가 근거**: FR-SY-03(알림 설정) — 우선순위 필수.
`event_type` 3종은 FR-SY-03 의 서술("품질 이상, 성분 편차 초과, 설비 경고 알림 조건 및
채널(이메일/시스템) 설정")에서 도출하였다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| event_type | VARCHAR(30) | Y | UK* | — | quality_fail/deviation_exceed/equipment_warning |
| threshold | DECIMAL(10,3) | N | — | NULL | 발동 임계값 |
| channel | VARCHAR(10) | Y | UK* | 'system' | email/system |
| enabled | BOOLEAN | Y | — | TRUE | 활성 여부 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

**제약**:
```sql
ALTER TABLE notification_rules
  ADD CONSTRAINT uq_notification_rules_event_channel UNIQUE (event_type, channel);
```

---

### 3.16 system_settings (시스템 설정)

**추가 근거**: FR-SY-04(시스템 설정), FR-DT-01(데이터 연동) — 우선순위 필수.
ML 목표값, 품질 합격 기준점, 알림 임계값 및 외부 시스템 연동 설정을 키-값 형태로 보관한다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/FK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| key | VARCHAR(50) | Y | PK | — | 설정 키 |
| value | VARCHAR(255) | Y | — | — | 설정 값 (문자열로 저장) |
| value_type | VARCHAR(10) | Y | — | 'string' | number/string/boolean/json |
| description | VARCHAR(200) | N | — | NULL | 설정 설명 |
| updated_by | BIGINT | N | FK(users) | NULL | 최종 수정자 ID (NULL=시스템) |
| updated_at | TIMESTAMP | Y | — | NOW() | 수정 시각 |

**설계 특이사항**: 본 테이블은 다른 17개 테이블과 달리 `id BIGSERIAL` 대리키를 두지 않고
`key` 를 자연 기본키로 사용한다. 키-값 저장소 특성상 대리키가 불필요하기 때문이다.

**주요 설정 키**:

| 키 | value_type | 예시 값 | 비고 |
|----|-----------|--------|------|
| ml.sn_target | number | 62.0 | 변경 시 모델 재학습 필요 |
| ml.ag_target | number | 3.0 | 변경 시 모델 재학습 필요 |
| ml.cu_target | number | 0.5 | 변경 시 모델 재학습 필요 |
| quality.pass_score | number | 70 | 품질 합격 기준점 |
| equipment.temp_warn_c | number | 255 | 설비 온도 경고 임계값 |
| deviation.warn_sn / warn_ag / warn_cu | number | 2.0 / 0.3 / 0.1 | 성분 편차 경고 임계값 |
| integration.erp.* / integration.xrf.* | json | — | 외부 시스템 연동 설정 (FR-DT-01) |

> **주의**: `ml.sn_target` 등 성분 목표값 3종은 학습된 모델의 파생 피처
> (`sn_deviation` 등)가 해당 값을 기준으로 산출되어 있으므로,
> 운영 중 변경 시 저장된 모델이 무효가 된다. 화면에서는 읽기 전용으로 노출하고,
> 변경은 모델 재학습 절차와 함께 수행한다.

---

### 3.17 master_codes (기준정보 공통 코드)

**추가 근거**: 기준정보관리 3화면(품질 기준 / 작업 표준 / 코드 관리) — 우선순위 필수.
세 화면이 "코드 + 명칭 + 정렬순서 + 활성여부"라는 동일한 골격을 공유하고 가변 속성만
다르므로, `group_code` 로 구분하는 단일 테이블로 설계하였다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| group_code | VARCHAR(30) | Y | UK* | — | 코드 그룹 |
| code | VARCHAR(30) | Y | UK* | — | 코드 |
| name | VARCHAR(100) | Y | — | — | 코드명 |
| value | JSONB | N | — | NULL | 그룹별 가변 속성 |
| sort_order | INTEGER | Y | — | 0 | 정렬 순서 |
| version | INTEGER | Y | UK* | 1 | 버전 (작업 표준 개정 관리용) |
| active | BOOLEAN | Y | — | TRUE | 활성 여부 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

**제약 및 인덱스**:
```sql
ALTER TABLE master_codes
  ADD CONSTRAINT uq_master_codes_group_code_version UNIQUE (group_code, code, version);

-- v1.2 (CR-DB-002) 추가: 활성 코드는 그룹 내 유일
CREATE UNIQUE INDEX uq_master_codes_active_code
    ON master_codes (group_code, code) WHERE active;

CREATE INDEX idx_master_codes_group ON master_codes(group_code);
```

**활성 유일 인덱스 추가 사유 (v1.2 / CR-DB-002)**

v1.1 의 유일성 제약은 `(group_code, code, version)` 이므로 동일한 코드가 버전만 달리하여
**동시에 활성 상태로 중복 등록**될 수 있었다. `suppliers.code` 등을 참조하는 마스터 조회에서
어느 행이 유효한 값인지 결정할 수 없어 정합성이 깨진다.

기존 제약을 `(group_code, code)` 로 **교체하지 않고 부분 유일 인덱스를 추가**하였다.
FR-M-02(작업 표준 관리)가 작업 표준서의 **버전 관리**를 요구하므로, 동일 코드의 서로 다른
버전 행은 이력으로 공존해야 한다. 전면 교체 시 개정 이력을 한 행밖에 보관할 수 없다.

즉 요구사항은 **"이력은 여러 개, 활성은 하나"** 이며, 두 제약을 함께 두어 이를 만족시킨다.

| 상황 | 결과 |
|------|------|
| 동일 코드의 비활성 이력 행 + 활성 행 1건 | 허용 |
| 동일 코드의 활성 행 2건 이상 | **차단** (`uq_master_codes_active_code` 위반) |

응용 계층은 개정 시 `version + 1` 로 신규 행을 INSERT 하고 직전 행을 `active = false` 로
전환한다. 조회는 `active = true` 인 행만 반환한다.

**코드 그룹 정의**:

| group_code | 대상 화면 | value(JSONB) 구성 |
|-----------|---------|------------------|
| QUALITY_STD | 품질 기준 | `{"sn_min":..,"sn_max":..,"ag_min":..,"ag_max":..,"cu_min":..,"cu_max":..,"pb_min":..,"pb_max":..,"pass_score":70}` |
| WORK_STD | 작업 표준 | `{"content":"..","author":".."}` — version 으로 개정 관리 |
| SUPPLIER | 코드 관리 | NULL 또는 부가 속성 |
| PRODUCT | 코드 관리 | NULL 또는 부가 속성 |
| STATUS | 코드 관리 | NULL 또는 부가 속성 |

> `value` 컬럼은 JSONB 이나 무검증으로 저장하지 않는다.
> `group_code` 별로 애플리케이션 계층에서 스키마를 검증한 후 저장한다.

---

### 3.18 kpi_targets (KPI 목표값)

**추가 근거**: FR-K-03(KPI 설정) — 우선순위 필수.
FR-K-01(생산 KPI), FR-K-02(품질 KPI)의 "목표 대비 현황" 표시에도 사용된다.

| 컬럼명 | 데이터타입 | NOT NULL | PK/UK | 기본값 | 설명 |
|--------|-----------|----------|-------|--------|------|
| id | BIGSERIAL | Y | PK | — | 시스템 ID |
| kpi_key | VARCHAR(30) | Y | UK* | — | KPI 식별자 |
| period | VARCHAR(7) | Y | UK* | — | 대상 기간 (YYYY-MM) |
| target_value | DECIMAL(10,3) | Y | — | — | 목표값 |
| actual_value | DECIMAL(10,3) | N | — | NULL | 실적값 (월 마감 스냅샷) |
| actual_updated_at | TIMESTAMP | N | — | NULL | 실적값 집계 시각 — v1.2 추가. NULL = 미마감 |
| created_at | TIMESTAMP | Y | — | NOW() | 등록 시각 |

**제약 및 인덱스**:
```sql
ALTER TABLE kpi_targets
  ADD CONSTRAINT uq_kpi_targets_key_period UNIQUE (kpi_key, period);
CREATE INDEX idx_kpi_targets_period ON kpi_targets(period);
```

**KPI 식별자 정의** (FR-K-01, FR-K-02 기준):

| kpi_key | 구분 | 설명 | 산출 원천 |
|---------|------|------|----------|
| yield_pct | 생산 | 수율 (%) | lots |
| production_volume | 생산 | 생산량 | lots |
| defect_rate | 생산 | LOT 불량률 (%) | lots |
| quality_avg | 품질 | 평균 품질 점수 | quality |
| pass_rate | 품질 | 합격률 (%) | quality |
| claim_rate | 품질 | 클레임 발생률 (%) | claims |

**실적값 산출 방식 (v1.2 / CR-DB-003)**

v1.1 은 `actual_value` 를 배치로 산출하여 저장하고 화면이 이를 조회하는 방식으로 기술하였다.
그러나 이 경우 KPI 조회 화면(FR-K-01·K-02)은 실시간 집계를, KPI 설정 화면(FR-K-03)은
배치 저장값을 표시하게 되어 **당월 실적이 화면마다 다르게 보이는 문제**가 발생한다.

검토 결과 `lots` 테이블 규모(약 2천 행)와 `idx_lots_date` 인덱스를 고려할 때 12개월 단위
집계는 화면 응답 2초 이내(NFR-P-01) 기준을 충분히 만족한다. 따라서 다음과 같이 정리한다.

| 구분 | 산출 방식 |
|------|----------|
| 화면 표시 실적값 (전 KPI 화면) | `lots`·`quality`·`claims` **실시간 집계** — 단일 출처 |
| `actual_value` | **월 마감 스냅샷** 전용 (감사 및 이력 보존 목적) |
| `actual_updated_at` | 해당 스냅샷의 집계 시각. NULL 이면 아직 마감되지 않은 기간 |

`actual_updated_at` 은 마감 스냅샷의 기준 시점을 화면에 표시하기 위해 추가하였다.
`created_at` 은 행 생성 시각이므로 집계 시각을 대신할 수 없다.


---

### 3.19 외래키 삭제 정책 (v1.2 / CR-DB-002 신설)

v1.1 까지 전체 외래키 11건의 삭제 규칙이 지정되지 않아 모두 `NO ACTION` 으로 생성되었다.
이 상태에서는 FR-SY-01(사용자 관리)의 사용자 계정 삭제 시 `audit_logs.user_id` 참조로
무결성 위반이 발생하여 삭제 자체가 불가능하다. 그러나 NFR-S-04 는 감사 로그를 1년간
보관하도록 요구하므로 **감사 기록은 사용자 계정보다 오래 유지되어야 한다.**

이에 참조 컬럼의 NULL 허용 여부를 기준으로 삭제 규칙을 이원화한다.

**NULL 허용 외래키 — `ON DELETE SET NULL`** (부모 삭제 시에도 자식 이력을 보존)

| 자식 테이블 | 컬럼 | 부모 테이블 | 근거 |
|------------|------|-----------|------|
| audit_logs | user_id | users | 감사 이력 보존. `NULL = 시스템` 은 §3.9 가 이미 사용하는 표기 |
| condition_history | changed_by | users | 공정 조건 개정 이력 보존 |
| system_settings | updated_by | users | 설정값 보존 |
| alerts | lot_id | lots | 알림 본문은 LOT 참조 없이도 의미를 가진다 |

**NOT NULL 외래키 — `ON DELETE RESTRICT`** (부모 삭제를 차단)

| 자식 테이블 | 컬럼 | 부모 테이블 | 근거 |
|------------|------|-----------|------|
| lots | supplier_id | suppliers | 생산 이력이 있는 공급사는 삭제할 수 없다 |
| receipts | supplier_id | suppliers | 입고 이력이 있는 공급사는 삭제할 수 없다 |
| components | lot_id | lots | LOT 은 무기한 보관 대상이다 (§4) |
| quality | lot_id | lots | 상동 |
| shipments | lot_id | lots | 상동 |
| claims | lot_id | lots | 상동 |
| condition_history | condition_id | process_conditions | 공정 조건은 `active=false` 로 폐기하며 삭제하지 않는다 |

**사용자 계정 삭제에 대한 원칙**

`ON DELETE SET NULL` 은 물리 삭제가 발생했을 경우의 2차 방어 수단이며, 운영상의 원칙이 아니다.
사용자 계정은 **논리 삭제**(`users.active = false`)를 원칙으로 하며 행을 물리적으로 삭제하지 않는다.
물리 삭제 시 `audit_logs.user_id` 가 NULL 로 전환되어 행위 주체를 영구히 확인할 수 없게 되는데,
NFR-S-04 가 요구하는 것은 로그의 존재가 아니라 **추적 가능성**이기 때문이다.

`users.username` 및 `users.email` 은 유일 제약 대상이므로 비활성 계정도 해당 값을 계속 점유한다.
이는 의도된 동작이다. 퇴사자의 계정명을 재사용할 경우 과거 감사 이력이 신규 사용자에게
귀속되는 문제가 발생한다.

---

## 4. 데이터 보관 정책

| 테이블 | 보관 기간 | 삭제 정책 |
|--------|---------|-----------|
| lots | 무기한 | 삭제 없음 (이력 영구 보관) |
| components | 무기한 | 삭제 없음 |
| quality | 무기한 | 삭제 없음 |
| audit_logs | 1년 | 1년 초과 자동 삭제 (배치). 사용자 삭제 시에도 행은 보존되며 `user_id` 만 NULL 로 전환된다 (§3.19) |
| alerts | 6개월 | resolved + 6개월 초과 자동 삭제 |
| ml_models | 무기한 | active=false는 유지 (이력 관리) |
| receipts | 무기한 | 삭제 없음 (입고 이력 영구 보관) |
| users | 무기한 | **논리 삭제만 허용** (`active=false`). 물리 삭제 금지 — §3.19 |
| claims | 무기한 | 삭제 없음 (품질 이력 연계) |
| process_conditions | 무기한 | active=false는 유지 (버전 이력 관리) |
| condition_history | 무기한 | 삭제 없음 (개정 이력 영구 보관) |
| notification_rules | 무기한 | 설정 정보 |
| system_settings | 무기한 | 설정 정보 |
| master_codes | 무기한 | active=false는 유지 (버전 이력 관리) |
| kpi_targets | 무기한 | 삭제 없음 |

---

## 5. 백업 정책

| 항목 | 내용 |
|------|------|
| 전체 백업 | 매일 01:00 (pg_dump) |
| 보관 기간 | 90일 |
| 백업 위치 | /backup/postgres/ (별도 디스크) |
| 암호화 | AES-256 |
| 복구 테스트 | 분기별 1회 복구 훈련 |
