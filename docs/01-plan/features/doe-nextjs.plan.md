# Plan: doe-nextjs (Iteration 4)

> 작성일: 2026-06-19  
> 담당: Formulation ML 팀  
> 상태: 🔄 진행 중

---

## 1. 배경 및 목적

`static/doe.html` (2077줄, Vanilla JS) → **Next.js 14 컴포넌트** 전환.  
기존 DOE 기능(6가지 설계법, ML 시뮬레이션, 통계 분석, 최적화)을 React + Recharts로 재구현하여  
`frontend/app/doe/` 페이지로 통합한다.

---

## 2. 현재 상태 (As-Is)

| 항목 | 상태 | 비고 |
|------|------|------|
| `static/doe.html` | ✅ 동작 중 | 2077줄, Vanilla JS, Bootstrap 의존 |
| DOE FastAPI 라우터 | ✅ 완성 | 7개 엔드포인트 (`/doe/methods`, `/design`, `/simulate`, `/analyze`, `/optimize`, `/compare`, `/sample`) |
| `frontend/app/doe/` | ❌ 없음 | Next.js 페이지 미존재 |
| 홈 카드 링크 | ❌ 없음 | `/` 홈에 DOE 카드 없음 |

---

## 3. 목표 (To-Be)

`http://localhost:3000/doe` 에서 기존 `static/doe.html`의 핵심 기능 4가지를 사용할 수 있다.

---

## 4. 요구사항

### FR-01: DOE 타입 정의
**파일**: `frontend/types/doe.ts`

```typescript
// 6가지 DOE 방법 메타데이터
interface DoeMethodMeta { name, description, recommended_factors, typical_experiments, pros, cons }
// 설계 행렬 생성 응답
interface DesignResponse { method, method_name, n_experiments, design_matrix: Record<string,number>[] }
// 시뮬레이션 응답
interface SimulateResponse { simulated_data, summary: {mean,std,min,max,n_experiments}, optimal_point }
// 분석 응답
interface AnalyzeResponse { main_effects, interactions, anova_table, r_squared, optimal_conditions }
// 최적화 응답
interface OptimizeResponse { optimal_conditions, top5_candidates, method, model }
```

### FR-02: DOE API 클라이언트
**파일**: `frontend/lib/doe-api.ts`

- `fetchDoeMethods()` → `GET /doe/methods`
- `createDesign(req)` → `POST /doe/design`
- `simulateDoe(req)` → `POST /doe/simulate`
- `analyzeDoe(req)` → `POST /doe/analyze`
- `optimizeDoe(req)` → `POST /doe/optimize`
- `fetchDoeSample(method, n_points)` → `GET /doe/sample`

### FR-03: DOE 메인 페이지 — 4개 탭 구조
**파일**: `frontend/app/doe/page.tsx`

```
/doe 페이지
├── 탭 1: 설계 (Design) — 방법 선택 + 인자 설정 + 설계 행렬 생성
├── 탭 2: 시뮬레이션 (Simulate) — ML 모델 예측 + 산점도 차트
├── 탭 3: 분석 (Analyze) — 주효과 바 차트 + ANOVA 테이블
└── 탭 4: 최적화 (Optimize) — SLSQP/LHS 최적화 + 상위 5개 후보
```

### FR-04: Design 탭
**컴포넌트**: `frontend/components/doe/DoeMethodCard.tsx`, `FactorEditor.tsx`

- `GET /doe/methods` 로드 → 6개 방법 카드 표시
- 인자 설정 폼: sn_pct/ag_pct/cu_pct 기본값 + min/max/levels 편집 가능
- `POST /doe/design` 호출 → 설계 행렬 테이블 표시
- 생성된 설계 행렬은 시뮬레이션 탭으로 전달

### FR-05: Simulate 탭
**컴포넌트**: `frontend/components/doe/SimulationChart.tsx`

- 공정 조건 입력 (temperature, process_time, supplier, model)
- `POST /doe/simulate` 호출
- 결과 산점도: sn_pct vs predicted_quality (Recharts `ScatterChart`)
- 요약 통계 카드 (mean/std/min/max/n_experiments)
- 최적 포인트 강조 표시

### FR-06: Analyze 탭
**컴포넌트**: `frontend/components/doe/MainEffectsBar.tsx`, `AnovaTable.tsx`

- `POST /doe/analyze` 호출 (시뮬레이션 결과 활용)
- 주효과 수평 막대 차트 (절댓값 기준 정렬, Recharts `BarChart`)
- ANOVA 테이블 (Model/Error/Total rows)
- R² 표시

### FR-07: Optimize 탭
**컴포넌트**: `frontend/components/doe/OptimizePanel.tsx`

- 방법 선택: SLSQP / LHS
- `POST /doe/optimize` 호출
- 최적 조건 강조 카드
- 상위 5개 후보 테이블 (`predicted_quality` 기준 정렬)

### FR-08: 홈 카드 추가
**파일**: `frontend/app/page.tsx`

- 홈의 `FEATURE_CARDS` 배열에 DOE 카드 추가
- `href: "/doe"`, 아이콘: `FlaskConical` (또는 `TestTube2`)

---

## 5. 구현 우선순위

| 우선순위 | FR | 예상 소요 |
|---------|-----|----------|
| P0 | FR-01: 타입 정의 | 20분 |
| P0 | FR-02: API 클라이언트 | 20분 |
| P0 | FR-03: 페이지 탭 구조 | 30분 |
| P1 | FR-04: Design 탭 | 40분 |
| P1 | FR-05: Simulate 탭 | 40분 |
| P1 | FR-06: Analyze 탭 | 30분 |
| P1 | FR-07: Optimize 탭 | 30분 |
| P2 | FR-08: 홈 카드 | 10분 |

---

## 6. 비기능 요구사항

- `static/doe.html` 제거하지 않음 (레거시 참조용 유지)
- 탭 간 데이터 공유: React state (`useState`) — 설계 행렬 → 시뮬레이션 → 분석 순서로 전달
- 에러 처리: 모델 미학습 시 `ErrorAlert` 표시 + "모델 학습 필요" 안내
- TypeScript 타입 체크 통과 (`tsc --noEmit`)

---

## 7. 완료 기준

- [ ] `frontend/app/doe/page.tsx` 존재 + 4개 탭 렌더링
- [ ] `GET /doe/methods` 연동 → 6개 방법 카드 표시
- [ ] `POST /doe/design` 연동 → 설계 행렬 테이블 표시
- [ ] `POST /doe/simulate` 연동 → 산점도 + 요약 통계
- [ ] `POST /doe/analyze` 연동 → 주효과 차트 + ANOVA 테이블
- [ ] `POST /doe/optimize` 연동 → 최적 조건 + 상위 5개 후보
- [ ] 홈 `/` 에 DOE 카드 추가
- [ ] TypeScript 타입 체크 통과

---

## 8. 관련 파일

| 파일 | 작업 |
|------|------|
| `frontend/types/doe.ts` | 신규 생성 |
| `frontend/lib/doe-api.ts` | 신규 생성 |
| `frontend/app/doe/page.tsx` | 신규 생성 |
| `frontend/components/doe/*.tsx` | 신규 생성 (5개 컴포넌트) |
| `frontend/app/page.tsx` | DOE 카드 추가 |
| `static/doe.html` | 변경 없음 (유지) |
