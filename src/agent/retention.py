"""AI Agent 로그 보존 정책 — `agent-architecture.md` §6.6.

| 대상 | 보존 | 근거 |
|---|---|---|
| `agent_runs` 행 전체 | **1년** | NFR-S-04 감사로그와 동일. 사업계획서 p.60 "사용 로그 기록·관리" |
| `prompt_sent` · `raw_answer` | **90일 후 NULL** | 외부 송출 원문을 1년 보관하면 그 자체가 유출 표면이다 |

두 정책이 다른 이유가 핵심이다. **통계는 1년, 원문은 90일.**
지연·토큰·룰위반 지표는 1년치가 있어야 추세를 보는데, 외부로 나갔던 프롬프트
전문까지 1년을 들고 있을 이유는 없다. 그래서 행을 지우는 대신 **두 컬럼만
비운다** — 로그는 남고 원문만 사라진다.

`prompt_sent` 는 이미 마스킹된 문자열이지만(§2.8.3 `to_wire()` 결과), 검색된
문서 청크와 조회 결과가 통째로 붙어 있다. 대외비 문서 본문이 여기 남는다.
"""
from __future__ import annotations

import datetime as dt
import logging

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from src.db.models import AgentRun

log = logging.getLogger(__name__)

#: 외부 송출 원문을 비우기까지. §6.6 보존 정책 표.
PROMPT_RETENTION_DAYS = 90

#: 실행 로그 행 자체의 보존. NFR-S-04 감사로그와 같다.
RUN_RETENTION_DAYS = 365


def _cutoff(days: int) -> dt.datetime:
    return dt.datetime.now() - dt.timedelta(days=days)


def count_maskable(db: Session, days: int = PROMPT_RETENTION_DAYS) -> int:
    """비울 대상 행 수. `--dry-run` 이 쓴다."""
    return int(
        db.execute(
            select(func.count(AgentRun.id)).where(
                AgentRun.created_at < _cutoff(days),
                (AgentRun.prompt_sent.isnot(None)) | (AgentRun.raw_answer.isnot(None)),
            )
        ).scalar_one()
    )


def mask_expired_prompts(db: Session, days: int = PROMPT_RETENTION_DAYS) -> int:
    """90일 지난 `prompt_sent`·`raw_answer` 를 NULL 로 만든다. **행은 남긴다.**

    이미 비워진 행은 건드리지 않는다 — 멱등하고, 반환값이 "이번에 실제로 비운
    건수" 를 뜻하게 된다. 조건을 빼면 매번 전체 행을 업데이트하면서 "N건 처리"
    라고 보고해 아무 일도 안 한 실행과 구분이 안 된다.
    """
    result = db.execute(
        update(AgentRun)
        .where(
            AgentRun.created_at < _cutoff(days),
            (AgentRun.prompt_sent.isnot(None)) | (AgentRun.raw_answer.isnot(None)),
        )
        .values(prompt_sent=None, raw_answer=None)
    )
    db.commit()
    return int(result.rowcount or 0)


def count_purgeable(db: Session, days: int = RUN_RETENTION_DAYS) -> int:
    return int(
        db.execute(
            select(func.count(AgentRun.id)).where(AgentRun.created_at < _cutoff(days))
        ).scalar_one()
    )


def purge_expired_runs(db: Session, days: int = RUN_RETENTION_DAYS) -> int:
    """1년 지난 실행 로그 행을 지운다.

    ⚠ 이건 **되돌릴 수 없다.** 마스킹과 달리 행이 사라진다. 그래서 `--dry-run`
      으로 건수를 먼저 보고 돌리는 것을 기본 운용으로 삼는다.
    """
    result = db.execute(delete(AgentRun).where(AgentRun.created_at < _cutoff(days)))
    db.commit()
    return int(result.rowcount or 0)


def run_all(db: Session) -> dict[str, int]:
    """기동 시 1회 호출용. 실패해도 **서버를 막지 않는다.**

    보존 정리가 안 됐다고 서비스가 안 뜨면 그게 더 큰 문제다. 다만 조용히
    넘어가지 않고 경고를 남긴다 — 정리가 계속 실패하는 것을 아무도 모르면
    90일 정책이 지켜지지 않는다.
    """
    out = {"masked": 0, "purged": 0}
    try:
        out["masked"] = mask_expired_prompts(db)
        out["purged"] = purge_expired_runs(db)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("Agent 로그 보존 정리 건너뜀: %s", exc)
    if out["masked"] or out["purged"]:
        log.info(
            "Agent 로그 보존 정리: 원문 %d건 비움(%d일), 행 %d건 삭제(%d일)",
            out["masked"], PROMPT_RETENTION_DAYS, out["purged"], RUN_RETENTION_DAYS,
        )
    return out
