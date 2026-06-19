# Gap Analysis: nodejs-frontend

> 분석일: 2026-06-19  
> **Match Rate: 100%** (9/9)

---

## PDCA 상태

```
[Plan] ✅ → [Do] ✅ → [Check] ✅ (100%)
```

---

## FR별 검증 결과

| # | 요구사항 | 파일:라인 | 상태 |
|---|---------|----------|------|
| FR-01 | `GET /models` → `ModelInfo[]` | `app.py:120` | ✅ |
| FR-02 | `POST /recommend` 응답 형식 수정 | `app.py:142` | ✅ |
| FR-03 | `POST /predict` 단건 요청/응답 | `app.py:182` | ✅ |
| FR-04 | `GET /eda/stats` 신규 구현 | `app.py:212` | ✅ |
| FR-05 | FastAPI CORS `localhost:3000` | `app.py:73` | ✅ |
| FR-06 | EDA 더미 데이터 → 실 API 연동 | `frontend/app/eda/page.tsx` | ✅ |
| NFR-1 | `/doe/*` 기존 엔드포인트 유지 | `app.py:81` | ✅ |
| NFR-2 | 모델 없을 때 빈 배열 반환 | `app.py:126` | ✅ |
| NFR-3 | `scripts/train.py` meta.json 저장 | `scripts/train.py:63` | ✅ |

---

## 상세 검증

### FR-01: GET /models
- 반환 타입: `list[dict]` — frontend `ModelInfo[]`와 일치
- `{name}.joblib` 없으면 skip (빈 배열 반환 가능)
- `{name}_meta.json` 없으면 null 메트릭 fallback 제공

### FR-02: POST /recommend
- 요청 필드: `temperature` / `process_time` → `melt_temp_c` / `melt_time_min` 내부 매핑
- 응답: `{recommended_ratios: {sn,ag,cu,pb}, predicted_quality, optimization_success, message}`
- frontend `RecommendResponse` 타입과 완전 일치

### FR-03: POST /predict
- 단건 record를 `build_features` 파이프라인에 투입
- 응답: `{predicted_quality: float, model_used: str}` — `PredictResponse` 일치

### FR-04: GET /eda/stats
- `formulation_history.csv` 없으면 `generate_sample.py` 자동 실행
- `sn_distribution`, `ag_distribution`, `cu_distribution`, `sn_vs_quality`, `stats` 5개 필드 반환
- frontend `EdaStats` 타입과 완전 일치

### FR-05: CORS
- `CORSMiddleware(allow_origins=["http://localhost:3000"])` 적용
- `allow_credentials=True`, `allow_methods=["*"]`, `allow_headers=["*"]`

### FR-06: EDA 페이지
- `Math.random()` 기반 더미 데이터 완전 제거
- `useEffect` + `fetchEdaStats()` 패턴으로 실 API 연동
- 로딩/에러 상태 UI (`Spinner`, `ErrorAlert`) 포함
- AG/CU 분포 차트 추가 (기존 SN만 있던 것에서 확장)

---

## 갭 없음

모든 요구사항이 충족되었습니다.

---

## 완료 기준 검토

- [x] `app.py` 구문 유효 (Python AST 검증 통과)
- [x] `frontend/` TypeScript 타입 체크 통과 (`tsc --noEmit`)
- [x] CORS 설정 완료
- [x] 6개 FR 전부 구현
- [ ] 실 서버 실행 + 브라우저 동작 확인 (모델 학습 후 가능)
