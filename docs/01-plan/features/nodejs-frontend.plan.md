# Plan: nodejs-frontend (Iteration 3)

> 작성일: 2026-06-19  
> 담당: Formulation ML 팀  
> 상태: 🔄 진행 중

---

## 1. 배경 및 목적

Streamlit 대시보드(`streamlit_app.py`)를 **Next.js 14 + FastAPI** 아키텍처로 전환한다.  
`frontend/` 디렉토리에 Next.js 14 프로젝트가 이미 구현되어 있으나, FastAPI 응답 형식과의 불일치 및 일부 미구현 엔드포인트로 인해 실제 동작이 안 되는 상태다.

---

## 2. 현재 상태 (As-Is)

| 항목 | 상태 | 비고 |
|------|------|------|
| `frontend/` Next.js 14 프로젝트 | ✅ 구현 완료 | 4개 페이지, Recharts 차트 |
| `GET /models` 응답 형식 | ❌ 불일치 | API: `{name:{trained}}` / Frontend: `ModelInfo[]` |
| `POST /recommend` 응답 형식 | ❌ 불일치 | API: `{input, recommendation}` / Frontend: `RecommendResponse` |
| `POST /predict` 응답 형식 | ❌ 불일치 | API: `{predictions:[{index,quality}]}` / Frontend: `{predicted_quality}` |
| `GET /eda/stats` | ❌ 미구현 | EDA 페이지 더미 데이터 사용 중 |
| FastAPI CORS | ❌ 미설정 | Next.js(3000) → FastAPI(8000) 크로스오리진 차단 |
| `RecommendRequest` 필드명 | ❌ 불일치 | Frontend: `temperature/process_time` / API: `melt_temp_c/melt_time_min` |

---

## 3. 목표 (To-Be)

1. FastAPI 응답/요청 스키마를 frontend `types/index.ts` 타입과 완전히 일치시킨다.
2. CORS 미들웨어 추가로 `http://localhost:3000` 요청을 허용한다.
3. `GET /eda/stats` 엔드포인트를 구현해 EDA 페이지 더미 데이터를 제거한다.
4. `npm run dev`로 Next.js 실행 → 4개 페이지 정상 동작 확인.

---

## 4. 요구사항

### FR-01: GET /models 응답 형식 수정
```json
[
  {
    "name": "gradient_boosting",
    "metrics": {"mae": 2.1, "rmse": 3.05, "r2": 0.627, "mape": 2.78},
    "feature_importances": [{"feature": "sn_pct", "importance": 0.32}, ...],
    "trained_at": "2026-06-19T10:00:00Z"
  }
]
```

### FR-02: POST /recommend 응답 형식 수정
```json
{
  "recommended_ratios": {"sn": 62.1, "ag": 3.0, "cu": 0.5, "pb": 34.4},
  "predicted_quality": 78.5,
  "optimization_success": true,
  "message": null
}
```
- 요청 필드 매핑: `temperature` → `melt_temp_c`, `process_time` → `melt_time_min`

### FR-03: POST /predict 응답 형식 수정
```json
{
  "predicted_quality": 76.3,
  "model_used": "gradient_boosting"
}
```
- 요청 필드: `sn_ratio/ag_ratio/cu_ratio/pb_ratio/temperature/process_time/supplier` → 기존 `records[]` 형식으로 변환

### FR-04: GET /eda/stats 신규 구현
```json
{
  "sn_distribution": [{"range": "58-60", "count": 7}, ...],
  "sn_vs_quality": [{"sn": 62.1, "quality": 78.5}, ...],
  "ag_distribution": [...],
  "cu_distribution": [...],
  "stats": {"total_lots": 200, "mean_quality": 75.2, "std_quality": 3.1}
}
```
- 학습 데이터 `formulation_history.csv` 기반. 파일 없으면 샘플 생성.

### FR-05: FastAPI CORS 추가
- `http://localhost:3000` allow origins
- `fastapi.middleware.cors.CORSMiddleware` 적용

### FR-06: EDA 페이지 더미 데이터 → 실 API 연동
- `frontend/app/eda/page.tsx` — `useEffect`로 `GET /eda/stats` 호출
- `frontend/lib/api.ts` — `fetchEdaStats()` 함수 추가

---

## 5. 구현 우선순위

| 우선순위 | 항목 | 예상 소요 |
|---------|------|----------|
| P0 (필수) | FR-05: CORS 추가 | 5분 |
| P0 (필수) | FR-01: /models 수정 | 30분 |
| P0 (필수) | FR-02: /recommend 수정 | 20분 |
| P0 (필수) | FR-03: /predict 수정 | 20분 |
| P1 (중요) | FR-04: /eda/stats 구현 | 40분 |
| P1 (중요) | FR-06: EDA 페이지 연동 | 20분 |

---

## 6. 비기능 요구사항

- FastAPI 기존 엔드포인트(`/doe/*`, 정적 파일) 동작 유지
- `GET /models` 훈련된 모델 없을 경우 빈 배열 `[]` 반환 (500 에러 방지)
- `GET /eda/stats` `formulation_history.csv` 없을 때 샘플 100개로 자동 생성

---

## 7. 완료 기준

- [ ] `python -m uvicorn app:app --port 8000 --reload` 정상 실행
- [ ] `cd frontend && npm run dev` 정상 실행 (포트 3000)
- [ ] `/` 홈 페이지 4개 카드 렌더링
- [ ] `/recommend` 배합비율 추천 결과 표시
- [ ] `/predict` 품질 예측 결과 표시
- [ ] `/eda` 실데이터 기반 차트 표시 (더미 데이터 제거)
- [ ] `/model` 학습된 모델 지표 표시

---

## 8. 관련 파일

| 수정 대상 | 작업 |
|----------|------|
| `app.py` | CORS, /models, /recommend, /predict 응답 수정, /eda/stats 추가 |
| `frontend/lib/api.ts` | `fetchEdaStats()` 추가, RecommendRequest 필드명 조정 |
| `frontend/app/eda/page.tsx` | 더미 데이터 제거, 실 API 연동 |
| `frontend/types/index.ts` | EdaStats 타입 추가 |
