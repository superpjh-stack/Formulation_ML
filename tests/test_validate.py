"""출력 검증기 V1~V9 — `agent-architecture.md` §4.5.

> 주입은 부탁이고, **검증만이 강제다.**

여기 통과하지 못하는 답변은 사용자에게 가지 않는다. 그래서 이 파일의 테스트가
느슨하면 그만큼 틀린 답이 화면에 뜬다.
"""
from __future__ import annotations

import pytest

from src.agent import validate
from src.agent.rules import RuleSnapshot
from src.agent.validate import Evidence

RULES = RuleSnapshot(
    quality_pass_score=70.0, quality_warn_score=80.0, temp_warn_c=255.0,
    dev_warn_sn=2.0, dev_warn_ag=0.3, dev_warn_cu=0.1,
    sn_target=62.0, ag_target=3.0, cu_target=0.5,
)


def doc(label="작업표준서 WS-KS-001 Rev.0 · WS-02", snippet="용해 온도 340±20") -> Evidence:
    return Evidence(kind="doc", label=label, snippet=snippet, source_ref=label)


def data(count=3) -> Evidence:
    return Evidence(kind="data", label="입고 이력", row_count=count, source_ref="receipt_history:abc")


# ── V1 수치 대조 ────────────────────────────────────────────────────────
def test_v1_blocks_wrong_pass_score():
    v = validate.v1_numbers("품질 합격선은 75점입니다.", RULES)
    assert v and v[0].rule == "V1"


def test_v1_allows_the_canonical_value():
    assert validate.v1_numbers("품질 합격선은 70점입니다.", RULES) == []


def test_v1_allows_the_warn_score_too():
    """80 은 경고선이라 합격선 근방에 같이 나올 수 있다."""
    assert validate.v1_numbers("합격선 70점, 경고 기준 점수 80점입니다.", RULES) == []


def test_v1_blocks_wrong_temperature():
    v = validate.v1_numbers("설비 온도 경고선은 300°C 입니다.", RULES)
    assert v and "300" in v[0].detail


def test_v1_ignores_numbers_far_from_the_keyword():
    """문서 인용에 340 이 나온다고 온도 경고선을 틀리게 말한 것은 아니다."""
    text = "용해로 조업 온도는 340±20°C 입니다. 관련 없는 문장이 길게 이어집니다. " * 2
    assert validate.v1_numbers(text, RULES) == []


def test_v1_does_not_block_xrf_criteria_near_the_word_pass():
    """🔴 회귀 방지 — 이 오탐이 **맞는 답을 막았다** (실측 2026-08-27).

    "XRF 합격 기준이 뭐야?" 에 대한 정답에 `±0.2%`·`3회`·`0.05%` 가 나오는데,
    초판 V1 은 키워드 근방의 **모든 숫자**를 집어서 "합격선을 0.2 로 서술" 이라고
    판정했다. 합격선은 점수이고 XRF 정도관리 기준은 %다 — 단위가 다르면 다른 것을
    말하고 있다.
    """
    answer = (
        "XRF 합격 기준은 3회 평균이 CRM 인증값 ±0.2% 이내이고, "
        "3회 반복 표준편차가 0.05% 이하일 것입니다."
    )
    assert validate.v1_numbers(answer, RULES) == []


def test_v1_still_blocks_a_wrong_score_with_its_unit():
    """단위를 요구하되 **진짜 위반은 여전히 잡아야 한다.**"""
    assert validate.v1_numbers("품질 합격 기준은 75점입니다.", RULES)


def test_v1_ignores_percentages_near_temperature_words():
    assert validate.v1_numbers("온도 경고 발생률은 12% 입니다.", RULES) == []


# ── V2 인용 필수 ────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "SUP_A 의 평균 편차는 0.12% 입니다.",
    "2026-08-27 에 입고됐습니다.",
    "LOT-2026-001 은 합격 처리됐습니다.",
    "총 12건 확인됩니다.",
])
def test_v2_blocks_facts_without_evidence(answer):
    assert validate.v2_citation_required(answer, [])


def test_v2_passes_when_evidence_exists():
    assert validate.v2_citation_required("평균 편차는 0.12% 입니다.", [data()]) == []


def test_v2_allows_a_hedge_without_evidence():
    """수치가 없는 '확인할 수 없습니다' 는 근거 없이도 정당하다 (§4.6)."""
    assert validate.v2_citation_required("확인할 수 없습니다.", []) == []


# ── V3 금칙 수치 ────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "이 모델의 R² 는 0.874 입니다.",
    "R² ≥ 0.85 달성했습니다.",
    "정확도는 95% 입니다.",
])
def test_v3_blocks_forbidden_claims(answer):
    assert validate.v3_forbidden(answer)


def test_v3_allows_the_real_measured_value():
    """SF-TI2 실측 R² 0.782 는 실데이터 근거라 인용해도 된다."""
    assert validate.v3_forbidden("실측 R² 는 0.782 입니다.") == []


# ── V4·V5 배합 ─────────────────────────────────────────────────────────
def test_v4_blocks_out_of_bounds_ratio():
    v = validate.v4_bounds("Sn 80% 를 추천합니다.")
    assert v and v[0].rule == "V4"


def test_v4_allows_in_bounds():
    assert validate.v4_bounds("Sn 62.0% / Ag 3.0%") == []


def test_v5_blocks_ratios_that_do_not_sum_to_100():
    v = validate.v5_sum("Sn 62.0%, Ag 3.0%, Cu 0.5%, Pb 30.0%")
    assert v and "합계" in v[0].detail


def test_v5_passes_exact_100():
    assert validate.v5_sum("Sn 62.0%, Ag 3.0%, Cu 0.5%, Pb 34.5%") == []


def test_v5_ignores_partial_ratio_mentions():
    """원소 4개를 다 제시하지 않았으면 배합 제안이 아니다."""
    assert validate.v5_sum("Sn 62.0% 입니다.") == []


# ── V6 판정 금지 ────────────────────────────────────────────────────────
@pytest.mark.parametrize("answer", [
    "이 LOT 은 출하 가능합니다.",
    "합격입니다.",
    "불합격입니다.",
    "사용해도 됩니다.",
])
def test_v6_blocks_verdicts(answer):
    """Agent 는 판정하지 않는다 — 사업계획서 p.26 · §2.12.1."""
    assert validate.v6_no_verdict(answer)


def test_v6_allows_showing_the_criteria():
    answer = "품질 점수는 82점이고, 합격 기준은 QS-KS-001 §5.1 이 정합니다. 담당자가 확인하세요."
    assert validate.v6_no_verdict(answer) == []


# ── V7 인용 무결성 ──────────────────────────────────────────────────────
def test_v7_blocks_invented_document_reference():
    v = validate.v7_citation_integrity("QS-KS-002 에 따르면…", [doc()])
    assert v and "QS-KS-002" in v[0].detail


def test_v7_allows_a_document_present_in_evidence():
    assert validate.v7_citation_integrity("WS-KS-001 에 따르면…", [doc()]) == []


# ── V8 별칭 역류 ────────────────────────────────────────────────────────
def test_v8_warns_but_does_not_block():
    _, warnings = validate.v8_alias_leak("LOT#3 의 편차는 0.2% 입니다.")
    assert warnings and warnings[0].rule == "V8"


def test_v8_result_is_a_warning_not_a_violation():
    r = validate.validate("공급사1 자료입니다.", [doc()], RULES)
    assert r.warnings and not r.blocked


# ── V9 근거 자격 ────────────────────────────────────────────────────────
def test_v9_drops_doc_without_snippet():
    kept, _ = validate.v9_evidence_quality([Evidence(kind="doc", label="문서", snippet=None)])
    assert kept == []


def test_v9_keeps_data_with_zero_rows():
    """0 건은 유효한 근거다 — "조회했고 0건이었다" (§7.11.2)."""
    kept, v = validate.v9_evidence_quality([data(count=0)])
    assert len(kept) == 1 and v == []


def test_v9_drops_data_with_null_count():
    kept, _ = validate.v9_evidence_quality([Evidence(kind="data", label="조회", row_count=None)])
    assert kept == []


def test_v9_blocks_when_all_evidence_is_disqualified():
    _, v = validate.v9_evidence_quality([Evidence(kind="doc", label="문서", snippet=None)])
    assert v and v[0].rule == "V9"


# ── 통합 ────────────────────────────────────────────────────────────────
def test_clean_answer_passes():
    answer = "WS-KS-001 WS-02 기준 용해 유지 시간은 15분 이상입니다. [현장확정] 잠정치입니다."
    r = validate.validate(answer, [doc(snippet="유지 시간 15분 이상 [현장확정]")], RULES)
    assert not r.blocked


def test_violation_collects_every_rule_that_fired():
    answer = "합격선은 75점이고 R² 는 0.874 이며 출하 가능합니다."
    r = validate.validate(answer, [doc()], RULES)
    fired = {v.rule for v in r.violations}
    assert {"V1", "V3", "V6"} <= fired


def test_as_strings_includes_warnings_for_the_log():
    r = validate.validate("LOT#1 확인했습니다.", [doc()], RULES)
    assert any(s.startswith("V8") for s in r.as_strings())
