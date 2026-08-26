"""G10 — KPI 관리 3화면 (`api-contract.md` §8.11).

| 경로 | 메서드 | 화면 | 권한 |
|---|---|---|---|
| `/kpi/production` | GET | FE-RT-43 | 전 역할 R |
| `/kpi/quality` | GET | FE-RT-44 | 전 역할 R |
| `/kpi/targets` | GET | FE-RT-45 | 전 역할 R |
| `/kpi/targets` | PUT | FE-RT-45 | admin·sales W |

셋 다 **벌거벗은 배열**이다 (§4.2 예외 — 월 단위 집계, 최대 36행 / 지표 6종 고정).

### 🔴 실적값 단일 출처 (§8.11.1 · 계약 결정 D-2)
> **모든 화면의 실적값은 `lots`/`quality`/`claims` 실시간 집계다. FE-RT-45 도 여기서 가져온다.**
> `kpi_targets.actual_value` 는 **월 마감 스냅샷 전용**(감사·이력 보존)이고
> **화면 표시의 출처가 아니다.**

당월에 FE-RT-43·44(실시간)와 FE-RT-45(배치)가 다른 숫자를 보이면 KPI 화면에서
목표 달성 여부가 화면마다 달라진다 — 치명적이다.

`achieved` 는 **서버가 판정한다.** 프론트가 지표별 판정 방향을 하드코딩하면
`defect_rate`·`claim_rate`(낮을수록 좋음)를 반대로 판정한다.
"""
from __future__ import annotations

import datetime as dt
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import String, case, cast, func, select
from sqlalchemy.orm import Session

from src.api.deps import get_current_user, get_db, require_roles
from src.api.serialization import iso, pct, safe_float
from src.db.models import Claim, KpiTarget, Lot, Quality, Shipment, User

router = APIRouter(prefix="/kpi", tags=["G10 KPI 관리"])

MAX_MONTHS = 36

KpiKey = Literal["yield_pct", "production_volume", "defect_rate",
                 "quality_avg", "pass_rate", "claim_rate"]

#: `api-contract.md` §8.11.1 표 — 라벨·단위·소수·방향. **프론트가 하드코딩하지 않게 서버가 준다.**
KPI_DIRECTION: dict[str, str] = {
    "yield_pct": "higher_better",
    "production_volume": "higher_better",
    "defect_rate": "lower_better",       # 낮을수록 좋음
    "quality_avg": "higher_better",
    "pass_rate": "higher_better",
    "claim_rate": "lower_better",        # 낮을수록 좋음
}
KPI_KEYS: tuple[str, ...] = tuple(KPI_DIRECTION)

_PRODUCTION_KEYS = ("yield_pct", "production_volume", "defect_rate")
_QUALITY_KEYS = ("quality_avg", "pass_rate", "claim_rate")


def _month_str(value) -> str:
    return str(value)


def _recent_months(months: int, end: dt.date | None = None) -> list[str]:
    """최근 N개월의 `"YYYY-MM"` 목록 (오름차순)."""
    anchor = end or dt.date.today()
    out: list[str] = []
    year, month = anchor.year, anchor.month
    for _ in range(months):
        out.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return list(reversed(out))


def _achieved(kpi_key: str, actual: float | None, target: float | None) -> bool | None:
    """목표 달성 판정. `target` 이 `null` 이면 `null` (판정하지 않는다)."""
    if target is None or actual is None:
        return None
    return actual >= target if KPI_DIRECTION[kpi_key] == "higher_better" else actual <= target


def _targets_map(db: Session, periods: list[str]) -> dict[tuple[str, str], KpiTarget]:
    if not periods:
        return {}
    rows = db.execute(select(KpiTarget).where(KpiTarget.period.in_(periods))).scalars().all()
    return {(r.kpi_key, r.period): r for r in rows}


# ══════════════════════════════════════════════════════════════════════════
# 실시간 집계 (단일 출처)
# ══════════════════════════════════════════════════════════════════════════
def _production_actuals(db: Session, periods: list[str]) -> dict[str, dict]:
    """`lots` 월별 집계 — 수율 · 생산량(LOT 수) · LOT 불량률."""
    month = func.to_char(Lot.date, "YYYY-MM")
    rows = db.execute(
        select(
            month.label("m"),
            func.count(Lot.id),
            func.count(case((Lot.status == "pass", 1))),
            func.count(case((Lot.status == "fail", 1))),
        ).where(month.in_(periods)).group_by(month)
    ).all()
    out: dict[str, dict] = {}
    for m, total, passed, failed in rows:
        total, passed, failed = int(total or 0), int(passed or 0), int(failed or 0)
        out[_month_str(m)] = {
            "yield_pct": pct(passed, total, 1),
            # `production_volume` 은 저장 컬럼이 없다 → COUNT(lots) 로 대체하고 단위는 "LOT"
            "production_volume": total,
            "defect_rate": pct(failed, total, 1),
        }
    return out


def _quality_actuals(db: Session, periods: list[str]) -> dict[str, dict]:
    """`quality`(평균 점수·합격률) + `claims`/`shipments`(클레임 발생률) 월별 집계."""
    q_month = func.to_char(Quality.tested_at, "YYYY-MM")
    q_rows = db.execute(
        select(
            q_month.label("m"),
            func.avg(Quality.score),
            func.count(Quality.id),
            func.count(case((Quality.passed.is_(True), 1))),
        ).where(q_month.in_(periods)).group_by(q_month)
    ).all()

    c_month = func.to_char(Claim.created_at, "YYYY-MM")
    c_rows = db.execute(
        select(c_month.label("m"), func.count(Claim.id))
        .where(c_month.in_(periods)).group_by(c_month)
    ).all()

    s_month = func.to_char(Shipment.shipped_at, "YYYY-MM")
    s_rows = db.execute(
        select(s_month.label("m"), func.count(Shipment.id))
        .where(s_month.in_(periods)).group_by(s_month)
    ).all()

    claims = {_month_str(m): int(c or 0) for m, c in c_rows}
    ships = {_month_str(m): int(c or 0) for m, c in s_rows}

    out: dict[str, dict] = {}
    for m, avg_score, total, passed in q_rows:
        key = _month_str(m)
        out[key] = {
            "quality_avg": safe_float(avg_score, 2),
            "pass_rate": pct(int(passed or 0), int(total or 0), 1),
            # 분모 확정 (§8.11.1): COUNT(claims) / COUNT(shipments) * 100.
            # 출하 건 대비 클레임 비율이다 — `lots` 분모가 아니다.
            "claim_rate": pct(claims.get(key, 0), ships.get(key, 0), 1),
        }
    for key in set(claims) | set(ships):
        out.setdefault(key, {"quality_avg": None, "pass_rate": None,
                             "claim_rate": pct(claims.get(key, 0), ships.get(key, 0), 1)})
    return out


def _all_actuals(db: Session, periods: list[str]) -> dict[str, dict]:
    prod = _production_actuals(db, periods)
    qual = _quality_actuals(db, periods)
    merged: dict[str, dict] = {}
    for period in periods:
        merged[period] = {
            **{k: None for k in KPI_KEYS},
            **prod.get(period, {}),
            **qual.get(period, {}),
        }
    return merged


def _rows_for(db: Session, months: int, keys: tuple[str, ...], value_field: str) -> list[dict]:
    periods = _recent_months(months)
    actuals = _all_actuals(db, periods)
    targets = _targets_map(db, periods)

    rows = []
    for period in periods:
        actual = actuals[period]
        target = {k: safe_float(targets[(k, period)].target_value, 3)
                     if (k, period) in targets else None
                  for k in keys}
        rows.append({
            "month": period,
            **{k: actual.get(k) for k in keys},
            "target": target,
            "achieved": {k: _achieved(k, actual.get(k), target[k]) for k in keys},
        })
    return rows


@router.get("/production", summary="FE-RT-43 생산 KPI")
def kpi_production(
    months: int = Query(12, ge=1, le=MAX_MONTHS),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """**벌거벗은 배열** (§4.2 예외). 실적값은 `lots` **실시간 집계**다.

    `frontend/lib/mock-data.ts` 의 `KPI_MONTHLY` 상수를 그대로 응답하지 마라.
    `production_volume` 은 저장 컬럼이 없다 → `COUNT(lots)` 로 대체하고 단위를 "LOT" 로 표기한다.
    """
    return _rows_for(db, months, _PRODUCTION_KEYS, "production")


@router.get("/quality", summary="FE-RT-44 품질 KPI")
def kpi_quality(
    months: int = Query(12, ge=1, le=MAX_MONTHS),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    return _rows_for(db, months, _QUALITY_KEYS, "quality")


@router.get("/targets", summary="FE-RT-45 KPI 목표 설정")
def kpi_targets(
    period: str = Query(None, pattern=r"^\d{4}-(0[1-9]|1[0-2])$", description="YYYY-MM"),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """지표 6종 고정 — **벌거벗은 배열** (§4.2 예외).

    * `actual_value` — **실시간 집계**다 (§8.11.1 단일 출처). 화면이 그대로 표시한다.
    * `snapshot_value` — `kpi_targets.actual_value` (월 마감 스냅샷). 감사·이력용이며
      화면 표시의 출처가 **아니다**.
    * `actual_updated_at` — 스냅샷 집계 시각. `NULL` = 아직 마감 안 됨.
    * `direction` — 서버가 준다. 프론트가 화살표 방향을 하드코딩하지 마라.

    ⚠ 계약 델타: `ts-types.md` §9.8 은 `actual_value` 주석을 "월 마감 스냅샷"으로
    적어 뒀으나 `api-contract.md` §8.11.1 이 "모든 화면의 실적값 = 실시간 집계,
    FE-RT-45 도 여기서 가져온다"로 확정했다. **API 계약을 따랐고**, 스냅샷은
    `snapshot_value` 로 따로 내보낸다.
    """
    target_period = period or dt.date.today().strftime("%Y-%m")
    actuals = _all_actuals(db, [target_period])[target_period]
    stored = _targets_map(db, [target_period])

    out = []
    for key in KPI_KEYS:
        row = stored.get((key, target_period))
        target_value = safe_float(row.target_value, 3) if row is not None else None
        actual = actuals.get(key)
        out.append({
            "kpi_key": key,
            "period": target_period,
            "target_value": target_value,
            "actual_value": actual,
            "snapshot_value": safe_float(row.actual_value, 3) if row is not None else None,
            "actual_updated_at": iso(row.actual_updated_at) if row is not None else None,
            "direction": KPI_DIRECTION[key],
            "achieved": _achieved(key, actual, target_value),
        })
    return out


class KpiTargetIn(BaseModel):
    kpi_key: KpiKey
    period: str = Field(..., pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    target_value: float


@router.put("/targets", summary="FE-RT-45 KPI 목표 저장 (admin·sales)")
def put_kpi_targets(
    body: list[KpiTargetIn],
    request: Request,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin", "sales")),
):
    """**전체 교체다** (§8.11.1).

    목표를 비우려면 **그 행을 아예 보내지 마라.** `target_value` 는 `NOT NULL` 이고
    **0 은 유효한 목표값**이므로 0 으로 보내면 안 된다.

    교체 범위는 **본문에 등장한 `period` 들**이다. 보내지 않은 달의 목표는 건드리지 않는다.
    `actual_value`(월 마감 스냅샷)는 보존한다 — `target_value` 만 갱신한다.
    """
    if not body:
        raise HTTPException(status_code=422, detail="목표를 1건 이상 보내야 합니다")

    keys = [(item.kpi_key, item.period) for item in body]
    if len(set(keys)) != len(keys):
        raise HTTPException(status_code=409, detail="중복된 값입니다 (kpi_key+period)")

    periods = sorted({item.period for item in body})
    existing = {
        (r.kpi_key, r.period): r
        for r in db.execute(select(KpiTarget).where(KpiTarget.period.in_(periods))).scalars().all()
    }
    before = [
        {"kpi_key": k, "period": p, "target_value": safe_float(r.target_value, 3)}
        for (k, p), r in existing.items()
    ]

    payload_keys = set(keys)
    for item in body:
        row = existing.get((item.kpi_key, item.period))
        if row is None:
            db.add(KpiTarget(kpi_key=item.kpi_key, period=item.period,
                             target_value=item.target_value))
        else:
            row.target_value = item.target_value   # actual_value 스냅샷은 보존한다
    for key, row in existing.items():
        if key not in payload_keys:
            db.delete(row)

    db.commit()

    from src.api.middleware import set_audit
    result = [
        item for period in periods
        for item in kpi_targets(period=period, db=db, _=None)  # type: ignore[arg-type]
    ]
    set_audit(request, target_table="kpi_targets", before=before,
              after=[{"kpi_key": i["kpi_key"], "period": i["period"],
                      "target_value": i["target_value"]} for i in result])
    return result
