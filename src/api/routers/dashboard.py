"""G1 — AI 대시보드 4화면 (`api-contract.md` §8.2).

| 경로 | 화면 | 권한 |
|---|---|---|
| `/dashboard/production` | FE-RT-02 | 전 역할 R |
| `/dashboard/quality` | FE-RT-03 | 전 역할 R |
| `/dashboard/equipment` | FE-RT-04 | 전 역할 R |
| `/dashboard/shipping` | FE-RT-05 | 전 역할 R |

**FE-RT-02 KPI 4종 산식** (§8.2 — SF-TD3 §3.1 와이어프레임 카드 4개와 1:1):
    오늘 생산 LOT 수 = `COUNT(lots WHERE date = :date)`
    수율            = `COUNT(status='pass') / COUNT(*) * 100`
    불량률          = `COUNT(status='fail') / COUNT(*) * 100`
    평균 품질 점수  = `AVG(quality_score)`

`*_delta` 는 **전일 대비 증감**이다. 전일 데이터가 없으면 `null` 을 보내고 프론트는
증감 배지를 숨긴다. **0 으로 채우지 마라** — 0%p 변화와 구분이 안 된다.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session, selectinload

from src.api import settings_store
from src.api.deps import get_current_user, get_db
from src.api.dto import alert_dto, equipment_dto, lot_dto, quality_dto
from src.api.serialization import delta, pct, safe_float, safe_int
from src.db.models import Alert, Claim, Component, Equipment, Lot, Quality, Shipment, Supplier
from src.db.models import User

router = APIRouter(prefix="/dashboard", tags=["G1 AI 대시보드"],
                   dependencies=[Depends(get_current_user)])


# ── 내부 집계 ────────────────────────────────────────────────────────────
def _daily_stats(db: Session, day: dt.date) -> dict:
    """하루치 LOT 집계. 행이 없으면 값은 전부 `None` 이다 (0 이 아니다)."""
    row = db.execute(
        select(
            func.count(Lot.id),
            func.count(case((Lot.status == "pass", 1))),
            func.count(case((Lot.status == "fail", 1))),
            func.avg(Lot.quality_score),
        ).where(Lot.date == day)
    ).one()
    total, passed, failed, avg_q = int(row[0] or 0), int(row[1] or 0), int(row[2] or 0), row[3]
    return {
        "lots": total,
        "yield_pct": pct(passed, total),
        "defect_rate": pct(failed, total),
        "avg_quality": safe_float(avg_q, 2),
    }


@router.get("/production", summary="FE-RT-02 생산 현황")
def production(
    date: dt.date | None = Query(None, description="기준일 (기본: 데이터 최신일)"),
    db: Session = Depends(get_db),
):
    # 기준일 미지정 시 오늘. 데이터가 없으면 `lots` 의 최신일로 떨어진다
    # (시드가 과거 날짜만 갖는 개발 환경에서 빈 대시보드를 피한다).
    target = date or dt.date.today()
    if date is None:
        latest = db.execute(select(func.max(Lot.date))).scalar_one_or_none()
        if latest is not None and latest < target:
            target = latest

    today = _daily_stats(db, target)
    yesterday = _daily_stats(db, target - dt.timedelta(days=1))

    # 주간 수율 — 기준일 포함 7일
    week_start = target - dt.timedelta(days=6)
    weekly_rows = db.execute(
        select(
            Lot.date,
            func.count(Lot.id),
            func.count(case((Lot.status == "pass", 1))),
        )
        .where(Lot.date >= week_start, Lot.date <= target)
        .group_by(Lot.date)
        .order_by(Lot.date)
    ).all()
    by_date = {r[0]: (int(r[1] or 0), int(r[2] or 0)) for r in weekly_rows}
    weekly_yield = []
    for offset in range(7):
        day = week_start + dt.timedelta(days=offset)
        total, passed = by_date.get(day, (0, 0))
        weekly_yield.append({"date": day.isoformat(), "value": pct(passed, total)})

    alerts = db.execute(
        select(Alert).options(selectinload(Alert.lot))
        .where(Alert.resolved.is_(False))
        .order_by(Alert.created_at.desc()).limit(10)
    ).scalars().all()

    recent_lots = db.execute(
        select(Lot).options(selectinload(Lot.supplier))
        .order_by(Lot.date.desc(), Lot.id.desc()).limit(10)
    ).scalars().all()

    return {
        "date": target.isoformat(),
        "kpi": {
            "today_lots": today["lots"],
            "yield_pct": today["yield_pct"],
            "defect_rate": today["defect_rate"],
            "avg_quality": today["avg_quality"],
            # 전일 데이터가 없으면 null — 0 으로 채우지 않는다 (§8.2)
            "today_lots_delta": (today["lots"] - yesterday["lots"]) if yesterday["lots"] else None,
            "yield_pct_delta": delta(today["yield_pct"], yesterday["yield_pct"]),
            "defect_rate_delta": delta(today["defect_rate"], yesterday["defect_rate"]),
            "avg_quality_delta": delta(today["avg_quality"], yesterday["avg_quality"]),
        },
        "weekly_yield": weekly_yield,
        "alerts": [alert_dto(a) for a in alerts],
        "recent_lots": [lot_dto(lot) for lot in recent_lots],
    }


#: 품질 점수 분포 구간. SF-AD2/TD3 에 구간 정의가 없어 **10점 단위**로 잡았고,
#: 합격선 70 과 `lots.status` 경고 경계 80 이 구간 경계에 정확히 걸리게 했다.
_SCORE_BINS: tuple[tuple[str, float | None, float | None], ...] = (
    ("~60", None, 60.0),
    ("60-70", 60.0, 70.0),
    ("70-80", 70.0, 80.0),
    ("80-90", 80.0, 90.0),
    ("90-100", 90.0, None),
)


@router.get("/quality", summary="FE-RT-03 품질 분석")
def quality_dashboard(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    since = dt.date.today() - dt.timedelta(days=days)

    # 점수 분포
    distribution = []
    for label, low, high in _SCORE_BINS:
        stmt = select(func.count(Lot.id)).where(Lot.date >= since, Lot.quality_score.isnot(None))
        if low is not None:
            stmt = stmt.where(Lot.quality_score >= low)
        if high is not None:
            stmt = stmt.where(Lot.quality_score < high)
        distribution.append({"range": label, "count": int(db.execute(stmt).scalar_one() or 0)})

    # 합격/경고/불합격 — `lots.status` 기준 (서버 판정값이 단일 출처)
    status_rows = db.execute(
        select(Lot.status, func.count(Lot.id)).where(Lot.date >= since).group_by(Lot.status)
    ).all()
    counts = {str(r[0]): int(r[1]) for r in status_rows}
    pass_fail = {
        "pass": counts.get("pass", 0),
        "warning": counts.get("warning", 0),
        "fail": counts.get("fail", 0),
    }

    # 공급사별 평균 절대 편차 (성분 편차 히트맵)
    heatmap_rows = db.execute(
        select(
            Supplier.code,
            func.avg(func.abs(Component.sn_deviation)),
            func.avg(func.abs(Component.ag_deviation)),
            func.avg(func.abs(Component.cu_deviation)),
        )
        .join(Lot, Component.lot_id == Lot.id)
        .join(Supplier, Lot.supplier_id == Supplier.id)
        .where(Component.date >= since)
        .group_by(Supplier.code)
        .order_by(Supplier.code)
    ).all()
    heatmap = [
        {
            "supplier": r[0],
            "sn": safe_float(r[1], 3),
            "ag": safe_float(r[2], 3),
            "cu": safe_float(r[3], 3),
        }
        for r in heatmap_rows
    ]

    # `recent` 도 **`days` 범위를 따른다.**
    # 초판은 필터 없이 최신 10건을 그냥 집었다. 그래서 화면에서 기간 탭을 7일로 바꿔도
    # 위쪽 분포·히트맵만 바뀌고 아래 표는 그대로여서, **같은 화면의 두 영역이 서로 다른
    # 기간을 말하는** 상태가 됐다 (QA-A D-07).
    recent = db.execute(
        select(Quality).options(selectinload(Quality.lot))
        .join(Lot, Lot.id == Quality.lot_id)
        .where(Lot.date >= since)
        .order_by(Quality.tested_at.desc()).limit(10)
    ).scalars().all()

    return {
        "days": days,
        "score_distribution": distribution,
        "pass_fail": pass_fail,
        "deviation_heatmap": heatmap,
        "recent": [quality_dto(q) for q in recent],
    }


@router.get("/equipment", summary="FE-RT-04 설비 모니터링")
def equipment_dashboard(db: Session = Depends(get_db)):
    """폴링 전용이다. **WebSocket 을 쓰지 마라** — SF-TD2 에 설계가 없다 (§8.6).

    프론트는 10초 간격으로 이 엔드포인트를 다시 부른다.
    `temp_warning` 은 서버가 판정한다 — 프론트가 255 를 하드코딩하지 않게 한다.
    """
    temp_warn = float(settings_store.get(db, settings_store.K_TEMP_WARN, 255))
    items = db.execute(select(Equipment).order_by(Equipment.eq_id)).scalars().all()
    summary = {"normal": 0, "warning": 0, "error": 0, "maintenance": 0}
    for eq in items:
        if eq.status in summary:
            summary[eq.status] += 1
    return {
        "items": [equipment_dto(eq, temp_warn) for eq in items],
        "summary": summary,
        "temp_warn_c": temp_warn,
    }


@router.get("/shipping", summary="FE-RT-05 출하 현황")
def shipping_dashboard(
    days: int = Query(7, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """`claims` 테이블이 실재하므로 **실집계한다** (§8.2).

    `status IN ('open','analyzing')` → open, `status IN ('resolved','rejected')` → closed.
    """
    now = dt.datetime.now()
    today_start = dt.datetime.combine(now.date(), dt.time.min)
    window_start = today_start - dt.timedelta(days=days - 1)

    today_qty = db.execute(
        select(func.sum(Shipment.quantity)).where(Shipment.shipped_at >= today_start)
    ).scalar_one_or_none()
    week_qty = db.execute(
        select(func.sum(Shipment.quantity)).where(Shipment.shipped_at >= window_start)
    ).scalar_one_or_none()

    by_customer_rows = db.execute(
        select(Shipment.customer, func.sum(Shipment.quantity))
        .where(Shipment.shipped_at >= window_start)
        .group_by(Shipment.customer)
        .order_by(func.sum(Shipment.quantity).desc())
    ).all()

    claim_rows = db.execute(
        select(Claim.status, func.count(Claim.id)).group_by(Claim.status)
    ).all()
    claim_counts = {str(r[0]): int(r[1]) for r in claim_rows}

    return {
        "days": days,
        "today_qty": safe_float(today_qty, 2) or 0.0,
        "week_qty": safe_float(week_qty, 2) or 0.0,
        "by_customer": [
            {"customer": r[0], "quantity": safe_float(r[1], 2)} for r in by_customer_rows
        ],
        "claims": {
            "open": claim_counts.get("open", 0) + claim_counts.get("analyzing", 0),
            "closed": claim_counts.get("resolved", 0) + claim_counts.get("rejected", 0),
        },
    }
