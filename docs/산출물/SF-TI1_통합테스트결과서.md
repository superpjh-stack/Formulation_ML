# SF-TI1 통합테스트결과서

**문서번호**: SF-TI1 | **버전**: V1.0 | **작성일**: 2026-06-19 | **작성자**: 개발팀

---

## 1. 문서 개요

### 1.1 목적
본 문서는 Formulation ML 시스템의 통합테스트 수행 결과를 기록한다. Frontend(Next.js) - Backend(FastAPI) - ML 모델 간 인터페이스 연동 및 End-to-End 시나리오가 요구사항대로 동작함을 검증한다.

### 1.2 테스트 범위
- Frontend UI(Next.js 3000) ↔ Backend API(FastAPI 8000) 연동
- API ↔ ML 모델(scikit-learn, XGBoost, scipy) 연동
- 에러 처리 및 경계 조건 검증
- 성능(응답시간) 검증

### 1.3 참조 문서
- SF-RS1 요구사항정의서 V1.0
- SF-DD1 상세설계서 V1.0
- SF-CD1 단위테스트결과서 V1.0

---

## 2. 테스트 환경

### 2.1 하드웨어/소프트웨어 환경
| 항목 | 내용 |
|------|------|
| OS | Windows 11 Enterprise 10.0.26200 |
| CPU | Intel Core i7 (8코어) |
| RAM | 16GB |
| Backend | FastAPI 0.137.1, Uvicorn, localhost:8000 |
| Frontend | Next.js 14 App Router, localhost:3000 |
| ML 런타임 | Python 3.10, scikit-learn 1.3, XGBoost 2.0, scipy 1.11 |
| 브라우저 | Chrome 125 (수동 테스트), FastAPI /docs (Swagger UI) |
| 테스트 도구 | 브라우저 수동 테스트, FastAPI /docs, curl, httpx |

### 2.2 서버 기동 절차
```bash
# Backend 기동
cd "04 Formulation ML"
uvicorn api.main:app --reload --port 8000

# Frontend 기동 (별도 터미널)
cd frontend
npm run dev
```

### 2.3 사전 조건
- GradientBoosting 모델 사전 학습 완료 (`models/artifacts/gradient_boosting.joblib` 존재)
- 샘플 데이터 생성 완료 (`data/raw/formulation_history.csv` 존재)
- CORS 설정: FastAPI `allow_origins=["http://localhost:3000"]`

---

## 3. 통합테스트 범위 및 전략

### 3.1 테스트 범위

| 기능 영역 | 테스트 범위 | 우선순위 |
|-----------|-------------|----------|
| 배합비율 추천 | UI 입력 → API → SLSQP 최적화 → 결과 표시 | 최상 |
| 품질점수 예측 | UI 입력 → API → ML 추론 → 결과 표시 | 최상 |
| EDA 분석 | 데이터 로드 → 통계 계산 → 차트 렌더링 | 상 |
| 모델 현황 | 모델 목록 → 성능지표 → 피처 중요도 | 상 |
| DOE 시뮬레이터 | 설계 → ML 시뮬레이션 → 통계 분석 → 최적화 | 상 |
| 에러 처리 | 미학습 모델, 유효성 오류, 서버 장애 | 중 |
| CORS / 보안 | 헤더 검증, 비인가 Origin 차단 | 중 |
| 성능 | API 응답시간, 대용량 DOE | 중 |

### 3.2 테스트 시나리오 구성 전략
- **Happy Path**: 정상 입력 → 정상 출력 시나리오 우선 검증
- **Error Path**: 모델 미존재, 입력 범위 초과, 서버 장애 상황 검증
- **Boundary**: 성분 합계 100%, 대용량 실험 설계(100개 이상) 검증
- **Integration**: Frontend Zod 유효성 검사 → API Pydantic 검증 이중 검증 확인

---

## 4. 통합테스트 케이스

| ID | 시나리오명 | 사전 조건 | 테스트 단계 | 기대 결과 | 실제 결과 | 상태 |
|----|-----------|-----------|-------------|-----------|-----------|------|
| ITC-001 | 배합비율 추천 End-to-End | Backend/Frontend 기동, gradient_boosting 모델 학습 완료 | 1. 배합 추천 탭 이동<br>2. 공정 온도 250, 시간 45, 공급사 SUP_A, 모델 gradient_boosting 입력<br>3. "추천 실행" 클릭<br>4. 결과 확인 | HTTP 200, SN/AG/CU/PB 비율 표시, 합계=100%, 예측 품질점수 함께 표시 | SN:62.1%, AG:3.0%, CU:0.5%, PB:34.4%, 합계=100.0%, 예측점수=83.7점 정상 표시 | PASS |
| ITC-002 | 품질예측 End-to-End | Backend/Frontend 기동, gradient_boosting 모델 학습 완료 | 1. 품질 예측 탭 이동<br>2. SN=62, AG=3, CU=0.5, PB=34.5, 온도=250, 시간=45, SUP_A 입력<br>3. "예측 실행" 클릭<br>4. 결과 확인 | HTTP 200, 품질점수 float 반환, UI에 점수 및 불량 여부(75점 미만) 표시 | 품질점수=83.4점, "양호" 판정 UI 표시 | PASS |
| ITC-003 | EDA 데이터 로드 및 차트 표시 | Backend/Frontend 기동, 학습 데이터 파일 존재 | 1. EDA 분석 탭 이동<br>2. 페이지 로드 대기<br>3. 성분 분포, 상관관계, 편차 차트 확인 | 300 LOT 기반 히스토그램, 산포도, 편차 차트가 정상 렌더링됨 | SN/AG/CU/PB 분포 히스토그램, 상관관계 히트맵, 목표값 대비 편차 박스플롯 정상 표시 | PASS |
| ITC-004 | 모델 현황 로드 | Backend 기동, 최소 1개 모델 학습 완료 | 1. 모델 현황 탭 이동<br>2. 모델 목록 및 성능지표 확인<br>3. 피처 중요도 차트 확인 | 학습된 모델별 MAE/RMSE/R²/MAPE 표시, 피처 중요도 막대그래프 렌더링 | GradientBoosting(RMSE=3.05, R²=0.627), RandomForest(RMSE=3.21, R²=0.588) 등 정상 표시. 피처 중요도 상위 5개 시각화 | PASS |
| ITC-005 | DOE 설계 → 시뮬레이션 → 분석 전체 플로우 | Backend/Frontend 기동, gradient_boosting 모델 학습 완료 | 1. DOE 시뮬레이터 탭 이동<br>2. Full Factorial, 인자 3개(온도/시간/공급사), 수준 3개 설정<br>3. "설계 생성" 클릭<br>4. "ML 시뮬레이션 실행" 클릭<br>5. 통계 분석 결과 확인<br>6. 최적 조건 추천 확인 | 27행 설계 행렬 생성 → 27개 시뮬레이션 결과 → ANOVA/주효과 분석 → 최적 조건 1건 추천 | 27행 설계 행렬 생성 완료, ML 시뮬레이션 27회 실행(평균 품질점수=81.2), 주효과 플롯 렌더링, 최적 조건: 온도=260, 시간=50, SUP_A 추천 | PASS |
| ITC-006 | 모델 미학습 시 에러 처리 | Backend 기동, 특정 모델(xgboost) 미학습 상태 | 1. 배합 추천 탭에서 모델을 "xgboost"로 선택<br>2. "추천 실행" 클릭<br>3. 에러 메시지 확인 | HTTP 404 반환, UI에 "모델 파일을 찾을 수 없습니다" 안내 메시지 표시 | HTTP 404, UI 에러 토스트: "xgboost 모델이 학습되지 않았습니다. 모델을 먼저 학습해 주세요." 표시 | PASS |
| ITC-007 | CORS 헤더 검증 | Backend 기동 (allow_origins=["http://localhost:3000"]) | 1. localhost:3000에서 API 호출 (정상 Origin)<br>2. 응답 헤더 확인<br>3. 허가되지 않은 Origin(localhost:9999)으로 호출 시도 | 정상 Origin: CORS 헤더 포함 응답. 비허가 Origin: CORS 오류(403 또는 브라우저 차단) | localhost:3000: Access-Control-Allow-Origin 헤더 포함 정상 응답. localhost:9999: CORS preflight 실패, 브라우저에서 차단 | PASS |
| ITC-008 | 대용량 DOE 설계 (100개 이상 실험) | Backend/Frontend 기동, gradient_boosting 모델 학습 완료 | 1. DOE LHS 방법, 인자 5개, 샘플 수=120 설정<br>2. "설계 생성" 클릭<br>3. "ML 시뮬레이션 실행" 클릭<br>4. 응답시간 및 완료 여부 확인 | 120행 LHS 행렬 생성 → 120회 ML 시뮬레이션 → 결과 테이블 정상 표시 (30초 이내) | 120행 생성 완료, ML 시뮬레이션 120회 소요 시간=8.3초, 결과 테이블 정상 렌더링 | PASS |
| ITC-009 | 성분 합계 100% 검증 (프론트 Zod) | Frontend 기동 | 1. 품질 예측 탭에서 SN=70, AG=20, CU=5, PB=10 입력 (합계=105)<br>2. "예측 실행" 클릭 전 유효성 확인 | Frontend Zod 스키마에서 합계 검증 실패, "성분 합계는 100%여야 합니다" 에러 메시지 표시, API 미호출 | Zod refinement 작동, "SN+AG+CU+PB 합계가 105%입니다. 합계를 100%로 맞춰 주세요." 인라인 에러 표시. API 호출 없음 | PASS |
| ITC-010 | 공급사별 배합비율 차이 검증 | Backend/Frontend 기동, gradient_boosting 모델 학습 완료 | 1. 배합 추천 탭에서 온도=250, 시간=45 고정<br>2. SUP_A로 추천 실행 → 결과 기록<br>3. SUP_B로 추천 실행 → 결과 비교<br>4. SUP_C로 추천 실행 → 결과 비교 | 3개 공급사 결과가 서로 다름. SUPPLIER_EFFECTS 편차 반영 | SUP_A: SN=62.1, AG=3.0, CU=0.5. SUP_B: SN=62.3, AG=2.9, CU=0.48. SUP_C: SN=61.8, AG=3.1, CU=0.52. 공급사 간 차이 존재 | PASS |
| ITC-011 | 네트워크 지연 시 로딩 UI 표시 | Frontend 기동, Backend 응답 지연 시뮬레이션 (Chrome DevTools Network Throttle) | 1. Slow 3G 네트워크 조건 설정<br>2. 배합 추천 실행<br>3. 응답 대기 중 UI 상태 확인 | API 응답 대기 중 로딩 스피너 표시, 버튼 비활성화 | 로딩 스피너 정상 표시, 추천 버튼 disabled 처리, 응답 수신 후 스피너 제거 및 결과 표시 | PASS |
| ITC-012 | 모든 DOE 방법 설계 생성 검증 | Backend 기동 | 1. Full Factorial / Fractional Factorial / CCD / Box-Behnken / Taguchi / LHS 각각 API 호출<br>2. 각 방법의 설계 행렬 반환 확인 | 6가지 방법 모두 HTTP 200 반환, 설계 행렬 shape 정상 | Full Factorial(27행), Fractional(8행), CCD(13행), Box-Behnken(15행), Taguchi(9행), LHS(50행) 모두 정상 반환 | PASS |
| ITC-013 | 품질점수 경계값 (불량 기준 75점) | Backend/Frontend 기동, gradient_boosting 모델 학습 완료 | 1. 불량 유도 입력값으로 예측 실행 (낮은 SN 비율, 극단 온도)<br>2. 결과에서 불량 판정 UI 확인 | 품질점수 < 75점 시 "불량 위험" 경고 UI 표시 (색상 강조 등) | 품질점수=68.2점, UI에 빨간색 "불량 위험 (기준: 75점 미만)" 배지 표시 | PASS |
| ITC-014 | 연속 다중 요청 처리 | Backend 기동 | 1. 배합 추천 API를 10회 연속 호출 (httpx 비동기)<br>2. 모든 응답 상태 및 결과 확인 | 10회 모두 HTTP 200 반환, 응답 일관성 유지, 서버 크래시 없음 | 10/10 HTTP 200, 동일 입력 대비 동일 출력, 평균 응답시간=0.87초 | PASS |
| ITC-015 | Frontend 새로고침 후 상태 복원 | Frontend 기동 | 1. 배합 추천 결과 확인 후 브라우저 F5 새로고침<br>2. 이전 입력값/결과 유지 여부 확인 | 새로고침 후 이전 결과는 초기화됨(의도된 동작). 입력 폼은 기본값으로 복원 | 새로고침 후 결과 초기화, 입력 폼 기본값(온도=250, 시간=45, SUP_A) 복원 | PASS |

---

## 5. 성능 테스트 결과

### 5.1 API 응답시간 측정 (10회 평균, localhost 환경)

| API | 응답 시간(평균) | 응답 시간(P95) | 목표 | 결과 |
|-----|----------------|----------------|------|------|
| POST /api/recommend | 0.87초 | 1.12초 | 3초 이내 | PASS |
| POST /api/predict | 0.23초 | 0.31초 | 1초 이내 | PASS |
| GET /api/eda/summary | 0.41초 | 0.58초 | 2초 이내 | PASS |
| GET /api/eda/distributions | 0.55초 | 0.72초 | 2초 이내 | PASS |
| GET /api/models/status | 0.34초 | 0.45초 | 2초 이내 | PASS |
| POST /api/doe/design | 0.18초 | 0.24초 | 1초 이내 | PASS |
| POST /api/doe/simulate (27건) | 1.92초 | 2.31초 | 5초 이내 | PASS |
| POST /api/doe/simulate (120건) | 8.30초 | 9.15초 | 30초 이내 | PASS |

### 5.2 메모리 사용량
| 항목 | 측정값 | 비고 |
|------|--------|------|
| Backend 기동 후 초기 메모리 | 약 420MB | GradientBoosting 모델 로드 포함 |
| 연속 10회 요청 후 메모리 | 약 435MB | 메모리 누수 없음 |

---

## 6. 결함 목록 및 처리

### 6.1 발견 결함

| 결함 ID | 발견 케이스 | 현상 | 심각도 | 원인 | 조치 내용 | 상태 |
|---------|-------------|------|--------|------|-----------|------|
| BUG-001 | ITC-009 초기 수행 시 | 성분 합계 검증 메시지가 영어로 표시됨 ("Sum must be 100") | 낮음 | Frontend i18n 미적용 | 에러 메시지 한국어로 수정 | 완료 |
| BUG-002 | ITC-006 초기 수행 시 | 미학습 모델 선택 시 HTTP 500 반환 (404 기대) | 중간 | Backend 예외 처리 미흡 | FileNotFoundError → HTTPException(404) 처리 추가 | 완료 |

### 6.2 잔존 결함
> 통합테스트 완료 시점 기준 잔존 결함 없음 (0건).

---

## 7. 통합테스트 완료 기준 달성 여부

| 완료 기준 항목 | 목표 | 실적 | 달성 여부 |
|----------------|------|------|-----------|
| 전체 테스트 케이스 통과율 | 95% 이상 | 100% (15/15) | 달성 |
| 크리티컬 시나리오 (ITC-001~005) 통과 | 100% | 100% (5/5) | 달성 |
| API 응답시간 목표 | 모든 API 목표치 이내 | 8개 API 전체 목표 달성 | 달성 |
| CORS 보안 검증 | 비인가 Origin 차단 | 차단 확인 | 달성 |
| 결함 잔존 (심각도 상 이상) | 0건 | 0건 | 달성 |
| Frontend-Backend 연동 | 전 기능 정상 연동 | 5개 기능 전체 연동 확인 | 달성 |
| 에러 처리 | 주요 에러 케이스 처리 | BUG-001, BUG-002 수정 완료 | 달성 |

### 7.1 통합테스트 최종 판정

> **통합테스트 완료 기준 전항목 달성. 다음 단계(시스템테스트/인수테스트) 진행 가능.**

### 7.2 권고 사항
1. 실데이터 교체 후 모델 성능 재측정 및 R² ≥ 0.85 달성 여부 확인 권고
2. 운영 환경 배포 시 CORS origin을 실제 도메인으로 변경 필요
3. DOE 120건 이상 대용량 시뮬레이션 시 비동기 처리(백그라운드 태스크) 도입 검토

---

*본 문서는 Formulation ML 프로젝트 통합테스트 결과를 공식 기록한 문서입니다.*  
*검토자: 개발팀장 | 승인자: PM*
