"""입고 Agent 쿼리 카탈로그 (FE-RT-10) — `agent-architecture.md` §3.3.3 도구 5개.

노출 테이블은 `receipts` · `components` · `suppliers` · `lots` 뿐이다 (§3.3.1).

    receipt_history          입고 이력
    supplier_deviation_stats 공급사별 성분 편차·합격률   ← FR-R-05 정면 대응
    material_stock           자재 재고                   ← [X] 원천 없음 (§C-2 #9)
    lot_trace_upstream       LOT 역추적
    component_deviation      성분 실측 + 임계 초과 판정

**LLM 을 모른다.** 이 모듈은 `sqlalchemy` 와 `system_settings` 만 안다.
"""
from __future__ import annotations

import datetime as dt
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.agent.tools._base import (
    Citation,
    ToolArgumentError,
    ToolResult,
    apply_statement_timeout,
    clamp_limit,
    fmt_range,
    num,
    positive_days,
    require_date_range,
    thresholds,
    unanswerable,
)
from src.db.models import Component, Lot, Receipt, Supplier

SCOPE = "receiving"


# ══════════════════════════════════════════════════════════════════════════
# 1. receipt_history — "특정 LOT 의 원재료 이력"
# ══════════════════════════════════════════════════════════════════════════
def receipt_history(
    db: Session,
    *,
    date_from: Any,
    date_to: Any,
    supplier: str | None = None,
    material: str | None = None,
    status: str | None = None,
    limit: int | None = None,
) -> ToolResult:
    """입고 이력 행. 상한 50행 (§3.3.3).

    `date_from`·`date_to` 는 **필수**다. 기간을 조용히 기본값으로 채우면
    그게 곧 지어내기다 (§C-5).
    """
    a, b = require_date_range(date_from, date_to)
    n = clamp_limit(limit)
    apply_statement_timeout(db)

    stmt = (
        select(Receipt, Supplier.code)
        .join(Supplier, Receipt.supplier_id == Supplier.id)
        .where(Receipt.date >= a, Receipt.date <= b)
    )
    if supplier:
        stmt = stmt.where(Supplier.code == supplier)
    if material:
        stmt = stmt.where(Receipt.material == material)
    if status:
        stmt = stmt.where(Receipt.status == status)

    total = db.execute(
        select(func.count()).select_from(stmt.subquery())
    ).scalar_one()

    rows = db.execute(
        stmt.order_by(Receipt.date.desc(), Receipt.id.desc()).limit(n)
    ).all()

    receipts = [
        {
            "receipt_no": r.receipt_no,
            "date": r.date,
            "supplier_code": code,
            "material": r.material,
            "quantity": num(r.quantity, 2),
            "unit": r.unit,
            "status": r.status,
            "sn_pct": num(r.sn_pct, 3),
            "ag_pct": num(r.ag_pct, 3),
            "cu_pct": num(r.cu_pct, 3),
            "pb_pct": num(r.pb_pct, 3),
            "analysis_method": r.analysis_method,
        }
        for r, code in rows
    ]

    truncated = total > len(receipts)
    detail = " · ".join(
        part for part in (supplier, material, status, fmt_range(a, b)) if part
    )
    notes = []
    if truncated:
        notes.append(f"조건에 맞는 {total}건 중 상위 {len(receipts)}건만 조회했습니다.")

    return ToolResult(
        tool="receipt_history",
        scope=SCOPE,
        args={"date_from": a.isoformat(), "date_to": b.isoformat(),
              "supplier": supplier, "material": material, "status": status, "limit": n},
        result={
            "receipts": receipts,
            "meta": {
                "tool": "receipt_history",
                "date_from": a.isoformat(),
                "date_to": b.isoformat(),
                "supplier": supplier,
                "material": material,
                "status": status,
                "limit": n,
                "row_count": len(receipts),
                "truncated": truncated,
            },
        },
        # count 는 **조회된 건수**다. 0건이어도 근거다 (§C-2.4).
        citation=Citation(
            kind="data",
            label="입고 이력",
            detail=detail,
            link="/receiving/history",
            count=len(receipts),
        ),
        notes=notes,
    )


# ══════════════════════════════════════════════════════════════════════════
# 2. supplier_deviation_stats — FR-R-05 "공급사별 성분 편차 패턴 분석"
# ══════════════════════════════════════════════════════════════════════════
def supplier_deviation_stats(db: Session, *, days: int = 90) -> ToolResult:
    """공급사별 `sn`/`ag`/`cu` 평균·표준편차 + 평균 품질 + 합격률.

    합격선은 `system_settings['quality.pass_score']` 에서 읽는다 — **70 을 여기 쓰지 않는다.**

    ⚠ 편차는 **생산 LOT 의 성분 실측치**(`components` ← `lots.supplier_id`)로 계산한다.
    입고 시점 실측치(`receipts.sn_pct` 등)와는 모집단이 다르다.
    """
    d = positive_days(days)
    t = thresholds(db)
    apply_statement_timeout(db)

    today = db.execute(select(func.current_date())).scalar_one()
    if not isinstance(today, dt.date):
        today = dt.date.today()
    since = today - dt.timedelta(days=d)

    # ── LOT 수준 집계 (품질·합격률) ────────────────────────────────────
    # `FILTER (WHERE ...)` 는 표준 SQL 이고 PostgreSQL 이 지원한다.
    # `SUM(CASE WHEN ...)` 보다 의도가 드러난다.
    lot_stmt = (
        select(
            Supplier.code,
            func.count(Lot.id).label("lot_count"),
            func.avg(Lot.quality_score).label("avg_quality"),
            func.count(Lot.quality_score).label("scored"),
            func.count(Lot.id).filter(Lot.quality_score >= t.pass_score).label("passed"),
        )
        .join(Lot, Lot.supplier_id == Supplier.id)
        .where(Lot.date >= since, Lot.date <= today)
        .group_by(Supplier.code)
    )
    lot_rows = {r.code: r for r in db.execute(lot_stmt).all()}

    # ── 성분 수준 집계 (편차) ──────────────────────────────────────────
    comp_stmt = (
        select(
            Supplier.code,
            func.count(Component.id).label("n"),
            func.avg(Component.sn).label("sn_mean"),
            func.avg(Component.ag).label("ag_mean"),
            func.avg(Component.cu).label("cu_mean"),
            func.stddev_samp(Component.sn).label("sn_std"),
            func.stddev_samp(Component.ag).label("ag_std"),
            func.stddev_samp(Component.cu).label("cu_std"),
        )
        .join(Lot, Component.lot_id == Lot.id)
        .join(Supplier, Lot.supplier_id == Supplier.id)
        .where(Lot.date >= since, Lot.date <= today)
        .group_by(Supplier.code)
    )
    comp_rows = {r.code: r for r in db.execute(comp_stmt).all()}

    suppliers = db.execute(
        select(Supplier).order_by(Supplier.code)
    ).scalars().all()

    stats = []
    for s in suppliers:
        lot = lot_rows.get(s.code)
        comp = comp_rows.get(s.code)
        scored = int(lot.scored) if lot else 0
        stats.append({
            "code": s.code,
            "primary_material": s.primary_material,
            "active": s.active,
            "lot_count": int(lot.lot_count) if lot else 0,
            "avg_quality": num(lot.avg_quality, 2) if lot else None,
            # 표본이 없으면 **0% 가 아니라 null** — 0% 와 "측정 안 됨" 은 다르다
            "pass_rate": round(int(lot.passed) / scored * 100, 2) if scored else None,
            "sn_mean": num(comp.sn_mean, 3) if comp else None,
            "ag_mean": num(comp.ag_mean, 3) if comp else None,
            "cu_mean": num(comp.cu_mean, 3) if comp else None,
            # 표본 1건이면 stddev_samp 는 NULL 이다 — DEF-IT-002 와 같은 함정
            "sn_std": num(comp.sn_std, 4) if comp else None,
            "ag_std": num(comp.ag_std, 4) if comp else None,
            "cu_std": num(comp.cu_std, 4) if comp else None,
        })

    return ToolResult(
        tool="supplier_deviation_stats",
        scope=SCOPE,
        args={"days": d},
        result={
            "suppliers": stats,
            "meta": {
                "tool": "supplier_deviation_stats",
                "days": d,
                "date_from": since.isoformat(),
                "date_to": today.isoformat(),
                "pass_score": t.pass_score,
                "sn_target": t.sn_target,
                "ag_target": t.ag_target,
                "cu_target": t.cu_target,
                "row_count": len(stats),
            },
        },
        citation=Citation(
            kind="data",
            label=f"공급사별 성분 편차 (최근 {d}일)",
            detail=f"{', '.join(s.code for s in suppliers)} · {fmt_range(since, today)}",
            link="/receiving/suppliers",
            count=len(stats),
        ),
    )


# ══════════════════════════════════════════════════════════════════════════
# 3. material_stock — 🔴 [X] 답할 수 없다
# ══════════════════════════════════════════════════════════════════════════
#: `plan-agent.md` §C-2.3 표준 문구. **한 글자도 바꾸지 않는다. 숫자를 넣지 않는다.**
STOCK_UNANSWERABLE = (
    "원재료 재고 잔량은 답할 수 없습니다. 현재 시스템은 입고 수량만 기록하고 "
    "출고·소요를 기록하지 않아 잔량을 계산할 수 없습니다. "
    "입고 이력 조회는 입고 이력(/receiving/history) 화면에서 가능합니다."
)


def material_stock(db: Session, *, material: str | None = None) -> ToolResult:
    """§3.3.3 은 "입고 합계 − 소진" 을 명시했으나 **소진을 담는 테이블이 없다.**

    `inventory` 테이블도 소요(consumption) 테이블도 없다 (`plan-agent.md` §C-2.2 #9).
    입고 합계만 내놓고 "재고"라고 부르면 **틀린 숫자를 자신 있게** 내놓는 것이다 —
    §3.3.2 가 자유 Text-to-SQL 을 버린 바로 그 이유다.

    → 숫자를 하나도 반환하지 않고 표준 문구를 돌려준다.
    """
    return unanswerable(
        tool="material_stock",
        scope=SCOPE,
        topic="inventory_balance",
        message=STOCK_UNANSWERABLE,
        args={"material": material},
    )


# ══════════════════════════════════════════════════════════════════════════
# 4. lot_trace_upstream — LOT 역추적
# ══════════════════════════════════════════════════════════════════════════
#: §C-2.3 표준 문구 — 원재료 입고와 생산 LOT 을 잇는 기록이 없다.
UPSTREAM_LIMIT_NOTE = (
    "원재료가 어느 LOT 에 사용됐는지는 답할 수 없습니다. "
    "입고 데이터와 생산 LOT 을 연결하는 기록이 없습니다. "
    "생산 LOT 의 성분 분석 결과는 성분 분석(/receiving/components) 에서 확인할 수 있습니다."
)


def lot_trace_upstream(db: Session, *, lot_id: str) -> ToolResult:
    """LOT → 공급사 · 성분 역추적.

    ⚠ §3.3.3 은 `receipts` 까지 역추적한다고 썼으나 **`receipts` ↔ `lots` FK 가 없다**
    (`plan-agent.md` §C-2.2 #10). 있는 것(`lots.supplier_id` → `suppliers`,
    `components.lot_id`)만 반환하고, 없는 구간은 표준 문구로 명시한다.
    **없는 조인을 지어내지 않는다.**
    """
    if not lot_id or not str(lot_id).strip():
        raise ToolArgumentError("lot_id 가 필요합니다.")
    key = str(lot_id).strip()
    apply_statement_timeout(db)

    row = db.execute(
        select(Lot, Supplier.code, Supplier.primary_material, Supplier.active)
        .join(Supplier, Lot.supplier_id == Supplier.id)
        .where(Lot.lot_id == key)
    ).first()

    if row is None:
        return ToolResult(
            tool="lot_trace_upstream",
            scope=SCOPE,
            args={"lot_id": key},
            result={"meta": {"tool": "lot_trace_upstream", "lot_id": key, "row_count": 0}},
            # 0건은 유효한 결과다 — "그런 LOT 이 없습니다" 는 사실이다 (§C-2.4)
            citation=Citation(
                kind="data", label="LOT 역추적", detail=f"{key} · 조회 결과 없음",
                link="/receiving/components", count=0,
            ),
            notes=[UPSTREAM_LIMIT_NOTE],
        )

    lot, code, primary_material, active = row
    comps = db.execute(
        select(Component).where(Component.lot_id == lot.id).order_by(Component.date.desc())
    ).scalars().all()

    return ToolResult(
        tool="lot_trace_upstream",
        scope=SCOPE,
        args={"lot_id": key},
        result={
            "lots": {
                "lot_id": lot.lot_id,
                "date": lot.date,
                "status": lot.status,
                "quality_score": num(lot.quality_score, 2),
                "temperature": num(lot.temperature, 1),
                "time_min": lot.time_min,
                "sn_ratio": num(lot.sn_ratio, 3),
                "ag_ratio": num(lot.ag_ratio, 3),
                "cu_ratio": num(lot.cu_ratio, 3),
                "pb_ratio": num(lot.pb_ratio, 3),
                "supplier_code": code,
            },
            "suppliers": {
                "code": code,
                "primary_material": primary_material,
                "active": active,
            },
            "components": [
                {
                    "lot_id": lot.lot_id,
                    "date": c.date,
                    "sn": num(c.sn, 3), "ag": num(c.ag, 3),
                    "cu": num(c.cu, 3), "pb": num(c.pb, 3),
                    "sn_deviation": num(c.sn_deviation, 3),
                    "ag_deviation": num(c.ag_deviation, 3),
                    "cu_deviation": num(c.cu_deviation, 3),
                    "analysis_method": c.analysis_method,
                }
                for c in comps
            ],
            "meta": {
                "tool": "lot_trace_upstream",
                "lot_id": lot.lot_id,
                "supplier_code": code,
                "row_count": 1 + len(comps),
            },
        },
        citation=Citation(
            kind="data",
            label="LOT 역추적",
            detail=f"{lot.lot_id} · {code} · 성분 {len(comps)}건",
            link="/receiving/components",
            count=1 + len(comps),
        ),
        notes=[UPSTREAM_LIMIT_NOTE],
    )


# ══════════════════════════════════════════════════════════════════════════
# 5. component_deviation — 성분 실측 + 임계 초과 플래그
# ══════════════════════════════════════════════════════════════════════════
def component_deviation(db: Session, *, lot_id: str) -> ToolResult:
    """성분 실측값 + 목표 대비 편차 + **임계 초과 플래그**.

    임계값(`±2.0` / `±0.3` / `±0.1`)은 `system_settings['deviation.warn_*']` 에서
    읽는다. 저장된 `*_deviation` 컬럼을 그대로 쓰고 **다시 계산하지 않는다** —
    두 벌의 계산이 갈리면 화면과 Agent 가 다른 숫자를 말한다.
    """
    if not lot_id or not str(lot_id).strip():
        raise ToolArgumentError("lot_id 가 필요합니다.")
    key = str(lot_id).strip()
    t = thresholds(db)
    apply_statement_timeout(db)

    rows = db.execute(
        select(Component, Lot.lot_id)
        .join(Lot, Component.lot_id == Lot.id)
        .where(Lot.lot_id == key)
        .order_by(Component.date.desc(), Component.id.desc())
    ).all()

    components = []
    for c, code in rows:
        sn_d, ag_d, cu_d = num(c.sn_deviation, 3), num(c.ag_deviation, 3), num(c.cu_deviation, 3)
        sn_x = sn_d is not None and abs(sn_d) > t.dev_warn_sn
        ag_x = ag_d is not None and abs(ag_d) > t.dev_warn_ag
        cu_x = cu_d is not None and abs(cu_d) > t.dev_warn_cu
        components.append({
            "lot_id": code,
            "date": c.date,
            "sn": num(c.sn, 3), "ag": num(c.ag, 3),
            "cu": num(c.cu, 3), "pb": num(c.pb, 3),
            "sn_deviation": sn_d, "ag_deviation": ag_d, "cu_deviation": cu_d,
            "analysis_method": c.analysis_method,
            "sn_exceeds": sn_x, "ag_exceeds": ag_x, "cu_exceeds": cu_x,
            "any_exceeds": sn_x or ag_x or cu_x,
        })

    exceeded = sum(1 for c in components if c["any_exceeds"])
    return ToolResult(
        tool="component_deviation",
        scope=SCOPE,
        args={"lot_id": key},
        result={
            "components": components,
            "meta": {
                "tool": "component_deviation",
                "lot_id": key,
                "sn_target": t.sn_target, "ag_target": t.ag_target, "cu_target": t.cu_target,
                "dev_warn_sn": t.dev_warn_sn,
                "dev_warn_ag": t.dev_warn_ag,
                "dev_warn_cu": t.dev_warn_cu,
                "row_count": len(components),
            },
        },
        citation=Citation(
            kind="data",
            label="성분 편차 판정",
            detail=(
                f"{key} · 임계 ±{t.dev_warn_sn}/±{t.dev_warn_ag}/±{t.dev_warn_cu} "
                f"· 초과 {exceeded}건"
            ),
            link="/receiving/components",
            count=len(components),
        ),
    )


__all__ = [
    "SCOPE",
    "STOCK_UNANSWERABLE",
    "UPSTREAM_LIMIT_NOTE",
    "component_deviation",
    "lot_trace_upstream",
    "material_stock",
    "receipt_history",
    "supplier_deviation_stats",
]
