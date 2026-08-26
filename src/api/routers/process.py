"""G5 공정 **집계** 2종 — FE-RT-21 · FE-RT-25 (`api-contract.md` §8.6).

| 경로 | 메서드 | 화면 | 권한 |
|---|---|---|---|
| `/process/performance` | GET | **FE-RT-21** 생산 실적 | 전 역할 R |
| `/process/analysis` | GET | **FE-RT-25** 공정 분석 (선택) | 전 역할 R |

> 담당 경계: `/process/conditions`·`/process/history` 는 **개발1**(`process_conditions.py`),
> 이 두 집계 엔드포인트는 **개발2**다.

### `input_qty` / `output_qty` — 저장 컬럼이 없다
FR-P-01 이 투입량/산출량을 요구하나 SF-TD5 **어디에도 컬럼이 없다**.
`lots` 로는 LOT 수와 수율만 낼 수 있다 → **`null` 로 보내고 FE-RT-21 은 해당 열을 숨긴다**
(goal.md 미해결 #5 · api-contract §10 #5). **0 으로 채우지 마라** — 실제 0 과 구분이 안 된다.

### `?factor=` 로 산점도 X축을 고른다 (기획2 지적)
없으면 `scatter` 가 단일 시리즈인데 어느 인자의 산점도인지 알 수 없어 인자 전환 기능이
구현 불가다. 응답의 `scatter.factor` 로 **어느 인자를 그린 것인지 되돌려준다** —
응답이 자기 자신을 설명하게 한다.

### `DEF-IT-002` 주의
상관계수는 **분산이 0이거나 표본이 1건이면 `NaN`** 이다. 그대로 내보내면 프론트
`JSON.parse` 가 깨진다 → `safe_float()` 로 `null` 로 떨군다 (§4.1).
"""
from __future__ import annotations

import datetime as dt
from typing import Literal

import numpy as np
from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from src.api.deps import get_current_user, get_db
from src.api.serialization import pct, safe_float
from src.db.models import Lot, User

router = APIRouter(prefix="/process", tags=["G5 공정관리 (집계)"],
                   dependencies=[Depends(get_current_user)])

#: `?factor=` 화이트리스트 → `lots` 컬럼. 임의 컬럼명을 SQL 로 흘리지 않는다 (NFR-S-05).
#: 이름은 ML 파이프라인 규약(`sn_pct`)을 따르고 `lots` 컬럼명(`sn_ratio`)과 다르다 —
#: 서버가 매핑한다 (§8.4.4 와 같은 규약).
_FACTORS = {
    "temperature": Lot.temperature,
    "time_min": Lot.time_min,
    "sn_pct": Lot.sn_ratio,
    "ag_pct": Lot.ag_ratio,
    "cu_pct": Lot.cu_ratio,
}

#: `?period=` → PostgreSQL `to_char` 포맷
_PERIOD_FORMAT = {"day": "YYYY-MM-DD", "week": "IYYY-\"W\"IW", "month": "YYYY-MM"}


@router.get("/performance", summary="FE-RT-21 생산 실적 집계")
def performance(
    period: Literal["day", "week", "month"] = Query("day"),
    date_from: dt.date | None = Query(None),
    date_to: dt.date | None = Query(None),
    db: Session = Depends(get_db),
):
    """**벌거벗은 배열** (§4.2 예외 — 기간 집계라 행 수가 기간에 종속돼 페이징 의미가 없다).

    `input_qty`/`output_qty` 는 **항상 `null`** 이다. 저장 컬럼이 없다.
    `process/performance` 는 집계 결과라 **export 대상이 아니다** →
    FE-RT-21 내보내기 버튼은 만들지 마라 (§8.9).
    """
    bucket = func.to_char(Lot.date, _PERIOD_FORMAT[period])
    stmt = (
        select(
            bucket.label("bucket"),
            func.count(Lot.id),
            func.count(case((Lot.status == "pass", 1))),
            func.count(case((Lot.status == "fail", 1))),
            func.count(case((Lot.status == "warning", 1))),
        )
        .group_by(bucket)
        .order_by(bucket)
    )
    if date_from is not None:
        stmt = stmt.where(Lot.date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Lot.date <= date_to)

    rows = db.execute(stmt).all()
    return [
        {
            "period": str(bucket_value),
            "lot_count": int(total or 0),
            "pass_count": int(passed or 0),
            "fail_count": int(failed or 0),
            "warning_count": int(warned or 0),
            # ⚠ 저장 컬럼 부재 — null 을 0 으로 바꾸지 마라 (§8.6)
            "input_qty": None,
            "output_qty": None,
            "yield_pct": pct(int(passed or 0), int(total or 0), 1),
        }
        for bucket_value, total, passed, failed, warned in rows
    ]


@router.get("/analysis", summary="FE-RT-25 공정 분석 (선택)")
def analysis(
    days: int = Query(90, ge=1, le=730),
    factor: Literal["temperature", "time_min", "sn_pct", "ag_pct", "cu_pct"] = Query("temperature"),
    db: Session = Depends(get_db),
):
    """공정 인자 ↔ 품질 상관 + 선택 인자의 산점도.

    `scatter.factor` 로 **어느 인자를 그린 것인지 되돌려준다** — 응답이 자기 자신을 설명한다.
    상관계수가 `NaN`(분산 0 · 표본 1건)이면 `null` 로 나간다 (`DEF-IT-002`).
    """
    since = dt.date.today() - dt.timedelta(days=days)

    columns = list(_FACTORS.values())
    rows = db.execute(
        select(*columns, Lot.quality_score)
        .where(Lot.date >= since, Lot.quality_score.isnot(None))
    ).all()

    sample_size = len(rows)
    names = list(_FACTORS)

    correlations = []
    scatter_points: list[dict] = []
    if sample_size >= 2:
        matrix = np.array(
            [[None if v is None else float(v) for v in row] for row in rows], dtype=object
        )
        quality = np.array([float(r[-1]) for r in rows], dtype=float)
        for index, name in enumerate(names):
            column = matrix[:, index]
            mask = np.array([v is not None for v in column])
            if mask.sum() < 2:
                correlations.append({"factor": name, "quality_corr": None})
                continue
            values = np.array([float(v) for v in column[mask]], dtype=float)
            paired = quality[mask]
            # 분산이 0이면 np.corrcoef 는 NaN 을 돌려준다 → safe_float 이 null 로 떨군다
            with np.errstate(invalid="ignore", divide="ignore"):
                corr = np.corrcoef(values, paired)[0, 1]
            correlations.append({"factor": name, "quality_corr": safe_float(corr, 4)})

        chosen = names.index(factor)
        for row in rows[:300]:      # 산점도는 300점이면 충분하다 (렌더 비용 상한)
            x = row[chosen]
            if x is None:
                continue
            scatter_points.append({"x": safe_float(x, 3), "y": safe_float(row[-1], 2)})
    else:
        correlations = [{"factor": name, "quality_corr": None} for name in names]

    return {
        "days": days,
        "sample_size": sample_size,
        "correlations": correlations,
        "scatter": {"factor": factor, "points": scatter_points},
    }
