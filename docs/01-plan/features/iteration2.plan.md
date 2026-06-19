# Plan: DOE Iteration 2 — Tech Debt 해소 & 기능 고도화

**Feature ID**: iteration2  
**상위 Feature**: 실험계획법-DOE (완료, Match Rate 93%)  
**작성일**: 2026-06-17  
**담당**: Formulation ML 팀  
**Phase**: Plan

---

## 1. 배경 및 목적

DOE Iteration 1(Match Rate 93%) 완료 후 식별된 Tech Debt 3건을 해소하고,  
실험계획법 시뮬레이션의 실용성을 높이기 위한 두 번째 개발 사이클.

### Iteration 1 잔여 Gap (Tech Debt)

| # | 항목 | 현재 상태 | 영향도 |
|---|------|-----------|--------|
| TD-1 | `/doe/optimize` 엔드포인트 미구현 | UI 데모 모드 폴백 | 높음 |
| TD-2 | 파레토 차트 `Math.random()` 데모 | 실데이터 미연동 | 중간 |
| TD-3 | 공급사별 효과가 sample_generator에 미반영 | SUP_A/B/C 동일 품질 | 중간 |

---

## 2. 목표 (Goals)

1. **TD-1**: `POST /doe/optimize` 엔드포인트 구현 — scipy SLSQP 제약 최적화로 최적 배합비율 탐색
2. **TD-2**: 파레토 차트 → `/doe/analyze` API 실데이터 연동
3. **TD-3**: 공급사별 성분 편차 효과를 `sample_generator._solder_quality()`에 반영
4. **추가**: DOE 결과 vs 기존 배합 이력 비교 기능 (bonus)

---

## 3. 요구사항 상세

### TD-1: /doe/optimize 엔드포인트

```
POST /doe/optimize
Request:
  {
    "factors": {"sn_pct": {"min":58,"max":68}, ...},
    "model": "xgboost",
    "supplier": "SUP_A",
    "method": "slsqp",        // "slsqp" | "grid" | "lhs_best"
    "n_candidates": 200,       // LHS 후보 수
    "constraint_sum": true     // sn+ag+cu+pb=100 제약
  }
Response:
  {
    "optimal_conditions": {...},
    "predicted_quality": float,
    "top5_candidates": [...],
    "optimization_path": [...]  // 수렴 이력
  }
```

### TD-2: 파레토 차트 실데이터 연동

- `POST /doe/analyze` 응답의 `main_effects`를 파레토 정렬
- 인자별 기여도(SS%) 기준 내림차순 정렬
- 누적 기여도 선(Cumulative %) 오버레이
- `Math.random()` 코드 완전 제거

### TD-3: 공급사 효과 반영

```python
# sample_generator.py _solder_quality() 확장
SUPPLIER_EFFECTS = {
    "SUP_A": {"sn_bias": +0.3,  "noise_mult": 0.8},   # 안정적 고품질
    "SUP_B": {"sn_bias": 0.0,   "noise_mult": 1.0},   # 기준
    "SUP_C": {"sn_bias": -0.5,  "noise_mult": 1.3},   # 변동 큼
}
```

### 추가: 이력 비교

- `GET /doe/compare?lot_count=20` — 기존 `formulation_history.csv` 에서 샘플 로드
- DOE 최적 조건 vs 실이력 품질 산점도 오버레이

---

## 4. 구현 범위

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `src/doe/routes.py` | 추가 | `POST /doe/optimize` 엔드포인트 |
| `src/doe/sample_generator.py` | 수정 | 공급사 효과 + `SUPPLIER_EFFECTS` |
| `src/doe/analysis.py` | 수정 | `pareto_data()` 함수 추가 |
| `static/doe.html` | 수정 | 파레토 차트 실데이터 연동, `/doe/optimize` 연결 |

---

## 5. 우선순위 및 일정

| 우선순위 | 항목 | 예상 공수 |
|----------|------|-----------|
| P0 | TD-1: /doe/optimize | 2~3h |
| P1 | TD-3: 공급사 효과 | 0.5h |
| P1 | TD-2: 파레토 차트 | 1h |
| P2 | 이력 비교 기능 | 1~2h |

**목표 Match Rate**: ≥ 96%

---

## 6. 완료 기준 (Definition of Done)

- [ ] `/doe/optimize` API — 실제 scipy SLSQP 최적화로 품질 최대화 조건 반환
- [ ] 파레토 차트 — `Math.random()` 코드 0건
- [ ] 공급사 효과 — SUP_A/B/C 샘플 품질 점수 통계적 차이 확인 (t-test p<0.05)
- [ ] API 엔드포인트 단위 테스트 통과
- [ ] Gap Analysis ≥ 96%

---

## 7. 의존성

- scipy (이미 requirements.txt에 포함)
- 기존 `src/models/optimize.py`의 `recommend_ratios()` 참조 가능
- `data/raw/formulation_history.csv` (이력 비교용)

---

## 8. 리스크

| 리스크 | 대응 |
|--------|------|
| SLSQP 수렴 실패 | 초기값 다변화 + fallback to LHS best |
| 합계 제약(100%) 위반 | pb_pct로 잔여 할당 |
| 이력 CSV 컬럼 불일치 | loader.py load_raw() 활용 |
