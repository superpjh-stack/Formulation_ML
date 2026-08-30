"""추천 이력 적재 — `agent_recommendations` (§6.9 · CR-DB-008).

추천이 나오는 경로는 둘이고 **둘 다 여기를 통과한다.**

    POST /recommend        FE-RT-14 배합비율 추천 화면      source="recommend_api"
    POST /agents/mixing    FE-RT-15 배합 AI Agent 의 도구   source="agent"

`app.py` 와 `src/api/routers/agents.py` 양쪽에서 부르므로 둘 다에 의존하지 않는
독립 모듈에 둔다. 여기서 INSERT 문을 한 벌만 유지한다 — 두 벌이 되면 한쪽만
고쳐지는 날이 온다.

🔴 **적재 실패가 추천을 죽이지 않는다.** 사용자가 요청한 것은 배합 추천이고,
   이력은 그 부산물이다. 이력을 못 남겼다고 200 을 500 으로 바꾸면 ML 기능이
   로그 테이블에 인질로 잡힌다.
   대신 **조용히 넘기지 않는다** — `logger.exception` 으로 스택을 남긴다.
   응답을 조작하지 않을 뿐, 실패를 감추지는 않는다.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from src.db.models import AgentRecommendation

logger = logging.getLogger(__name__)

SOURCE_API = "recommend_api"
SOURCE_AGENT = "agent"


def record(
    db: Session,
    *,
    source: str,
    ratios: dict,
    predicted_quality: float | None,
    optimization_success: bool,
    model_name: str | None = None,
    temperature: float | None = None,
    process_time: float | None = None,
    supplier: str | None = None,
    user_id: int | None = None,
    message_id: int | None = None,
) -> AgentRecommendation | None:
    """추천 1건을 남긴다. 실패하면 `None` 을 돌려주고 로그에 남긴다.

    `ratios` 는 `{"sn","ag","cu","pb"}`. 네 값 중 하나라도 없으면 **적재하지
    않는다** — `rec_*` 는 NOT NULL 이고, 빈 값을 0 으로 채우면 "Pb 0% 배합" 이라는
    없던 추천이 이력에 생긴다.

    🔴 수렴 실패(`optimization_success=False`)한 추천도 남긴다 (§5 오류 계약).
       실패를 기록에서 빼면 "AI 추천은 늘 수렴한다" 로 읽힌다.
    """
    try:
        values = [ratios.get(k) for k in ("sn", "ag", "cu", "pb")]
        if any(v is None for v in values):
            logger.warning("추천 이력 미적재 — 배합비가 불완전하다: %r", ratios)
            return None

        row = AgentRecommendation(
            source=source,
            user_id=user_id,
            message_id=message_id,
            input_temp=temperature,
            input_time=process_time,
            input_supplier=supplier,
            rec_sn=values[0], rec_ag=values[1], rec_cu=values[2], rec_pb=values[3],
            predicted_quality=predicted_quality,
            model_name=model_name,
            optimization_success=bool(optimization_success),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    except Exception:  # noqa: BLE001 — 이력 적재가 추천을 죽이면 안 된다 (모듈 주석)
        logger.exception("추천 이력 적재 실패 (source=%s)", source)
        db.rollback()
        return None


__all__ = ["record", "SOURCE_API", "SOURCE_AGENT"]
