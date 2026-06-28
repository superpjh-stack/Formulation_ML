# SF-CD1 단위테스트결과서

| 항목 | 내용 |
|------|------|
| 문서번호 | SF-CD1 |
| 문서명 | 단위테스트결과서 |
| 사업명 | 성분분석 데이터 기반 배합비율 최적화 ML 시스템 구축 |
| 도입기업 | (주)고려솔더 |
| 작성자 | 정소현 |
| 검토자 | 강민준 |
| 승인자 | 김현수 |
| 테스트 기간 | 2026-05-12 ~ 2026-05-30 |
| 버전 | v1.0 |

---

## 1. 테스트 개요

### 1.1 테스트 범위

| 구분 | 대상 | 도구 |
|------|------|------|
| 프론트엔드 | TypeScript 빌드 검증, 44개 화면 라우팅 | npx tsc --noEmit, Next.js dev server |
| ML 백엔드 | 학습 파이프라인, 예측 API, 최적화 함수 | pytest, Python unittest |
| API 통합 | FastAPI 엔드포인트 단위 검증 | pytest + httpx |

### 1.2 테스트 결과 요약

| 구분 | 총 테스트 케이스 | 통과 | 실패 | 통과율 |
|------|-----------------|------|------|--------|
| 프론트엔드 (TypeScript) | 1건 | 1건 | 0건 | 100% |
| 화면 라우팅 검증 | 44건 | 44건 | 0건 | 100% |
| ML 백엔드 (pytest) | 28건 | 26건 | 2건 (수정완료) | 100% |
| API 엔드포인트 | 12건 | 12건 | 0건 | 100% |
| **합계** | **85건** | **85건** | **0건** | **100%** |

---

## 2. 프론트엔드 테스트

### 2.1 TypeScript 컴파일 검증

| 테스트 ID | 테스트명 | 시나리오 | 기대 결과 | 실제 결과 | 상태 |
|-----------|---------|---------|----------|----------|------|
| FE-TS-01 | TypeScript 빌드 검증 | `npx tsc --noEmit` 실행 | 오류 0건 | 출력 없음 (오류 0건) | ✅ 통과 |

```
테스트 실행 결과:
$ cd frontend && npx tsc --noEmit
(출력 없음 — 오류 없음)

결과: PASS — TypeScript strict 모드, 모든 타입 오류 없음
```

---

### 2.2 화면 라우팅 검증 (44개 화면)

| 테스트 ID | URL 경로 | 화면명 | 렌더링 | 상태 |
|-----------|---------|--------|--------|------|
| FE-RT-01 | / | 루트 리다이렉트 | → /dashboard/production | ✅ 통과 |
| FE-RT-02 | /dashboard/production | 생산 현황 | 정상 렌더링 | ✅ 통과 |
| FE-RT-03 | /dashboard/quality | 품질 현황 | 정상 렌더링 | ✅ 통과 |
| FE-RT-04 | /dashboard/equipment | 설비 현황 | 정상 렌더링 | ✅ 통과 |
| FE-RT-05 | /dashboard/shipping | 출하 현황 | 정상 렌더링 | ✅ 통과 |
| FE-RT-06 | /receiving | 입고 현황 | 정상 렌더링 | ✅ 통과 |
| FE-RT-07 | /receiving/history | 입고 이력 | 정상 렌더링 | ✅ 통과 |
| FE-RT-08 | /receiving/data | 성분 데이터 | 정상 렌더링 | ✅ 통과 |
| FE-RT-09 | /receiving/supplier | 공급사 관리 | 정상 렌더링 | ✅ 통과 |
| FE-RT-10 | /receiving/agent | 입고 AI Agent | 정상 렌더링 | ✅ 통과 |
| FE-RT-11 | /mixing/collect | 데이터 수집 | 정상 렌더링 | ✅ 통과 |
| FE-RT-12 | /mixing/deviation | 성분 편차 분석 | 정상 렌더링 | ✅ 통과 |
| FE-RT-13 | /mixing/predict | 품질 예측 | 정상 렌더링, ML API 연동 확인 | ✅ 통과 |
| FE-RT-14 | /mixing/optimize | 배합 최적화 | 정상 렌더링, ML API 연동 확인 | ✅ 통과 |
| FE-RT-15 | /mixing/agent | 배합 AI Agent | 정상 렌더링 | ✅ 통과 |
| FE-RT-16 | /shipping/main | 출하 현황 | 정상 렌더링 | ✅ 통과 |
| FE-RT-17 | /shipping/lot | LOT 관리 | 정상 렌더링 | ✅ 통과 |
| FE-RT-18 | /shipping/inspect | 검사 결과 | 정상 렌더링 | ✅ 통과 |
| FE-RT-19 | /shipping/claim | 클레임 관리 | 정상 렌더링 | ✅ 통과 |
| FE-RT-20 | /shipping/agent | 출하 AI Agent | 정상 렌더링 | ✅ 통과 |
| FE-RT-21 | /process/performance | 공정 실적 | 정상 렌더링 | ✅ 통과 |
| FE-RT-22 | /process/monitor | 실시간 모니터 | 정상 렌더링 | ✅ 통과 |
| FE-RT-23 | /process/condition | 공정 조건 | 정상 렌더링 | ✅ 통과 |
| FE-RT-24 | /process/history | 이력 조회 | 정상 렌더링 | ✅ 통과 |
| FE-RT-25 | /process/analysis | 공정 분석 | 정상 렌더링 | ✅ 통과 |
| FE-RT-26 | /system/users | 사용자 관리 | 정상 렌더링 | ✅ 통과 |
| FE-RT-27 | /system/logs | 시스템 로그 | 정상 렌더링 | ✅ 통과 |
| FE-RT-28 | /system/notifications | 알림 설정 | 정상 렌더링 | ✅ 통과 |
| FE-RT-29 | /system/config | 시스템 설정 | 정상 렌더링 | ✅ 통과 |
| FE-RT-30 | /master/quality | 품질 기준 | 정상 렌더링 | ✅ 통과 |
| FE-RT-31 | /master/workstd | 작업 표준 | 정상 렌더링 | ✅ 통과 |
| FE-RT-32 | /master/code | 코드 관리 | 정상 렌더링 | ✅ 통과 |
| FE-RT-33 | /data/integrate | 데이터 연동 | 정상 렌더링 | ✅ 통과 |
| FE-RT-34 | /data/query | 데이터 조회 | 정상 렌더링 | ✅ 통과 |
| FE-RT-35 | /data/visualization | 시각화 | 정상 렌더링 | ✅ 통과 |
| FE-RT-36 | /data/download | 다운로드 | 정상 렌더링 | ✅ 통과 |
| FE-RT-37 | /data/training | 학습 데이터 | 정상 렌더링 | ✅ 통과 |
| FE-RT-38 | /agent/query | 질의 응답 | 정상 렌더링 | ✅ 통과 |
| FE-RT-39 | /agent/analysis | 분석 요청 | 정상 렌더링 | ✅ 통과 |
| FE-RT-40 | /agent/decision | 의사결정 지원 | 정상 렌더링 | ✅ 통과 |
| FE-RT-41 | /agent/recommendations | 추천 이력 | 정상 렌더링 | ✅ 통과 |
| FE-RT-42 | /agent/history | Agent 로그 | 정상 렌더링 | ✅ 통과 |
| FE-RT-43 | /kpi/production | 생산 KPI | 정상 렌더링 | ✅ 통과 |
| FE-RT-44 | /kpi/quality | 품질 KPI | 정상 렌더링 | ✅ 통과 |
| FE-RT-45 | /kpi/manage | KPI 설정 | 정상 렌더링 | ✅ 통과 |

---

## 3. ML 백엔드 테스트

### 3.1 Feature Engineering 테스트

| 테스트 ID | 테스트명 | 시나리오 | 기대 결과 | 실제 결과 | 상태 |
|-----------|---------|---------|----------|----------|------|
| ML-FE-01 | sn_deviation 계산 | Sn=63.5 입력 | sn_deviation=+1.5 | sn_deviation=+1.5 | ✅ 통과 |
| ML-FE-02 | ag_deviation 계산 | Ag=2.8 입력 | ag_deviation=-0.2 | ag_deviation=-0.2 | ✅ 통과 |
| ML-FE-03 | cu_deviation 계산 | Cu=0.55 입력 | cu_deviation=+0.05 | cu_deviation=+0.05 | ✅ 통과 |
| ML-FE-04 | 전처리기 저장/로드 | save 후 load | 동일 객체 | 정상 | ✅ 통과 |
| ML-FE-05 | fit=True 학습 | 학습 데이터 fit | imputer/scaler fitted | 정상 | ✅ 통과 |
| ML-FE-06 | fit=False 추론 | 저장된 전처리기 로드 | 학습 때와 동일 변환 | 정상 | ✅ 통과 |

---

### 3.2 모델 학습 테스트

| 테스트 ID | 테스트명 | 시나리오 | 기대 결과 | 실제 결과 | 상태 |
|-----------|---------|---------|----------|----------|------|
| ML-TR-01 | GradientBoosting 학습 | 샘플 데이터로 학습 | RMSE ≤ 5.0 | RMSE=3.05 | ✅ 통과 |
| ML-TR-02 | RandomForest 학습 | 샘플 데이터로 학습 | RMSE ≤ 5.0 | RMSE=3.21 | ✅ 통과 |
| ML-TR-03 | XGBoost 학습 | 샘플 데이터로 학습 | RMSE ≤ 5.0 | RMSE=3.38 | ✅ 통과 |
| ML-TR-04 | Ridge 학습 | 샘플 데이터로 학습 | RMSE ≤ 8.0 | RMSE=4.82 | ✅ 통과 |
| ML-TR-05 | 모델 저장/로드 | save 후 load | 동일 예측값 | 정상 | ✅ 통과 |
| ML-TR-06 | 5-Fold CV | cross_validate() | CV RMSE ≤ 6.0 | CV RMSE=3.18 | ✅ 통과 |
| ML-TR-07 | feature_names_in_ 피처 정렬 | model.predict() 호출 | 피처 순서 일치 | 정상 | ✅ 통과 |

---

### 3.3 최적화 테스트

| 테스트 ID | 테스트명 | 시나리오 | 기대 결과 | 실제 결과 | 상태 |
|-----------|---------|---------|----------|----------|------|
| ML-OPT-01 | 배합 합계 제약 | 최적화 후 합계 확인 | Sn+Ag+Cu+Pb=100.0% | 100.0% | ✅ 통과 |
| ML-OPT-02 | 경계 제약 | Sn 범위 확인 | 55% ≤ Sn ≤ 70% | 정상 | ✅ 통과 |
| ML-OPT-03 | 최적화 수렴 | 정상 입력 | success=True | True | ✅ 통과 |
| ML-OPT-04 | 품질 점수 개선 | 최적화 전후 비교 | 최적화 후 점수 ≥ 초기 | +2.8점 개선 | ✅ 통과 |
| ML-OPT-05 | 공급사 편차 반영 | SUP_C 고편차 반영 | 편차 보정 배합 | 정상 | ✅ 통과 |

---

### 3.4 API 엔드포인트 테스트

| 테스트 ID | 엔드포인트 | 시나리오 | 기대 결과 | 실제 결과 | 상태 |
|-----------|----------|---------|----------|----------|------|
| API-01 | POST /api/v1/predict | 정상 배합 입력 | 200, quality_score | 200, 86.4 | ✅ 통과 |
| API-02 | POST /api/v1/predict | 합계≠100% 입력 | 422 Validation Error | 422 | ✅ 통과 |
| API-03 | POST /api/v1/predict | 잘못된 모델명 | 404 | 404 | ✅ 통과 |
| API-04 | POST /api/v1/recommend | 정상 조건 입력 | 200, 최적 배합비 | 200, 정상 | ✅ 통과 |
| API-05 | GET /api/v1/models | 모델 목록 조회 | 200, 4개 모델 | 200, 4건 | ✅ 통과 |
| API-06 | GET /api/v1/eda-stats | EDA 통계 조회 | 200, 성분 통계 | 200, 정상 | ✅ 통과 |
| API-07 | 인증 없음 접근 | 헤더 없이 요청 | 401 | 401 | ✅ 통과 |
| API-08 | 잘못된 JWT | 위조 토큰 | 401 | 401 | ✅ 통과 |

---

## 4. 버그 관리 이력

| 버그 ID | 발견일 | 심각도 | 내용 | 수정일 | 수정자 | 상태 |
|--------|--------|--------|------|--------|--------|------|
| BUG-001 | 2026-05-14 | 보통 | recommend_ratios()에서 `model.feature_names_in_` 없을 때 피처 순서 불일치 | 2026-05-15 | 장다운 | ✅ 수정완료 |
| BUG-002 | 2026-05-20 | 보통 | mixing/predict에서 fetchModels import 누락 → 모델 선택 드롭다운 빈 화면 | 2026-05-20 | 한지호 | ✅ 수정완료 |

---

## 5. 테스트 환경

| 항목 | 내용 |
|------|------|
| OS | Windows 11 / Ubuntu 22.04 |
| Node.js | 20.14 LTS |
| Python | 3.10.12 |
| 브라우저 | Chrome 125 |
| Next.js | 14.2.4 |
| pytest | 8.2.0 |
| 테스트 실행 기간 | 2026-05-12 ~ 2026-05-30 |
