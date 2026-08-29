"""FE-RT-40 의사결정 지원 — LOT 이상 소견을 **결정적으로** 뽑는다.

`agent-architecture.md` §7.1 이 `/agents/decision` 응답에 `root_causes[]` ·
`recommendations[]` 를 요구한다. 그런데 이 둘을 LLM 에게 만들게 하면 안 된다.

    "원인이 뭐야" → LLM 이 그럴듯한 원인 3개를 지어낸다

목록 형태로 나오면 사람은 그것을 **확인된 사실**로 읽는다. 서술문이라면
"~로 보입니다" 를 붙여 넘길 수 있지만, 불릿 목록에는 그런 여지가 없다.

그래서 여기서는 **데이터에서 직접 읽히는 것만** 낸다.

    성분 편차가 임계를 넘었다        ← components.*_deviation vs system_settings
    용해 온도가 경고선을 넘었다      ← lots.temperature vs equipment.temp_warn_c
    품질 점수가 기준선 미만이다      ← lots.quality_score vs quality.pass_score
    클레임이 접수돼 있다             ← claims

⚠ **이것들은 "근본 원인" 이 아니라 "관측된 이상" 이다.** 편차가 났다는 사실과
  그것이 불량의 원인이라는 것은 다른 말이다. 계약의 필드명이 `root_causes` 라
  그 자리에 넣지만, 각 항목이 **무엇을 관측한 것인지** 그대로 쓰고 응답에
  단서를 함께 보낸다. 이름이 강한 주장을 하더라도 내용은 사실만 담는다.

`recommendations` 도 마찬가지다. 지어내지 않고 **작업표준서가 그 이상에 대해
규정한 조치**를 가리킨다. 문장은 문서에서 오고, 이 모듈은 어느 절을 봐야 하는지
연결만 한다.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

#: 관측 종류 → (작업표준서 참조 절, 규정된 조치 요약)
#: 문장은 WS-KS-001·QS-KS-001 원문에서 왔다. 여기서 지어낸 조치는 없다.
_ACTION: dict[str, tuple[str, str]] = {
    "deviation": (
        "WS-KS-001 §4.4 WS-04 배합 > 라. 이상 발생 시 조치",
        "원료 LOT별 실측값과 계량 기록을 역검산한다. 원인 미확인 시 전량 재용해. "
        "보고 대상은 품질보증팀장.",
    ),
    "temperature": (
        "WS-KS-001 §4.2 WS-02 용해 > 다. 작업 순서 및 관리 기준",
        "용해 조건(온도·유지시간)을 공정일지와 대조한다. "
        "⚠ 시스템 경고선 255°C 는 작업표준서의 용해로 조업 온도와 맞지 않는 "
        "미해결 사항이다 (CR-STD-001).",
    ),
    "quality": (
        "QS-KS-001 §5.1 합부 판정 기준",
        "품질 점수는 ML 예측값이며 합부 판정이 아니다. 합부는 성분·치수·외관·중량이 "
        "규격 이내이고 치명결함이 0개인지로 판정한다. 검사성적서를 확인한다.",
    ),
    "claim": (
        "QS-KS-001 §5.5 시정조치 및 예방조치",
        "클레임 원인을 규명하고 시정조치 요구서(QR-701)를 발행한다. "
        "전후 LOT 전개 확인이 필요하다.",
    ),
}


@dataclass
class Finding:
    """관측된 이상 하나. **해석이 아니라 측정값이다.**"""

    kind: str
    #: 사람이 읽는 한 줄. 무엇을 관측했는지 그대로 쓴다.
    text: str
    #: 판정 근거가 된 값과 기준
    observed: Any = None
    threshold: Any = None


@dataclass
class DecisionReport:
    lot_id: str
    findings: list[Finding] = field(default_factory=list)

    @property
    def root_causes(self) -> list[str]:
        return [f.text for f in self.findings]

    @property
    def recommendations(self) -> list[str]:
        """중복 없이, 관측된 종류에 대해 표준이 규정한 조치만."""
        out: list[str] = []
        for kind in dict.fromkeys(f.kind for f in self.findings):
            ref, action = _ACTION[kind]
            out.append(f"{action} (근거: {ref})")
        return out


def analyze(trace: dict, thresholds: dict) -> DecisionReport:
    """`lot_trace_full` 결과에서 이상을 뽑는다. **LLM 을 부르지 않는다.**

    `thresholds` 는 `system_settings` 에서 온 값이다 — 코드에 박지 않는다.
    """
    lot = trace.get("lots") or {}
    report = DecisionReport(lot_id=str(lot.get("lot_id") or ""))

    # ── 성분 편차 ────────────────────────────────────────────────────────
    for row in trace.get("components") or []:
        for element, key in (("Sn", "sn"), ("Ag", "ag"), ("Cu", "cu")):
            dev = row.get(f"{key}_deviation")
            limit = thresholds.get(f"dev_warn_{key}")
            if dev is None or limit is None:
                continue
            if abs(float(dev)) > float(limit):
                report.findings.append(Finding(
                    kind="deviation",
                    text=(
                        f"{element} 성분 편차 {float(dev):+.3f}% — "
                        f"경고 임계 ±{float(limit):g}% 초과"
                    ),
                    observed=float(dev), threshold=float(limit),
                ))

    # ── 용해 온도 ────────────────────────────────────────────────────────
    temp, warn = lot.get("temperature"), thresholds.get("temp_warn_c")
    if temp is not None and warn is not None and float(temp) > float(warn):
        report.findings.append(Finding(
            kind="temperature",
            text=f"용해 온도 {float(temp):g}°C — 시스템 경고선 {float(warn):g}°C 초과",
            observed=float(temp), threshold=float(warn),
        ))

    # ── 품질 점수 ────────────────────────────────────────────────────────
    score, pass_score = lot.get("quality_score"), thresholds.get("quality_pass_score")
    if score is not None and pass_score is not None and float(score) < float(pass_score):
        report.findings.append(Finding(
            kind="quality",
            text=(
                f"ML 예측 품질 점수 {float(score):g}점 — 시스템 기준선 "
                f"{float(pass_score):g}점 미만 (합부 판정 아님)"
            ),
            observed=float(score), threshold=float(pass_score),
        ))

    # ── 클레임 ───────────────────────────────────────────────────────────
    claims = trace.get("claims") or []
    if claims:
        open_n = sum(1 for c in claims if c.get("status") in ("open", "analyzing"))
        report.findings.append(Finding(
            kind="claim",
            text=(
                f"클레임 {len(claims)}건 접수"
                + (f" (미종결 {open_n}건)" if open_n else " (전건 종결)")
            ),
            observed=len(claims),
        ))

    return report
