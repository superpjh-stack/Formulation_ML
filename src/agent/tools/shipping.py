"""출하 Agent 쿼리 카탈로그 (FE-RT-20) — `agent-architecture.md` §3.3.3 도구 6개.

노출 테이블은 `shipments` · `claims` · `quality` · `lots` 뿐이다 (§3.3.1).

    shipment_history        출하 이력
    lot_quality_summary     출하 LOT 품질 요약 (합격선 대비 판정 근거)  ← FR-S-05
    lot_trace_full          LOT 전 구간 추적
    claim_search            클레임 목록
    lot_match_for_customer  고객사 조건 만족 LOT 후보                   ← FR-S-05
    shipment_due_risk       납기 임박·지연  ← [X] 원천 없음 (§C-2 #6)
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
from src.db.models import Claim, Component, Lot, Quality, Shipment, Supplier

SCOPE = "shipping"


# ══════════════════════════════════════════════════════════════════════════
# 1. shipment_history
# ══════════════════════════════════════════════════════════════════════════
def shipment_history(
    db: Session,
    *,
    date_from: Any,
    date_to: Any,
    customer: str | None = None,
    product: str | None = None,
    limit: int | None = None,
) -> ToolResult:
    """출하 이력. 상한 50행.

    ⚠ §3.3.3 은 인자에 `status?` 를 뒀으나 **`shipments` 에 상태 컬럼이 없다**
    (`db-schema.md` §3.10 — `id·lot_id·customer·product·quantity·unit·shipped_at` 7컬럼).
    LOT 상태로 슬쩍 바꿔 필터하면 사용자가 물은 것과 다른 것을 답하게 된다.
    → **인자를 제공하지 않는다.** 없는 것을 있는 척하지 않는다.
    """
    a, b = require_date_range(date_from, date_to)
    n = clamp_limit(limit)
    apply_statement_timeout(db)

    start = dt.datetime.combine(a, dt.time.min)
    end = dt.datetime.combine(b, dt.time.max)

    stmt = (
        select(Shipment, Lot.lot_id)
        .join(Lot, Shipment.lot_id == Lot.id)
        .where(Shipment.shipped_at >= start, Shipment.shipped_at <= end)
    )
    if customer:
        stmt = stmt.where(Shipment.customer == customer)
    if product:
        stmt = stmt.where(Shipment.product == product)

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(
        stmt.order_by(Shipment.shipped_at.desc(), Shipment.id.desc()).limit(n)
    ).all()

    shipments = [
        {
            "lot_id": code,
            "customer": s.customer,
            "product": s.product,
            "quantity": num(s.quantity, 2),
            "unit": s.unit,
            "shipped_at": s.shipped_at,
        }
        for s, code in rows
    ]

    truncated = total > len(shipments)
    notes = []
    if truncated:
        notes.append(f"조건에 맞는 {total}건 중 상위 {len(shipments)}건만 조회했습니다.")

    return ToolResult(
        tool="shipment_history",
        scope=SCOPE,
        args={"date_from": a.isoformat(), "date_to": b.isoformat(),
              "customer": customer, "product": product, "limit": n},
        result={
            "shipments": shipments,
            "meta": {
                "tool": "shipment_history",
                "date_from": a.isoformat(),
                "date_to": b.isoformat(),
                "customer": customer,
                "limit": n,
                "row_count": len(shipments),
                "truncated": truncated,
            },
        },
        citation=Citation(
            kind="data",
            label="출하 이력",
            detail=" · ".join(p for p in (customer, product, fmt_range(a, b)) if p),
            link="/shipping/list",
            count=len(shipments),
        ),
        notes=notes,
    )


# ══════════════════════════════════════════════════════════════════════════
# 2. lot_quality_summary — FR-S-05 "출하 LOT 품질 요약"
# ══════════════════════════════════════════════════════════════════════════
def lot_quality_summary(db: Session, *, lot_id: str) -> ToolResult:
    """`quality.score` · `passed` · 검사일 + **합격선 대비 판정 근거**.

    합격선은 `system_settings['quality.pass_score']` 에서 읽는다.
    `passed` 는 DB 에 저장된 값을 그대로 쓰고, 합격선과의 **여유(margin)** 를 함께 낸다 —
    "왜 합격인가" 를 설명할 수 있어야 근거다.
    """
    if not lot_id or not str(lot_id).strip():
        raise ToolArgumentError("lot_id 가 필요합니다.")
    key = str(lot_id).strip()
    t = thresholds(db)
    apply_statement_timeout(db)

    lot = db.execute(select(Lot).where(Lot.lot_id == key)).scalar_one_or_none()
    if lot is None:
        return ToolResult(
            tool="lot_quality_summary",
            scope=SCOPE,
            args={"lot_id": key},
            result={"meta": {"tool": "lot_quality_summary", "lot_id": key,
                             "pass_score": t.pass_score, "row_count": 0}},
            citation=Citation(kind="data", label="LOT 품질 요약",
                              detail=f"{key} · 조회 결과 없음",
                              link="/shipping/quality", count=0),
        )

    rows = db.execute(
        select(Quality).where(Quality.lot_id == lot.id).order_by(Quality.tested_at.desc())
    ).scalars().all()

    quality = []
    for q in rows:
        score = num(q.score, 2)
        quality.append({
            "lot_id": lot.lot_id,
            "score": score,
            "passed": q.passed,
            "tested_at": q.tested_at,
            "predicted_score": num(q.predicted_score, 2),
            "model_used": q.model_used,
            "pass_score": t.pass_score,
            "margin": round(score - t.pass_score, 2) if score is not None else None,
        })

    latest = quality[0] if quality else None
    verdict = None
    if latest is not None:
        verdict = (
            f"품질 점수 {latest['score']}점 · 합격선 {t.pass_score}점 "
            f"→ {'합격' if latest['passed'] else '불합격'}"
        )

    return ToolResult(
        tool="lot_quality_summary",
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
                "temp_exceeds_warn": (
                    lot.temperature is not None
                    and float(lot.temperature) > t.temp_warn_c
                ),
            },
            "quality": quality,
            "meta": {
                "tool": "lot_quality_summary",
                "lot_id": lot.lot_id,
                "pass_score": t.pass_score,
                "warn_score": t.warn_score,
                "temp_warn_c": t.temp_warn_c,
                "row_count": len(quality),
                "verdict": verdict,
            },
        },
        citation=Citation(
            kind="data",
            label="LOT 품질 요약",
            detail=f"{lot.lot_id} · 검사 {len(quality)}건 · 합격선 {t.pass_score}점",
            link="/shipping/quality",
            count=len(quality),
        ),
    )


# ══════════════════════════════════════════════════════════════════════════
# 3. lot_trace_full — 입고 → 생산 → 출하
# ══════════════════════════════════════════════════════════════════════════
#: §C-2.3 — 입고 원재료와 생산 LOT 을 잇는 기록이 없어 전 구간이 되지 않는다.
FULL_TRACE_LIMIT_NOTE = (
    "원재료가 어느 LOT 에 사용됐는지는 답할 수 없습니다. "
    "입고 데이터와 생산 LOT 을 연결하는 기록이 없어 추적은 공급사 단위까지만 가능합니다."
)


def lot_trace_full(db: Session, *, lot_id: str) -> ToolResult:
    """LOT 전 구간 — 공급사 · 생산 · 성분 · 품질 · 출하 · 클레임.

    ⚠ "입고" 구간은 **공급사 단위까지만** 간다. `receipts` ↔ `lots` FK 가 없다
    (§C-2.2 #10). 없는 조인을 만들어 `receipts` 행을 붙이면 그건 지어낸 추적이다.
    """
    if not lot_id or not str(lot_id).strip():
        raise ToolArgumentError("lot_id 가 필요합니다.")
    key = str(lot_id).strip()
    t = thresholds(db)
    apply_statement_timeout(db)

    row = db.execute(
        select(Lot, Supplier.code, Supplier.primary_material, Supplier.active)
        .join(Supplier, Lot.supplier_id == Supplier.id)
        .where(Lot.lot_id == key)
    ).first()

    if row is None:
        return ToolResult(
            tool="lot_trace_full",
            scope=SCOPE,
            args={"lot_id": key},
            result={"meta": {"tool": "lot_trace_full", "lot_id": key, "row_count": 0}},
            citation=Citation(kind="data", label="LOT 전 구간 추적",
                              detail=f"{key} · 조회 결과 없음",
                              link="/shipping/trace", count=0),
            notes=[FULL_TRACE_LIMIT_NOTE],
        )

    lot, code, primary_material, active = row
    comps = db.execute(
        select(Component).where(Component.lot_id == lot.id)
    ).scalars().all()
    qs = db.execute(
        select(Quality).where(Quality.lot_id == lot.id).order_by(Quality.tested_at.desc())
    ).scalars().all()
    ships = db.execute(
        select(Shipment).where(Shipment.lot_id == lot.id).order_by(Shipment.shipped_at.desc())
    ).scalars().all()
    cls = db.execute(
        select(Claim).where(Claim.lot_id == lot.id).order_by(Claim.created_at.desc())
    ).scalars().all()

    total = 1 + len(comps) + len(qs) + len(ships) + len(cls)
    return ToolResult(
        tool="lot_trace_full",
        scope=SCOPE,
        args={"lot_id": key},
        result={
            "suppliers": {"code": code, "primary_material": primary_material, "active": active},
            "lots": {
                "lot_id": lot.lot_id,
                "date": lot.date,
                "status": lot.status,
                "quality_score": num(lot.quality_score, 2),
                "temperature": num(lot.temperature, 1),
                "time_min": lot.time_min,
                "supplier_code": code,
                "temp_exceeds_warn": (
                    lot.temperature is not None and float(lot.temperature) > t.temp_warn_c
                ),
            },
            "components": [
                {
                    "lot_id": lot.lot_id, "date": c.date,
                    "sn": num(c.sn, 3), "ag": num(c.ag, 3),
                    "cu": num(c.cu, 3), "pb": num(c.pb, 3),
                    "sn_deviation": num(c.sn_deviation, 3),
                    "ag_deviation": num(c.ag_deviation, 3),
                    "cu_deviation": num(c.cu_deviation, 3),
                }
                for c in comps
            ],
            "quality": [
                {
                    "lot_id": lot.lot_id, "score": num(q.score, 2), "passed": q.passed,
                    "tested_at": q.tested_at, "model_used": q.model_used,
                    "pass_score": t.pass_score,
                }
                for q in qs
            ],
            "shipments": [
                {
                    "lot_id": lot.lot_id, "customer": s.customer, "product": s.product,
                    "quantity": num(s.quantity, 2), "unit": s.unit, "shipped_at": s.shipped_at,
                }
                for s in ships
            ],
            "claims": [
                {
                    "lot_id": lot.lot_id, "claim_no": c.claim_no, "customer": c.customer,
                    "status": c.status, "created_at": c.created_at,
                    "resolved_at": c.resolved_at,
                    "has_resolution": c.resolution is not None,
                }
                for c in cls
            ],
            "meta": {
                "tool": "lot_trace_full",
                "lot_id": lot.lot_id,
                "supplier_code": code,
                "pass_score": t.pass_score,
                "row_count": total,
            },
        },
        citation=Citation(
            kind="data",
            label="LOT 전 구간 추적",
            detail=(
                f"{lot.lot_id} · {code} · 성분 {len(comps)} · 품질 {len(qs)} "
                f"· 출하 {len(ships)} · 클레임 {len(cls)}"
            ),
            link="/shipping/trace",
            count=total,
        ),
        notes=[FULL_TRACE_LIMIT_NOTE],
    )


# ══════════════════════════════════════════════════════════════════════════
# 4. claim_search
# ══════════════════════════════════════════════════════════════════════════
CLAIM_STATUSES: tuple[str, ...] = ("open", "analyzing", "resolved", "rejected")


def claim_search(
    db: Session,
    *,
    date_from: Any,
    date_to: Any,
    customer: str | None = None,
    status: str | None = None,
    lot_id: str | None = None,
    limit: int | None = None,
) -> ToolResult:
    """클레임 목록. **0건은 유효한 결과다** — "해당 기간 클레임 0건" 은 사실이다.

    ⚠ `claims.reason` 은 자유서술이다. 도구는 화면용으로 반환하지만
    `redaction.ALLOWLIST` 가 **송출을 차단**한다 (§2.8.2 — "분류 코드만" 인데
    분류 컬럼이 없다).
    """
    a, b = require_date_range(date_from, date_to)
    n = clamp_limit(limit)
    if status is not None and status not in CLAIM_STATUSES:
        raise ToolArgumentError(f"status 는 {CLAIM_STATUSES} 중 하나여야 합니다: {status!r}")
    apply_statement_timeout(db)

    start = dt.datetime.combine(a, dt.time.min)
    end = dt.datetime.combine(b, dt.time.max)

    stmt = (
        select(Claim, Lot.lot_id)
        .join(Lot, Claim.lot_id == Lot.id)
        .where(Claim.created_at >= start, Claim.created_at <= end)
    )
    if customer:
        stmt = stmt.where(Claim.customer == customer)
    if status:
        stmt = stmt.where(Claim.status == status)
    if lot_id:
        stmt = stmt.where(Lot.lot_id == str(lot_id).strip())

    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(
        stmt.order_by(Claim.created_at.desc(), Claim.id.desc()).limit(n)
    ).all()

    claims = [
        {
            "lot_id": code,
            "claim_no": c.claim_no,
            "customer": c.customer,
            "reason": c.reason,          # 화면 전용 — 송출은 허용목록이 막는다
            "status": c.status,
            "created_at": c.created_at,
            "resolved_at": c.resolved_at,
            "has_resolution": c.resolution is not None,
        }
        for c, code in rows
    ]

    truncated = total > len(claims)
    notes = []
    if truncated:
        notes.append(f"조건에 맞는 {total}건 중 상위 {len(claims)}건만 조회했습니다.")

    return ToolResult(
        tool="claim_search",
        scope=SCOPE,
        args={"date_from": a.isoformat(), "date_to": b.isoformat(), "customer": customer,
              "status": status, "lot_id": lot_id, "limit": n},
        result={
            "claims": claims,
            "meta": {
                "tool": "claim_search",
                "date_from": a.isoformat(),
                "date_to": b.isoformat(),
                "customer": customer,
                "status": status,
                "lot_id": lot_id,
                "limit": n,
                "row_count": len(claims),
                "truncated": truncated,
            },
        },
        citation=Citation(
            kind="data",
            label="클레임 조회",
            detail=" · ".join(p for p in (customer, status, lot_id, fmt_range(a, b)) if p),
            link="/shipping/claims",
            count=len(claims),
        ),
        notes=notes,
    )


# ══════════════════════════════════════════════════════════════════════════
# 5. lot_match_for_customer — FR-S-05 "고객사 최적 LOT 매칭 추천"
# ══════════════════════════════════════════════════════════════════════════
def lot_match_for_customer(
    db: Session,
    *,
    customer: str,
    min_score: float | None = None,
    limit: int | None = None,
) -> ToolResult:
    """미출하 LOT 중 조건을 만족하는 **후보 목록**.

    `min_score` 를 주지 않으면 **합격선**(`quality.pass_score`)을 쓴다. 이건 지어낸
    기본값이 아니라 **명문화된 룰**(goal.md 2.3)이고, `min_score_source` 로 어느
    쪽인지 밝힌다 (§C-5 "조용히 기본값을 쓰면 그게 곧 지어내기다").

    고객사의 과거 출하 이력은 **참고 지표**로만 낸다 — 이 도구는 후보를 고르지
    않는다. 고르는 것은 사람이다.
    """
    if not customer or not str(customer).strip():
        raise ToolArgumentError(
            "customer 가 필요합니다. 어느 고객사 기준으로 찾을지 지정해 주세요."
        )
    who = str(customer).strip()
    t = thresholds(db)
    n = clamp_limit(limit)
    apply_statement_timeout(db)

    if min_score is None:
        floor = t.pass_score
        source = "quality.pass_score"
    else:
        try:
            floor = float(min_score)
        except (TypeError, ValueError) as exc:
            raise ToolArgumentError(f"min_score 는 숫자여야 합니다: {min_score!r}") from exc
        source = "caller"

    # 고객사 과거 실적 — 없으면 null 이다. 0 으로 채우지 않는다.
    hist = db.execute(
        select(
            func.count(Shipment.id),
            func.avg(Lot.quality_score),
        )
        .join(Lot, Shipment.lot_id == Lot.id)
        .where(Shipment.customer == who)
    ).one()
    hist_count, hist_avg = int(hist[0]), num(hist[1], 2)

    shipped = select(Shipment.lot_id).distinct()
    stmt = (
        select(Lot, Supplier.code)
        .join(Supplier, Lot.supplier_id == Supplier.id)
        .where(
            Lot.quality_score.is_not(None),
            Lot.quality_score >= floor,
            Lot.status.in_(("pass", "warning")),
            Lot.id.not_in(shipped),
        )
        .order_by(Lot.quality_score.desc(), Lot.date.desc())
    )
    total = db.execute(select(func.count()).select_from(stmt.subquery())).scalar_one()
    rows = db.execute(stmt.limit(n)).all()

    lots = [
        {
            "lot_id": lot.lot_id,
            "date": lot.date,
            "status": lot.status,
            "quality_score": num(lot.quality_score, 2),
            "temperature": num(lot.temperature, 1),
            "supplier_code": code,
            "sn_ratio": num(lot.sn_ratio, 3),
            "ag_ratio": num(lot.ag_ratio, 3),
            "cu_ratio": num(lot.cu_ratio, 3),
            "pb_ratio": num(lot.pb_ratio, 3),
        }
        for lot, code in rows
    ]

    notes = []
    if total > len(lots):
        notes.append(f"조건에 맞는 {total}건 중 상위 {len(lots)}건만 조회했습니다.")
    if hist_count == 0:
        notes.append(
            f"'{who}' 의 과거 출하 이력이 없어 고객사별 품질 실적은 비교할 수 없습니다."
        )

    return ToolResult(
        tool="lot_match_for_customer",
        scope=SCOPE,
        args={"customer": who, "min_score": floor, "limit": n},
        result={
            "lots": lots,
            "meta": {
                "tool": "lot_match_for_customer",
                "customer": who,
                "min_score": floor,
                "min_score_source": source,
                "pass_score": t.pass_score,
                "limit": n,
                "row_count": len(lots),
                "truncated": total > len(lots),
            },
        },
        citation=Citation(
            kind="data",
            label="고객사 LOT 후보",
            detail=(
                f"{who} · 미출하 LOT · 품질 {floor}점 이상"
                + (f" · 과거 출하 {hist_count}건 평균 {hist_avg}점" if hist_count else "")
            ),
            link="/shipping/list",
            count=len(lots),
        ),
        notes=notes,
    )


# ══════════════════════════════════════════════════════════════════════════
# 6. shipment_due_risk — 🔴 [X] 답할 수 없다
# ══════════════════════════════════════════════════════════════════════════
#: `plan-agent.md` §C-2.3 표준 문구. **숫자를 하나도 넣지 않는다.**
DUE_RISK_UNANSWERABLE = (
    "납기 및 지연 위험은 답할 수 없습니다. 출하 데이터에 납기일이 저장되지 않습니다. "
    "실제 출하 이력(출하 일시·수량·고객사)은 출하 관리(/shipping/list) 에서 확인할 수 있습니다."
)


def shipment_due_risk(db: Session, *, days: int = 14) -> ToolResult:
    """§3.3.3 은 `days=14` 로 납기 임박·지연을 낸다고 썼으나
    **`shipments` 에 `due_date`·`promised_date` 가 없고 수주 테이블도 없다**
    (`plan-agent.md` §C-2.1 #6 · `DEF-AG-012`).

    `shipped_at` 만으로 "지연"을 계산하면 **없는 납기를 지어내는 것**이다.
    → 숫자를 반환하지 않고 표준 문구를 돌려준다.
    """
    positive_days(days)   # 인자 검증은 그대로 한다 — 계약이 바뀌면 여기서 드러난다
    return unanswerable(
        tool="shipment_due_risk",
        scope=SCOPE,
        topic="due_date_risk",
        message=DUE_RISK_UNANSWERABLE,
        args={"days": int(days)},
    )


__all__ = [
    "CLAIM_STATUSES",
    "DUE_RISK_UNANSWERABLE",
    "FULL_TRACE_LIMIT_NOTE",
    "SCOPE",
    "claim_search",
    "lot_match_for_customer",
    "lot_quality_summary",
    "lot_trace_full",
    "shipment_due_risk",
    "shipment_history",
]
