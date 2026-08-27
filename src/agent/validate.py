"""출력 검증기 V1~V9 — `agent-architecture.md` §4.5.

> **주입은 부탁이고, 검증만이 강제다.**

전부 결정적 코드다. **LLM 에게 자기 답을 검사시키지 않는다.** 자기 답이 맞다고
말하는 모델은 틀린 답도 맞다고 말한다.

위반 시 흐름은 §4.5.1 이다: 1회 재생성 → 재위반이면 **답변을 버린다.**
부분 노출하지 않는다 — 틀린 문장만 지우면 어디가 지워졌는지 사용자가 모른다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from src.agent.rules import FORBIDDEN_PATTERNS, MIX_BOUNDS, RuleSnapshot

#: 숫자 하나. `62.5`, `1,200`, `70` 을 잡는다.
_NUM = r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?)"


@dataclass(frozen=True)
class Violation:
    rule: str        # V1 ~ V9
    detail: str

    def __str__(self) -> str:
        return f"{self.rule}: {self.detail}"


@dataclass
class Evidence:
    """검증기가 보는 근거. `AgentCitation` 으로 옮겨지기 전 형태다."""

    kind: str                     # data | doc | model
    label: str
    snippet: str | None = None
    row_count: int | None = None
    score: float | None = None
    chunk_id: int | None = None
    source_ref: str = ""
    link: str | None = None
    detail: str | None = None

    def qualifies(self) -> bool:
        """§7.11.3 V9 — 근거 자격.

        `doc` 인데 발췌가 없으면 무엇을 봤는지 확인할 수 없다.
        `data` 인데 건수가 **NULL** 이면 조회했는지도 알 수 없다.
        **0 은 유효하다** — "조회했고 0건이었다" 는 근거다 (§7.11.2).
        """
        if self.kind == "doc":
            return bool(self.snippet and self.snippet.strip())
        if self.kind == "data":
            return self.row_count is not None
        return True


def _to_float(raw: str) -> float:
    return float(raw.replace(",", ""))


def _near(text: str, keywords: tuple[str, ...], window: int = 40) -> list[float]:
    """키워드 근방(window 자) 안의 숫자들을 모은다."""
    out: list[float] = []
    for kw in keywords:
        for m in re.finditer(re.escape(kw), text):
            seg = text[m.end() : m.end() + window]
            out.extend(_to_float(x) for x in re.findall(_NUM, seg))
    return out


# ── V1 수치 대조 ────────────────────────────────────────────────────────
_PASS_WORDS = ("합격선", "합격 기준", "품질 기준선", "기준 점수", "품질 점수 기준")
_TEMP_WORDS = ("온도 경고", "경고 온도", "경고선", "온도 임계")


def v1_numbers(answer: str, rules: RuleSnapshot) -> list[Violation]:
    bad: list[Violation] = []
    for n in _near(answer, _PASS_WORDS):
        if n != rules.quality_pass_score and n != rules.quality_warn_score:
            bad.append(Violation("V1", f"합격선을 {n:g} 로 서술 (정본 {rules.quality_pass_score:g})"))
    for n in _near(answer, _TEMP_WORDS):
        if n != rules.temp_warn_c:
            bad.append(Violation("V1", f"온도 경고선을 {n:g} 로 서술 (정본 {rules.temp_warn_c:g})"))
    return bad


# ── V2 인용 필수 ────────────────────────────────────────────────────────
#: 사실 주장의 표지 — 수치·날짜·LOT·공급사·고객사
_FACT = re.compile(
    r"\d+(?:\.\d+)?\s*(?:%|점|°C|kg|건|일|년|분|시간|ppm)"
    r"|LOT[-\s#]?\w+|\d{4}[-.]\d{1,2}[-.]\d{1,2}|공급사|고객사"
)


def v2_citation_required(answer: str, evidence: list[Evidence]) -> list[Violation]:
    """**답변 단위** 검사다. 문장별 인라인 마커를 요구하지 않는다 (§7.12)."""
    if not answer.strip():
        return []
    if _FACT.search(answer) and not evidence:
        return [Violation("V2", "사실 주장이 있는데 근거가 0건")]
    return []


# ── V3 금칙 수치 ────────────────────────────────────────────────────────
def v3_forbidden(answer: str) -> list[Violation]:
    return [
        Violation("V3", why)
        for pattern, why in FORBIDDEN_PATTERNS
        if re.search(pattern, answer)
    ]


# ── V4·V5 배합 경계·합계 ─────────────────────────────────────────────────
_RATIO = re.compile(r"(Sn|Ag|Cu|Pb)\s*[:=]?\s*" + _NUM + r"\s*%", re.IGNORECASE)


def _ratios(answer: str) -> dict[str, float]:
    found: dict[str, float] = {}
    for el, raw in _RATIO.findall(answer):
        found.setdefault(el.lower(), _to_float(raw))
    return found


def v4_bounds(answer: str) -> list[Violation]:
    bad = []
    for el, value in _ratios(answer).items():
        lo, hi = MIX_BOUNDS[el]
        if not (lo <= value <= hi):
            bad.append(Violation("V4", f"{el.capitalize()} {value:g}% 가 경계 {lo:g}~{hi:g} 밖"))
    return bad


def v5_sum(answer: str) -> list[Violation]:
    found = _ratios(answer)
    if len(found) < 4:
        return []
    total = sum(found.values())
    if abs(total - 100.0) > 0.05:
        return [Violation("V5", f"배합 합계 {total:.2f}% (100.0±0.05 이어야 함)")]
    return []


# ── V6 판정 금지 ────────────────────────────────────────────────────────
#: 사업계획서 p.26 · §2.12.1 — Agent 는 **판정하지 않는다.** 근거를 보여줄 뿐이다.
_VERDICT = (
    re.compile(r"출하\s*(?:해도\s*됩니다|가능합니다|하십시오|하세요)"),
    re.compile(r"(?<!불)합격입니다"),
    re.compile(r"불합격입니다"),
    re.compile(r"폐기하(?:십시오|세요)"),
    re.compile(r"사용해도\s*(?:됩니다|좋습니다)"),
)


def v6_no_verdict(answer: str) -> list[Violation]:
    return [
        Violation("V6", f"단정 판정 어구: {m.group(0)}")
        for p in _VERDICT
        if (m := p.search(answer))
    ]


# ── V7 인용 무결성 ──────────────────────────────────────────────────────
#: 본문이 언급한 문서 표지 — `WS-KS-001`, `QS-KS-001` 같은 문서번호
_DOC_REF = re.compile(r"\b([A-Z]{2}-[A-Z]{2}-\d{3})\b")


def v7_citation_integrity(answer: str, evidence: list[Evidence]) -> list[Violation]:
    """답변이 언급한 문서번호가 실제 근거 집합에 있는가.

    마커가 아니라 **본문 언급**을 본다 — v1.1 에 인라인 마커가 없다 (§4.5 V7).
    """
    corpus = " ".join(f"{e.label} {e.source_ref} {e.snippet or ''}" for e in evidence)
    return [
        Violation("V7", f"근거에 없는 문서를 인용: {ref}")
        for ref in sorted(set(_DOC_REF.findall(answer)))
        if ref not in corpus
    ]


# ── V8 별칭 역류 ────────────────────────────────────────────────────────
_ALIAS = re.compile(r"(?:LOT#|공급사|고객사|입고#|클레임#)\d+")


def v8_alias_leak(answer: str) -> tuple[str, list[Violation]]:
    """**경고 + 정리 후 통과**다 (§4.5). 차단하지 않는다.

    별칭이 남은 것은 답이 틀린 게 아니라 역치환이 덜 된 것이다. 답을 버리면
    사용자만 손해다.
    """
    leaks = sorted(set(_ALIAS.findall(answer)))
    if not leaks:
        return answer, []
    return answer, [Violation("V8", f"별칭 잔존: {', '.join(leaks)}")]


# ── V9 근거 자격 ────────────────────────────────────────────────────────
def v9_evidence_quality(evidence: list[Evidence]) -> tuple[list[Evidence], list[Violation]]:
    """자격 미달 근거를 **제거**하고, 남은 게 0건이면 위반이다 (§7.11.3)."""
    kept = [e for e in evidence if e.qualifies()]
    dropped = len(evidence) - len(kept)
    if not kept and evidence:
        return kept, [Violation("V9", f"근거 {dropped}건이 모두 자격 미달 (발췌·건수 없음)")]
    return kept, []


# ── 전체 ────────────────────────────────────────────────────────────────
@dataclass
class ValidationResult:
    answer: str
    evidence: list[Evidence]
    violations: list[Violation]
    #: V8 처럼 차단하지 않는 것들. 기록은 하되 답변은 나간다.
    warnings: list[Violation]

    @property
    def blocked(self) -> bool:
        return bool(self.violations)

    def as_strings(self) -> list[str]:
        return [str(v) for v in self.violations + self.warnings]


def validate(answer: str, evidence: list[Evidence], rules: RuleSnapshot) -> ValidationResult:
    kept, v9 = v9_evidence_quality(evidence)
    cleaned, v8 = v8_alias_leak(answer)

    blocking: list[Violation] = []
    blocking += v1_numbers(cleaned, rules)
    blocking += v2_citation_required(cleaned, kept)
    blocking += v3_forbidden(cleaned)
    blocking += v4_bounds(cleaned)
    blocking += v5_sum(cleaned)
    blocking += v6_no_verdict(cleaned)
    blocking += v7_citation_integrity(cleaned, kept)
    blocking += v9

    return ValidationResult(answer=cleaned, evidence=kept, violations=blocking, warnings=v8)
