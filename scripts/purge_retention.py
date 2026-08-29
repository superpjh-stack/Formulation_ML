"""로그 보존 정책 집행 — 감사로그 · Agent 실행 로그.

    .venv/bin/python scripts/purge_retention.py --dry-run   # 무엇이 지워질지만 본다
    .venv/bin/python scripts/purge_retention.py             # 실제 집행

| 대상 | 정책 | 근거 |
|---|---|---|
| `audit_logs` 행 | 1년 후 삭제 | NFR-S-04 |
| `agent_runs.prompt_sent`·`raw_answer` | **90일 후 NULL** | agent-architecture §6.6 |
| `agent_runs` 행 | 1년 후 삭제 | 동상 |

**원문 90일 / 통계 1년이 다른 이유**: 지연·토큰·룰위반 지표는 1년치가 있어야
추세를 보지만, 외부로 나갔던 프롬프트 전문까지 1년을 들고 있을 이유는 없다.
그래서 행을 지우는 대신 두 컬럼만 비운다 — 로그는 남고 원문만 사라진다.

── 운용 ────────────────────────────────────────────────────────────────
`app.py` lifespan 이 **기동 시 1회** 돌린다. 서버가 몇 주씩 떠 있으면 그동안
정리가 안 되므로, 상시 운영에서는 cron 으로 하루 1회 돌린다:

    0 4 * * *  cd /path/to/Formulation_ML && .venv/bin/python scripts/purge_retention.py

⚠ 행 삭제는 되돌릴 수 없다. 처음 돌릴 때는 `--dry-run` 으로 건수를 먼저 본다.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select

from src.agent import retention
from src.api.middleware import AUDIT_RETENTION_DAYS, purge_expired_audit_logs
from src.db.models import AgentRun, AuditLog
from src.db.session import SessionLocal


def _audit_purgeable(db) -> int:
    import datetime as dt

    cutoff = dt.datetime.now() - dt.timedelta(days=AUDIT_RETENTION_DAYS)
    return int(
        db.execute(
            select(func.count(AuditLog.id)).where(AuditLog.created_at < cutoff)
        ).scalar_one()
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="건수만 세고 지우지 않는다")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        total_runs = int(db.execute(select(func.count(AgentRun.id))).scalar_one())
        total_audit = int(db.execute(select(func.count(AuditLog.id))).scalar_one())
        with_prompt = int(
            db.execute(
                select(func.count(AgentRun.id)).where(AgentRun.prompt_sent.isnot(None))
            ).scalar_one()
        )

        print("=== 현재 ===")
        print(f"  audit_logs   {total_audit:>7}행")
        print(f"  agent_runs   {total_runs:>7}행 (원문 보유 {with_prompt}행)")

        maskable = retention.count_maskable(db)
        purgeable_runs = retention.count_purgeable(db)
        purgeable_audit = _audit_purgeable(db)

        print("\n=== 대상 ===")
        print(f"  {'원문 비우기':<16} {maskable:>5}행  "
              f"(agent_runs, {retention.PROMPT_RETENTION_DAYS}일 경과)")
        print(f"  {'실행 로그 삭제':<15} {purgeable_runs:>5}행  "
              f"(agent_runs, {retention.RUN_RETENTION_DAYS}일 경과)")
        print(f"  {'감사로그 삭제':<15} {purgeable_audit:>5}행  "
              f"(audit_logs, {AUDIT_RETENTION_DAYS}일 경과)")

        if args.dry_run:
            print("\n[dry-run] 아무것도 바꾸지 않았다.")
            return 0

        if not (maskable or purgeable_runs or purgeable_audit):
            print("\n정리할 것이 없다.")
            return 0

        masked = retention.mask_expired_prompts(db)
        purged_runs = retention.purge_expired_runs(db)
        # 감사로그 정리는 자체 세션을 열고 실패해도 0 을 돌려준다 (middleware)
        purged_audit = purge_expired_audit_logs()

        print("\n=== 집행 ===")
        print(f"  원문 비움      {masked:>5}행")
        print(f"  실행 로그 삭제  {purged_runs:>5}행")
        print(f"  감사로그 삭제   {purged_audit:>5}행")

        # 집행 후 대상이 남아 있으면 조용히 넘어가지 않는다
        left = retention.count_maskable(db) + retention.count_purgeable(db)
        if left:
            print(f"\n⚠ 아직 {left}행이 대상으로 남아 있다. 정책이 지켜지지 않았다.")
            return 1
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
