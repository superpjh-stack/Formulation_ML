# Gap Analysis: DOE Iteration 2

**Feature ID**: iteration2  
**분석일**: 2026-06-18  
**Phase**: Check  
**Match Rate**: 100% (6/6)

---

## 1. 분석 요약

| 항목 | 결과 |
|------|------|
| 총 DoD 항목 | 6 |
| 충족 항목 | 6 |
| Match Rate | **100%** |
| 목표 Match Rate | 96% |
| 판정 | **PASS (목표 초과 달성)** |

---

## 2. DoD 항목별 검증 결과

| # | 항목 | 상태 | 증거 |
|---|------|------|------|
| 1 | `/doe/optimize` API — SLSQP/LHS best 반환 | ✅ | `routes.py` OptimizeRequest + `recommend_ratios()` 연동, predicted_quality=93.458 확인 |
| 2 | 파레토 차트 `Math.random()` 0건 | ✅ | `renderPareto()` — 공분산 기반 SS 계산으로 교체, hardcoded `[18.3,14.2...]` 제거 |
| 3 | ANOVA 테이블 `Math.random()` 0건 | ✅ | `renderAnova()` — 2-pass F-통계량 계산으로 교체 |
| 4 | `SUPPLIER_EFFECTS` dict 존재 | ✅ | `sample_generator.py` SUP_A/B/C 각각 sn_bias, ag_bias, cu_bias, noise_mult 정의 |
| 5 | `generate_sample_doe_data()` 공급사별 품질 분기 | ✅ | 공급사 배열 순환 후 그룹별 `_solder_quality()` 호출 |
| 6 | API 기본 동작 확인 | ✅ | `/doe/sample`, `/doe/analyze`, `/doe/optimize` HTTP 200 확인 |

---

## 3. 변경 파일 목록

| 파일 | 변경 유형 | 주요 내용 |
|------|-----------|-----------|
| `src/doe/routes.py` | 추가 | `POST /doe/optimize` (SLSQP + lhs_best), `OptimizeRequest` 스키마 |
| `src/doe/sample_generator.py` | 수정 | `SUPPLIER_EFFECTS`, `_solder_quality(supplier=)`, 공급사 순환 배정 |
| `static/doe.html` | 수정 | `renderPareto()` 실계산 교체, `renderAnova()` Math.random() 제거 |
| `app.py` | 수정 | lifespan `✓` → `[OK]` (CP949 UnicodeEncodeError 해결) |
| `requirements.txt` | 수정 | fastapi `>=0.130.0` (Starlette 1.3.1 호환) |

---

## 4. 잔여 Gap

없음. 모든 DoD 항목 충족.

---

## 5. 결론

Iteration 2 목표 Match Rate 96%를 초과한 **100%** 달성.  
`/pdca report iteration2` 를 실행하여 완료 보고서를 생성할 수 있습니다.
