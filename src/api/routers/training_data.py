"""G3 학습 데이터 · 성분 편차 — FE-RT-11·12 (`api-contract.md` §8.4).

| 경로 | 메서드 | 권한 |
|---|---|---|
| `/training-data` | GET | 전 역할 R |
| `/training-data/upload` | POST | admin·manufacture W |
| `/deviation/timeseries` | GET | 전 역할 R |
| `/deviation/by-supplier` | GET | 전 역할 R |

> **원천은 `lots` 다** (`formulation_history.csv` 가 아니다 — CSV 는 학습 스크립트
> 입력이고 화면은 DB 를 본다). 필드명은 ML 파이프라인 규약(`sn_pct`/`melt_temp_c`)을
> 따르며 `lots` 컬럼명(`sn_ratio`/`temperature`)과 다르다. **서버가 매핑한다**
> (`ts-types.md` §9.10).

⚠ `ISS-002` (편차 분석 공급사 필터) 는 v1 범위 밖이다 —
`/deviation/*` 에 `?supplier=` 파라미터를 넣지 마라 (§8.4.3).

⚠ 임계값·목표값을 코드에 하드코딩하지 않는다. `system_settings` 에서 읽고
기본값은 계약값이다 (`ml.sn_target` 62.0 / `deviation.warn_sn` **2.0**).
**화면에 박혀 있던 1.5·0.15·0.05 는 오류다** (`api-contract.md` §2.4).
"""
from __future__ import annotations

import csv
import datetime as dt
import io
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from src.api import settings_store
from src.api.deps import get_current_user, get_db, require_roles
from src.api.middleware import set_audit
from src.api.routers._shared import date_filters, unprocessable
from src.api.schemas import PageParams, page_of
from src.api.serialization import iso, safe_float, safe_int
from src.db.models import Component, Lot, Quality, Supplier

router = APIRouter(tags=["G3 배합비율 최적화AI"])

#: 업로드 CSV 의 컬럼 별칭 — 프로젝트가 이미 만들어 내는 `lots_seed.csv` 를
#: 그대로 올릴 수 있게 두 표기를 모두 받는다.
_ALIASES = {
    "lot_id": ("lot_id",),
    "date": ("date", "lot_date"),
    "supplier_code": ("supplier_code", "supplier_id", "supplier"),
    "sn_pct": ("sn_pct", "sn_ratio", "sn"),
    "ag_pct": ("ag_pct", "ag_ratio", "ag"),
    "cu_pct": ("cu_pct", "cu_ratio", "cu"),
    "pb_pct": ("pb_pct", "pb_ratio", "pb"),
    "melt_temp_c": ("melt_temp_c", "temperature"),
    "melt_time_min": ("melt_time_min", "time_min"),
    "quality_score": ("quality_score",),
}
_REQUIRED = ("lot_id", "date", "supplier_code", "sn_pct", "ag_pct", "cu_pct", "pb_pct")

#: 합계 허용 오차 — goal.md 2.3
_SUM_TOLERANCE = 0.05
#: 업로드 상한. 한 번에 이보다 많은 행을 받지 않는다 (NFR-P-01 보호).
_MAX_UPLOAD_ROWS = 20_000


def training_row(lot: Lot, supplier_code: str | None = None) -> dict:
    """`TrainingRowDto` — `ts-types.md` §9.10."""
    return {
        "lot_id": lot.lot_id,
        "date": iso(lot.date),
        "supplier_code": supplier_code if supplier_code is not None
                         else (lot.supplier.code if lot.supplier else None),
        "sn_pct": safe_float(lot.sn_ratio, 3),
        "ag_pct": safe_float(lot.ag_ratio, 3),
        "cu_pct": safe_float(lot.cu_ratio, 3),
        "pb_pct": safe_float(lot.pb_ratio, 3),
        "melt_temp_c": safe_float(lot.temperature, 1),
        "melt_time_min": safe_int(lot.time_min),
        "quality_score": safe_float(lot.quality_score, 2),
        # 서버 파생 — 학습에는 target 이 있는 행만 쓰인다
        "used_in_training": lot.quality_score is not None,
    }


def _lot_filters(stmt, supplier: str | None, date_from, date_to):
    if supplier:
        stmt = stmt.where(Lot.supplier_id == select(Supplier.id)
                          .where(Supplier.code == supplier).scalar_subquery())
    for cond in date_filters(Lot.date, date_from, date_to):
        stmt = stmt.where(cond)
    return stmt


@router.get("/training-data", dependencies=[Depends(get_current_user)],
            summary="FE-RT-11 학습 데이터 목록 + 요약")
def list_training_data(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    supplier: str | None = Query(None, description="공급사 코드"),
    date_from: dt.date | None = None,
    date_to: dt.date | None = None,
):
    """페이징 봉투 + `summary`.

    `summary` 는 **현재 페이지가 아니라 필터 전체**에 대한 집계다.
    표본이 1건이면 `quality_std` 는 `NULL` 이므로 그대로 `null` 을 내보낸다
    (0.0 으로 채우면 "편차 없음"과 구분이 안 된다 — `DEF-IT-002` 규약).
    """
    base = _lot_filters(select(Lot), supplier, date_from, date_to)

    total = int(db.execute(
        select(func.count()).select_from(base.subquery())
    ).scalar_one())
    agg = db.execute(_lot_filters(
        select(func.min(Lot.date), func.max(Lot.date),
               func.avg(Lot.quality_score), func.stddev_samp(Lot.quality_score)),
        supplier, date_from, date_to,
    )).one()

    stmt = base.options(joinedload(Lot.supplier)).order_by(
        pg.parse_sort({"date": Lot.date, "lot_id": Lot.lot_id,
                       "quality_score": Lot.quality_score}, Lot.date.desc()),
        Lot.lot_id.desc(),
    )
    rows = db.execute(stmt.limit(pg.page_size).offset(pg.offset)).scalars().all()

    body = page_of([training_row(lot) for lot in rows], total, pg)
    body["summary"] = {
        "rows": total,
        "date_min": iso(agg[0]),
        "date_max": iso(agg[1]),
        "quality_mean": safe_float(agg[2], 2),
        "quality_std": safe_float(agg[3], 2),
    }
    return body


@router.post("/training-data/upload", status_code=201,
             dependencies=[Depends(require_roles("admin", "manufacture"))],
             summary="FE-RT-11 학습 데이터 CSV 업로드")
async def upload_training_data(
    request: Request,
    db: Session = Depends(get_db),
    file: UploadFile = File(..., description="CSV (lots_seed.csv 형식 그대로 가능)"),
):
    """CSV 를 `lots` + `components` + `quality` 에 적재한다.

    응답: `{accepted, rejected, errors:[{row, message}]}` — `row` 는 **데이터 행 번호**
    (헤더 제외, 1부터).

    행 단위로 거른다 — 한 행이 틀렸다고 파일 전체를 되돌리지 않는다.
    거부 사유는 전부 `errors` 에 담아 화면이 어느 줄을 고쳐야 하는지 알려준다.

    | 거부 조건 | 메시지 |
    |---|---|
    | 필수 컬럼 누락 | `필수 항목 없음: …` |
    | 합계 ≠ 100% (±0.05) | goal.md 2.3 하드 룰 |
    | 공급사 코드가 `suppliers` 에 없음 | — |
    | `lot_id` 가 이미 존재 | UK 중복 |

    **편차 3종은 서버가 계산한다** (`sn - SN_TARGET` …) — CSV 의 편차 컬럼은 무시한다.
    """
    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise unprocessable("CSV 는 UTF-8 로 인코딩해야 합니다")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise unprocessable("CSV 헤더를 읽을 수 없습니다")

    header = {name.strip().lower(): name for name in reader.fieldnames}
    column: dict[str, str | None] = {
        field: next((header[a] for a in aliases if a in header), None)
        for field, aliases in _ALIASES.items()
    }
    missing = [f for f in _REQUIRED if column[f] is None]
    if missing:
        raise unprocessable(f"필수 컬럼 없음: {', '.join(missing)}")

    suppliers = {code: sid for sid, code in db.execute(select(Supplier.id, Supplier.code)).all()}
    existing = {code for (code,) in db.execute(select(Lot.lot_id)).all()}

    pass_score = float(settings_store.get(db, settings_store.K_PASS_SCORE, 70))
    warn_score = float(settings_store.get(db, settings_store.K_WARN_SCORE, 80))
    sn_t = float(settings_store.get(db, settings_store.K_SN_TARGET, 62.0))
    ag_t = float(settings_store.get(db, settings_store.K_AG_TARGET, 3.0))
    cu_t = float(settings_store.get(db, settings_store.K_CU_TARGET, 0.5))

    errors: list[dict[str, Any]] = []
    accepted = 0
    seen: set[str] = set()

    for index, row in enumerate(reader, start=1):
        if index > _MAX_UPLOAD_ROWS:
            errors.append({"row": index,
                           "message": f"업로드 상한 {_MAX_UPLOAD_ROWS:,}행을 초과했습니다"})
            break
        try:
            # ⚠ 행마다 SAVEPOINT 를 연다. 그냥 `db.rollback()` 하면 **앞서 성공한 행까지
            #   전부 되돌아간다** — 부분 수용(accepted/rejected)이 성립하지 않는다.
            with db.begin_nested():
                _insert_row(db, row, column, suppliers, existing, seen,
                            pass_score=pass_score, warn_score=warn_score,
                            sn_t=sn_t, ag_t=ag_t, cu_t=cu_t)
            accepted += 1
        except Exception as exc:  # noqa: BLE001 — 행 단위로 거른다
            errors.append({"row": index, "message": str(exc)})

    db.commit()
    set_audit(request, target_table="lots",
              after={"accepted": accepted, "rejected": len(errors),
                     "filename": file.filename})
    return {"accepted": accepted, "rejected": len(errors), "errors": errors}


def _insert_row(db: Session, row: dict, column: dict[str, str | None],
                suppliers: dict[str, int], existing: set[str], seen: set[str],
                *, pass_score: float, warn_score: float,
                sn_t: float, ag_t: float, cu_t: float) -> None:
    """CSV 한 줄 → `lots` + `components` (+`quality`). 실패하면 예외를 던진다."""
    values = {f: (row.get(column[f]) if column[f] else None) for f in _ALIASES}
    lot_code = (values["lot_id"] or "").strip()
    if not lot_code:
        raise ValueError("lot_id 가 비어 있습니다")
    if lot_code in existing or lot_code in seen:
        raise ValueError(f"{lot_code} 은(는) 이미 존재하는 LOT 입니다")

    day = dt.date.fromisoformat((values["date"] or "").strip()[:10])
    code = (values["supplier_code"] or "").strip()
    if code not in suppliers:
        raise ValueError(f"알 수 없는 공급사 코드: {code or '(비어 있음)'}")

    sn, ag, cu, pb = (float(values[f]) for f in ("sn_pct", "ag_pct", "cu_pct", "pb_pct"))
    if abs(sn + ag + cu + pb - 100.0) > _SUM_TOLERANCE:
        raise ValueError("성분 합계는 100%여야 합니다")

    raw_temp, raw_time, raw_score = (values["melt_temp_c"], values["melt_time_min"],
                                     values["quality_score"])
    temp = float(raw_temp) if raw_temp not in (None, "") else None
    tmin = int(round(float(raw_time))) if raw_time not in (None, "") else None
    score = float(raw_score) if raw_score not in (None, "") else None

    # `lots.status` 경계는 `db-schema.md` §3.1 — 점수가 없으면 `pending`
    status = "pending"
    if score is not None:
        status = ("pass" if score >= warn_score
                  else "warning" if score >= pass_score else "fail")

    lot = Lot(
        lot_id=lot_code, date=day, supplier_id=suppliers[code],
        sn_ratio=Decimal(f"{sn:.3f}"), ag_ratio=Decimal(f"{ag:.3f}"),
        cu_ratio=Decimal(f"{cu:.3f}"), pb_ratio=Decimal(f"{pb:.3f}"),
        temperature=None if temp is None else Decimal(f"{temp:.1f}"),
        time_min=tmin,
        quality_score=None if score is None else Decimal(f"{score:.2f}"),
        status=status,
    )
    db.add(lot)
    db.flush()
    db.add(Component(
        lot_id=lot.id, date=day,
        sn=Decimal(f"{sn:.3f}"), ag=Decimal(f"{ag:.3f}"),
        cu=Decimal(f"{cu:.3f}"), pb=Decimal(f"{pb:.3f}"),
        sn_deviation=Decimal(f"{sn - sn_t:.3f}"),
        ag_deviation=Decimal(f"{ag - ag_t:.3f}"),
        cu_deviation=Decimal(f"{cu - cu_t:.3f}"),
        analysis_method="XRF",
    ))
    if score is not None:
        db.add(Quality(
            lot_id=lot.id, score=Decimal(f"{score:.2f}"),
            passed=score >= pass_score, model_used="upload",
        ))
    seen.add(lot_code)


@router.get("/deviation/timeseries", dependencies=[Depends(get_current_user)],
            summary="FE-RT-12 성분 편차 추이")
def deviation_timeseries(
    db: Session = Depends(get_db),
    days: int = Query(90, ge=1, le=1095),
    component: str = Query("sn", pattern="^(sn|ag|cu)$"),
):
    """일자별 평균 성분과 목표값 대비 **절대 편차**.

    ⚠ 편차는 **절대값**이다 (`sn - 62.0`). 목표 대비 상대 %가 아니다 —
    차원이 다르면 화면이 정상으로 보이면서 경고 판정만 조용히 틀린다 (§2.4).
    """
    col = {"sn": Component.sn, "ag": Component.ag, "cu": Component.cu}[component]
    target = float(settings_store.get(db, {
        "sn": settings_store.K_SN_TARGET,
        "ag": settings_store.K_AG_TARGET,
        "cu": settings_store.K_CU_TARGET,
    }[component], {"sn": 62.0, "ag": 3.0, "cu": 0.5}[component]))
    warn = float(settings_store.get(db, {
        "sn": settings_store.K_DEV_SN,
        "ag": settings_store.K_DEV_AG,
        "cu": settings_store.K_DEV_CU,
    }[component], {"sn": 2.0, "ag": 0.3, "cu": 0.1}[component]))

    since = dt.date.today() - dt.timedelta(days=days)
    rows = db.execute(
        select(Component.date, func.avg(col))
        .where(Component.date >= since)
        .group_by(Component.date)
        .order_by(Component.date)
    ).all()

    points = []
    for day, value in rows:
        v = safe_float(value, 3)
        points.append({"date": iso(day), "value": v,
                       "deviation": None if v is None else round(v - target, 3)})
    return {"target": target, "points": points, "warn_threshold": warn}


@router.get("/deviation/by-supplier", dependencies=[Depends(get_current_user)],
            summary="FE-RT-12 공급사별 편차 비교")
def deviation_by_supplier(
    db: Session = Depends(get_db),
    days: int = Query(90, ge=1, le=1095),
):
    """공급사별 성분 **표준편차** 비교표.

    `recommended` 는 **서버가 계산한다** — `sn/ag/cu` 표준편차 합이 최소인 공급사다.
    프론트에 하드코딩하지 마라 (§8.4.3).
    표본이 부족해 표준편차가 없는 공급사는 추천 후보에서 제외한다.
    """
    since = dt.date.today() - dt.timedelta(days=days)
    rows = db.execute(
        select(
            Supplier.code,
            func.stddev_samp(Component.sn),
            func.stddev_samp(Component.ag),
            func.stddev_samp(Component.cu),
        )
        .select_from(Component)
        .join(Lot, Lot.id == Component.lot_id)
        .join(Supplier, Supplier.id == Lot.supplier_id)
        .where(Component.date >= since)
        .group_by(Supplier.code)
        .order_by(Supplier.code)
    ).all()

    suppliers = [{"code": code,
                  "sn": safe_float(sn, 4), "ag": safe_float(ag, 4), "cu": safe_float(cu, 4)}
                 for code, sn, ag, cu in rows]

    scored = [(s["sn"] + s["ag"] + s["cu"], s["code"]) for s in suppliers
              if None not in (s["sn"], s["ag"], s["cu"])]
    recommended = min(scored)[1] if scored else None
    return {
        "suppliers": suppliers,
        "recommended": recommended,
        "basis": "성분 안정성 최우수" if recommended else "표본 부족 — 추천 불가",
    }
