"""`RuleSnapshot` — 답변 시점의 룰 정본. `agent-architecture.md` §4.3·§4.5.

두 군데에서 쓴다.
  1. **주입** — 프롬프트에 넣어 LLM 이 맞는 값을 쓰게 유도한다. 이건 *부탁*이다.
  2. **검증** — 생성된 답변의 수치를 이 값과 대조한다. 이건 *강제*다 (§4.5 V1).

값은 **DB(`system_settings`)에서 읽는다.** 코드에 박으면 설정을 바꿨을 때 검증기가
옛 값으로 답변을 차단한다. `rule_hash` 를 `agent_runs` 에 남겨 **어떤 룰로 답했는지**
나중에 재현할 수 있게 한다 (§6.6).
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

#: `app.py:API_BOUNDS` 와 같은 값. 최적화 경계는 설정이 아니라 코드 상수다.
MIX_BOUNDS: dict[str, tuple[float, float]] = {
    "sn": (55.0, 70.0),
    "ag": (1.0, 5.0),
    "cu": (0.1, 1.5),
    "pb": (25.0, 45.0),
}

#: 🔴 §4.3.1 금칙 인용 — 합성 시드 성능치를 실공정 성능으로 말하면 허위다.
#: CLAUDE.md 가 같은 경고를 달아 뒀다. 실데이터 근거는 SF-TI2 실측 R² 0.782 다.
FORBIDDEN_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"R²\s*(?:는|이|가)?\s*0\.87", "합성 시드 R² 0.874 를 실성능으로 인용"),
    (r"R2\s*0\.87", "합성 시드 R² 0.874 를 실성능으로 인용"),
    (r"R²\s*(?:≥|>=)\s*0\.85\s*(?:달성|충족|만족)", "SF-AD1 희망치를 달성으로 서술"),
    (r"정확도\s*(?:는|이|가)?\s*9\d\s*%", "근거 없는 정확도 수치"),
)


@dataclass(frozen=True)
class RuleSnapshot:
    quality_pass_score: float
    quality_warn_score: float
    temp_warn_c: float
    dev_warn_sn: float
    dev_warn_ag: float
    dev_warn_cu: float
    sn_target: float
    ag_target: float
    cu_target: float

    def hash(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(payload.encode()).hexdigest()

    def as_prompt_block(self) -> str:
        """프롬프트에 넣을 룰 블록.

        **불일치를 숨기지 않는다.** 품질 점수와 LOT 합부 판정이 다른 것이라는 사실,
        온도 경고선이 작업표준서 조업 온도와 어긋난다는 사실을 여기서 함께 말한다.
        숨기면 LLM 이 시스템 값만 보고 "합격입니다" 를 만들어 낸다.
        """
        return f"""[시스템 정본 값 — 이 값과 다른 숫자를 말하지 마라]
· 품질 점수 기준선: {self.quality_pass_score:g}점 (경고 {self.quality_warn_score:g}점)
  ⚠ 이것은 ML 예측 점수이며 **LOT 합부 판정이 아니다.** 합부는 품질기준서
     QS-KS-001 §5.1 이 정한다 — 전 항목 규격 이내 + 치명결함 0개.
     점수를 근거로 "합격"·"출하 가능" 이라고 말하지 마라.
· 설비 온도 경고선: {self.temp_warn_c:g}°C
  ⚠ 작업표준서 WS-KS-001 의 용해로 조업 온도(유연 340±20 / 무연 400±20)와
     맞지 않는 미해결 사항이다. 온도를 답할 때 이 사실을 함께 말하라.
· 성분 기준값(편차 계산용): Sn {self.sn_target:g} / Ag {self.ag_target:g} / Cu {self.cu_target:g}
  ⚠ 제품 성분 규격이 아니다. 규격은 QS-KS-001 [표 3-2]·[표 3-3] 이다.
· 편차 경고 임계: Sn ±{self.dev_warn_sn:g} / Ag ±{self.dev_warn_ag:g} / Cu ±{self.dev_warn_cu:g}
· 배합 경계: """ + " / ".join(
            f"{k.capitalize()} {lo:g}~{hi:g}" for k, (lo, hi) in MIX_BOUNDS.items()
        )


#: `system_settings` 키 → 필드명
_KEYS = {
    "quality.pass_score": "quality_pass_score",
    "quality.warn_score": "quality_warn_score",
    "equipment.temp_warn_c": "temp_warn_c",
    "deviation.warn_sn": "dev_warn_sn",
    "deviation.warn_ag": "dev_warn_ag",
    "deviation.warn_cu": "dev_warn_cu",
    "ml.sn_target": "sn_target",
    "ml.ag_target": "ag_target",
    "ml.cu_target": "cu_target",
}


def load(db: Session) -> RuleSnapshot:
    """`system_settings` 에서 읽는다. 하나라도 없으면 **멈춘다.**

    기본값으로 때우면 검증기가 엉뚱한 값으로 답변을 차단하거나 통과시킨다.
    설정이 없다는 것은 시스템이 덜 구성된 것이고, 그걸 조용히 메우지 않는다.
    """
    rows = dict(db.execute(text("select key, value from system_settings")).fetchall())
    missing = [k for k in _KEYS if k not in rows]
    if missing:
        raise RuntimeError(f"system_settings 에 없는 룰 키: {missing}")
    return RuleSnapshot(**{field: float(rows[key]) for key, field in _KEYS.items()})
