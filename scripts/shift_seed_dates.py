"""시드 데이터의 날짜를 현재 시점으로 당긴다.

`generate_sample.py` 와 `seed_testdata.py` 는 SF-TD3 §3.1 의 기준일
**2026-06-27** 을 "오늘"로 삼아 데이터를 만든다. 실제 시스템 날짜가 그보다 앞서면
"최근 7일/30일" 기본 필터를 쓰는 화면들이 **진입하자마자 0건**이 된다
(QA-B DEF-B-05 — 5화면 해당).

기본값을 늘려 덮는 건 문제를 가리는 것이다. 데이터를 옮긴다.

실행:
    .venv/bin/python scripts/shift_seed_dates.py            # 최신일이 오늘이 되도록
    .venv/bin/python scripts/shift_seed_dates.py --days 30  # 지정한 일수만큼
    .venv/bin/python scripts/shift_seed_dates.py --dry-run

**상대 간격은 그대로 둔다** — 전 행에 같은 일수를 더하므로 추이·집계·상관이 보존된다.
`audit_logs` 는 실제 감사 기록이라 건드리지 않는다. `ml_models.trained_at` 도
실제 학습 시각이므로 제외한다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from src.db.session import SessionLocal

# (테이블, [날짜 컬럼])  — audit_logs·ml_models 는 의도적으로 제외
TARGETS: list[tuple[str, list[str]]] = [
    ("lots", ["date", "created_at", "updated_at"]),
    ("components", ["date", "created_at"]),
    ("quality", ["tested_at"]),
    ("receipts", ["date", "created_at"]),
    ("shipments", ["shipped_at"]),
    ("claims", ["resolved_at", "created_at"]),
    ("alerts", ["resolved_at", "created_at"]),
    ("equipment", ["last_maintenance", "updated_at"]),
    ("process_conditions", ["created_at"]),
    ("condition_history", ["created_at"]),
    ("master_codes", ["created_at"]),
    ("kpi_targets", ["created_at", "actual_updated_at"]),
    ("notification_rules", ["created_at"]),
    ("suppliers", ["created_at"]),
    ("users", ["last_login", "created_at"]),
    ("system_settings", ["updated_at"]),
]

#: 데이터 최신일을 재는 기준 — 이 값이 "오늘"이 되도록 옮긴다
ANCHOR = ("shipments", "shipped_at")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None, help="이동할 일수 (미지정 시 자동 계산)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        tbl, col = ANCHOR
        latest = db.execute(text(f"select max({col})::date from {tbl}")).scalar_one()
        today = dt.date.today()
        if latest is None:
            print(f"[skip] {tbl}.{col} 이 비어 있다")
            return 0

        days = args.days if args.days is not None else (today - latest).days
        print(f"기준: {tbl}.{col} 최신 {latest} · 오늘 {today}")
        if days <= 0:
            print(f"이동 불필요 (계산된 이동 일수 {days}일)")
            return 0
        print(f"이동: **+{days}일**  (상대 간격 보존)\n")

        for name, cols in TARGETS:
            n = db.execute(text(f"select count(*) from {name}")).scalar_one()
            if n == 0:
                print(f"  {name:<20} 0행 — 건너뜀")
                continue
            sets = ", ".join(
                f"{c} = {c} + make_interval(days => :d)" for c in cols
            )
            sql = f"update {name} set {sets}"
            if args.dry_run:
                print(f"  {name:<20} {n:>5}행 · {', '.join(cols)}  [dry-run]")
            else:
                db.execute(text(sql), {"d": days})
                print(f"  {name:<20} {n:>5}행 · {', '.join(cols)}")

        # `kpi_targets.period` 는 'YYYY-MM' 문자열이라 위 interval 이동에 안 걸린다.
        # 같이 옮기지 않으면 **목표 월과 실적 집계 월이 어긋나** 게이지가 전부 빈다.
        months = (today.year * 12 + today.month) - (latest.year * 12 + latest.month)
        if months:
            # ⚠ 한 번의 UPDATE 로 전부 옮기면 `uq_kpi_targets_key_period` 를 위반한다.
            # 기간이 겹치므로 먼저 옮긴 행이 **아직 안 옮긴 행과 충돌**한다
            # (Postgres 는 DEFERRABLE 이 아닌 UK 를 행마다 즉시 검사한다).
            # 겹치지 않는 먼 미래로 한 번 보냈다가 되돌리면 두 단계 모두 충돌이 없다.
            def _shift(m: int) -> None:
                db.execute(
                    text(
                        "update kpi_targets set period = to_char("
                        "(to_date(period,'YYYY-MM') + make_interval(months => :m)), 'YYYY-MM')"
                    ),
                    {"m": m},
                )

            if args.dry_run:
                print(f"\n  kpi_targets.period    'YYYY-MM' 문자열 · **+{months}개월** (2단계)  [dry-run]")
            else:
                _shift(1000)              # 원래 범위와 겹치지 않는 곳으로
                _shift(months - 1000)     # 순이동 +months
                print(f"\n  kpi_targets.period    'YYYY-MM' 문자열 · **+{months}개월** (2단계 이동)")

        if args.dry_run:
            db.rollback()
            print("\n[dry-run] 변경 없음")
        else:
            db.commit()
            new_latest = db.execute(text(f"select max({col})::date from {tbl}")).scalar_one()
            print(f"\n완료 — {tbl}.{col} 최신일 {latest} → **{new_latest}**")
            print("제외: audit_logs(실제 감사 기록) · ml_models.trained_at(실제 학습 시각)")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
