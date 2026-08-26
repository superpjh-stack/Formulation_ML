"""G8 — 데이터관리시스템 5화면 (`api-contract.md` §8.9).

| 경로 | 메서드 | 화면 | 권한 |
|---|---|---|---|
| `/integrations` | GET·PUT | FE-RT-33 데이터 연동 | **admin** |
| `/integrations/{system}/test` | POST | FE-RT-33 | **admin** |
| `/data/query` | GET | FE-RT-34 | 전 역할 R |
| `/eda-stats` | GET | FE-RT-35 | 전 역할 R |
| `/data/visualization` | GET | FE-RT-35 | 전 역할 R |
| `/data/export` | GET | FE-RT-36 | 전 역할 R |
| `/training-datasets` | GET | FE-RT-37 (선택) | **501** — 저장 테이블 없음 |

* `/data/query` 는 **`entity` 화이트리스트**로만 동작한다. 임의 테이블명이나 SQL
  조각을 받지 마라 — NFR-S-05 (SQL Injection 방지).
* `/data/export` 는 **유일하게 JSON 이 아닌 응답**이다. 최대 **10만 행**, 초과 시 422.
* `/eda-stats` 는 `DEF-IT-002` 재발 주의 — `np.histogram` 결과를 `int()`,
  통계를 `float()` 로 캐스팅하고 **NaN 을 `null` 로** 바꾼다 (§4.1).
"""
from __future__ import annotations

import csv
import datetime as dt
import io
import time
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from src.api import settings_store
from src.api.deps import get_current_user, get_db, require_roles
from src.api.errors import NOT_IMPLEMENTED_DETAIL
from src.api.middleware import set_audit
from src.api.schemas import PageParams
from src.api.serialization import iso, safe_float, safe_int
from src.db.models import Component, Lot, Quality, Shipment, Supplier, User

router = APIRouter(tags=["G8 데이터관리시스템"])

#: `/data/export` 행 상한 (§8.9). 초과 시 422.
EXPORT_MAX_ROWS = 100_000


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-33 데이터 연동 — `/integrations`
# ══════════════════════════════════════════════════════════════════════════
class IntegrationIn(BaseModel):
    system: Literal["erp", "xrf"]
    type: str = Field("REST", max_length=50)
    endpoint: str = Field("", max_length=200)
    enabled: bool = False


@router.get("/integrations", summary="FE-RT-33 연동 설정 (admin)")
def list_integrations(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """**벌거벗은 배열**. `system` 이 식별자다 (`id` 가 아니다 — §8.9.1).

    `last_sync_at` 은 **항상 `null`** (담을 컬럼이 없다).
    `status` 는 `enabled` 에서 2값 파생 — `in_use` / `not_in_use`.
    """
    return settings_store.integrations(db)


@router.put("/integrations", summary="FE-RT-33 연동 설정 교체 (admin)")
def put_integrations(
    body: list[IntegrationIn],
    request: Request,
    db: Session = Depends(get_db),
    actor: User = Depends(require_roles("admin")),
):
    """**`integration.*` 안에서만 replace 한다** (§8.9.1).

    `system_settings` 전체를 갈아엎으면 FE-RT-29 가 관리하는 `ml.*`/`quality.*` 키가 날아간다.

    ⛔ 자격증명(비밀번호·API 키)을 저장하지 마라. 서버 환경변수에 둔다.
    """
    seen = [item.system for item in body]
    if len(set(seen)) != len(seen):
        raise HTTPException(status_code=409, detail="중복된 값입니다 (system)")

    before = settings_store.integrations(db)
    for item in body:
        prefix = f"{settings_store.INTEGRATION_PREFIX}{item.system}"
        settings_store.upsert(db, f"{prefix}.enabled", bool(item.enabled), updated_by=actor.id)
        settings_store.upsert(db, f"{prefix}.endpoint", item.endpoint, updated_by=actor.id)
        settings_store.upsert(db, f"{prefix}.type", item.type, updated_by=actor.id)
    db.commit()

    after = settings_store.integrations(db)
    set_audit(request, target_table="system_settings", before=before, after=after)
    return after


@router.post("/integrations/{system}/test", summary="FE-RT-33 연결 테스트 (admin)")
def test_integration(
    system: Literal["erp", "xrf"],
    db: Session = Depends(get_db),
    _: User = Depends(require_roles("admin")),
):
    """연결 **설정** 확인까지가 v1 범위다 (FR-DT-01).

    실제 소켓을 열지 않는다 — 자격증명이 서버 환경변수에 있고 동기화 엔진이 v1 에
    없기 때문이다 (§8.9.1: "실제 동기화 엔진을 붙일 때 `integrations` 테이블을
    별도 CR 로 올린다"). 여기서는 **설정 유효성**만 판정하고 그 사실을
    `message` 에 명시한다. **연결된 것처럼 위장하지 않는다.**
    """
    started = time.perf_counter()
    config = next((i for i in settings_store.integrations(db) if i["system"] == system), None)
    latency_ms = safe_int((time.perf_counter() - started) * 1000)

    if config is None:
        raise HTTPException(status_code=404, detail=f"{system} 연동 설정을 찾을 수 없습니다")
    if not config["enabled"]:
        return {"ok": False, "latency_ms": latency_ms, "message": "연동이 비활성 상태입니다"}
    if not config["endpoint"]:
        return {"ok": False, "latency_ms": latency_ms, "message": "엔드포인트가 설정되지 않았습니다"}
    if not str(config["endpoint"]).startswith(("http://", "https://")):
        return {"ok": False, "latency_ms": latency_ms,
                "message": "엔드포인트는 http:// 또는 https:// 로 시작해야 합니다"}
    return {
        "ok": True,
        "latency_ms": latency_ms,
        "message": "설정 확인 완료 (v1 은 설정 검증까지만 수행합니다 — 실제 연결 테스트 아님)",
    }


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-34 데이터 조회 — `/data/query`
# ══════════════════════════════════════════════════════════════════════════
#: `entity` 화이트리스트 (§8.9). 임의 테이블명을 받지 마라 — NFR-S-05.
QueryEntity = Literal["lots", "components", "quality"]
ExportEntity = Literal["lots", "components", "quality", "shipments"]

#: `columns` 를 같이 내려주면 FE-RT-34 가 테이블 헤더를 하드코딩하지 않아도 된다.
_COLUMNS: dict[str, list[dict[str, str]]] = {
    "lots": [
        {"key": "lot_id", "label": "LOT ID", "type": "string"},
        {"key": "date", "label": "생산일", "type": "date"},
        {"key": "supplier_code", "label": "공급사", "type": "string"},
        {"key": "sn_ratio", "label": "Sn (%)", "type": "number"},
        {"key": "ag_ratio", "label": "Ag (%)", "type": "number"},
        {"key": "cu_ratio", "label": "Cu (%)", "type": "number"},
        {"key": "pb_ratio", "label": "Pb (%)", "type": "number"},
        {"key": "temperature", "label": "용해 온도 (°C)", "type": "number"},
        {"key": "time_min", "label": "가열 시간 (분)", "type": "number"},
        {"key": "quality_score", "label": "품질 점수", "type": "number"},
        {"key": "status", "label": "상태", "type": "string"},
    ],
    "components": [
        {"key": "lot_id", "label": "LOT ID", "type": "string"},
        {"key": "date", "label": "측정일", "type": "date"},
        {"key": "sn", "label": "Sn (%)", "type": "number"},
        {"key": "ag", "label": "Ag (%)", "type": "number"},
        {"key": "cu", "label": "Cu (%)", "type": "number"},
        {"key": "pb", "label": "Pb (%)", "type": "number"},
        {"key": "sn_deviation", "label": "Sn 편차", "type": "number"},
        {"key": "ag_deviation", "label": "Ag 편차", "type": "number"},
        {"key": "cu_deviation", "label": "Cu 편차", "type": "number"},
        {"key": "analysis_method", "label": "분석 방법", "type": "string"},
    ],
    "quality": [
        {"key": "lot_id", "label": "LOT ID", "type": "string"},
        {"key": "score", "label": "품질 점수", "type": "number"},
        {"key": "passed", "label": "합격", "type": "boolean"},
        {"key": "model_used", "label": "사용 모델", "type": "string"},
        {"key": "predicted_score", "label": "예측 점수", "type": "number"},
        {"key": "tested_at", "label": "검사 시각", "type": "datetime"},
    ],
    "shipments": [
        {"key": "lot_id", "label": "LOT ID", "type": "string"},
        {"key": "customer", "label": "고객사", "type": "string"},
        {"key": "product", "label": "제품", "type": "string"},
        {"key": "quantity", "label": "수량", "type": "number"},
        {"key": "unit", "label": "단위", "type": "string"},
        {"key": "shipped_at", "label": "출하 시각", "type": "datetime"},
    ],
}


def _entity_query(entity: str, supplier: str | None, date_from: dt.date | None,
                  date_to: dt.date | None, lot_id: str | None):
    """화이트리스트 엔티티만 SELECT 를 만든다. 반환: `(stmt, row_mapper)`."""
    if entity == "lots":
        stmt = (select(Lot, Supplier.code)
                .join(Supplier, Lot.supplier_id == Supplier.id)
                .order_by(Lot.date.desc(), Lot.id.desc()))
        if supplier:
            stmt = stmt.where(Supplier.code == supplier)
        if date_from:
            stmt = stmt.where(Lot.date >= date_from)
        if date_to:
            stmt = stmt.where(Lot.date <= date_to)
        if lot_id:
            stmt = stmt.where(Lot.lot_id.ilike(f"%{lot_id}%"))

        def _map(row):
            lot, code = row
            return {
                "lot_id": lot.lot_id, "date": iso(lot.date), "supplier_code": code,
                "sn_ratio": safe_float(lot.sn_ratio, 3), "ag_ratio": safe_float(lot.ag_ratio, 3),
                "cu_ratio": safe_float(lot.cu_ratio, 3), "pb_ratio": safe_float(lot.pb_ratio, 3),
                "temperature": safe_float(lot.temperature, 1), "time_min": safe_int(lot.time_min),
                "quality_score": safe_float(lot.quality_score, 2), "status": lot.status,
            }
        return stmt, _map

    if entity == "components":
        stmt = (select(Component, Lot.lot_id, Supplier.code)
                .join(Lot, Component.lot_id == Lot.id)
                .join(Supplier, Lot.supplier_id == Supplier.id)
                .order_by(Component.date.desc(), Component.id.desc()))
        if supplier:
            stmt = stmt.where(Supplier.code == supplier)
        if date_from:
            stmt = stmt.where(Component.date >= date_from)
        if date_to:
            stmt = stmt.where(Component.date <= date_to)
        if lot_id:
            stmt = stmt.where(Lot.lot_id.ilike(f"%{lot_id}%"))

        def _map(row):
            comp, code, _sup = row
            return {
                "lot_id": code, "date": iso(comp.date),
                "sn": safe_float(comp.sn, 3), "ag": safe_float(comp.ag, 3),
                "cu": safe_float(comp.cu, 3), "pb": safe_float(comp.pb, 3),
                "sn_deviation": safe_float(comp.sn_deviation, 3),
                "ag_deviation": safe_float(comp.ag_deviation, 3),
                "cu_deviation": safe_float(comp.cu_deviation, 3),
                "analysis_method": comp.analysis_method,
            }
        return stmt, _map

    if entity == "quality":
        stmt = (select(Quality, Lot.lot_id, Supplier.code)
                .join(Lot, Quality.lot_id == Lot.id)
                .join(Supplier, Lot.supplier_id == Supplier.id)
                .order_by(Quality.tested_at.desc(), Quality.id.desc()))
        if supplier:
            stmt = stmt.where(Supplier.code == supplier)
        if date_from:
            stmt = stmt.where(Quality.tested_at >= dt.datetime.combine(date_from, dt.time.min))
        if date_to:
            stmt = stmt.where(Quality.tested_at <= dt.datetime.combine(date_to, dt.time.max))
        if lot_id:
            stmt = stmt.where(Lot.lot_id.ilike(f"%{lot_id}%"))

        def _map(row):
            q, code, _sup = row
            return {
                "lot_id": code, "score": safe_float(q.score, 2), "passed": bool(q.passed),
                "model_used": q.model_used, "predicted_score": safe_float(q.predicted_score, 2),
                "tested_at": iso(q.tested_at),
            }
        return stmt, _map

    if entity == "shipments":
        stmt = (select(Shipment, Lot.lot_id)
                .join(Lot, Shipment.lot_id == Lot.id)
                .order_by(Shipment.shipped_at.desc(), Shipment.id.desc()))
        if date_from:
            stmt = stmt.where(Shipment.shipped_at >= dt.datetime.combine(date_from, dt.time.min))
        if date_to:
            stmt = stmt.where(Shipment.shipped_at <= dt.datetime.combine(date_to, dt.time.max))
        if lot_id:
            stmt = stmt.where(Lot.lot_id.ilike(f"%{lot_id}%"))

        def _map(row):
            ship, code = row
            return {
                "lot_id": code, "customer": ship.customer, "product": ship.product,
                "quantity": safe_float(ship.quantity, 2), "unit": ship.unit,
                "shipped_at": iso(ship.shipped_at),
            }
        return stmt, _map

    # 화이트리스트 밖 — Pydantic Literal 이 먼저 422 로 막지만 방어적으로 남긴다
    raise HTTPException(status_code=422, detail=f"허용되지 않은 entity: {entity}")


@router.get("/data/query", summary="FE-RT-34 데이터 조회")
def data_query(
    entity: QueryEntity = Query("lots"),
    pg: PageParams = Depends(),
    supplier: str | None = Query(None, pattern="^SUP_[ABC]$"),
    lot_id: str | None = Query(None, max_length=20),
    date_from: dt.date | None = Query(None),
    date_to: dt.date | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt, mapper = _entity_query(entity, supplier, date_from, date_to, lot_id)
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    rows = db.execute(stmt.limit(pg.page_size).offset(pg.offset)).all()
    return {
        "items": [mapper(r) for r in rows],
        "total": int(total),
        "page": pg.page,
        "page_size": pg.page_size,
        "columns": _COLUMNS[entity],
    }


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-35 데이터 시각화
# ══════════════════════════════════════════════════════════════════════════
@router.get("/eda-stats", summary="FE-RT-35 EDA 통계")
def eda_stats(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """`EdaStats` 스키마를 **그대로 유지**한다 (`frontend/types/index.ts` 가 이미 쓴다).

    🔴 **`DEF-IT-002` 회귀 지점이다.** 표본이 1건이면 `std()` 가 `NaN` 이고,
    `np.histogram` 은 `np.int64` 를 돌려준다. 둘 다 JSON 으로 새어나가면 프론트
    `JSON.parse` 가 깨진다 → `safe_float`/`int()` 를 반드시 통과시킨다 (§4.1).

    원천은 학습 CSV 다 (`data/raw/formulation_history.csv`). `lots` 테이블이 아니라
    **모델이 학습한 분포**를 보여주는 화면이기 때문이다.
    """
    from src.data.loader import load_raw

    try:
        df = load_raw("formulation_history.csv")
    except FileNotFoundError:
        # §5 — 데이터 원천 부재는 503. 라우터마다 문구를 만들지 않는다.
        raise HTTPException(status_code=503, detail="서비스 일시 중단")

    def distribution(series, bins: int = 5) -> list[dict]:
        values = series.dropna()
        if len(values) == 0:
            return []
        counts, edges = np.histogram(values, bins=bins)
        return [
            {"range": f"{float(edges[i]):.1f}-{float(edges[i + 1]):.1f}", "count": int(counts[i])}
            for i in range(len(counts))
        ]

    def find(*fragments: str) -> str | None:
        for col in df.columns:
            low = col.lower()
            if all(f in low for f in fragments):
                return col
        return None

    sn_col, ag_col, cu_col = find("sn", "pct"), find("ag", "pct"), find("cu", "pct")
    quality_col = find("quality")

    sn_vs_quality: list[dict] = []
    if sn_col and quality_col:
        sample = df[[sn_col, quality_col]].dropna()
        if len(sample) > 0:
            sample = sample.sample(min(60, len(sample)), random_state=42)
            sn_vs_quality = [
                {"sn": safe_float(row[sn_col], 2), "quality": safe_float(row[quality_col], 2)}
                for _, row in sample.iterrows()
            ]

    return {
        "sn_distribution": distribution(df[sn_col]) if sn_col else [],
        "ag_distribution": distribution(df[ag_col]) if ag_col else [],
        "cu_distribution": distribution(df[cu_col]) if cu_col else [],
        "sn_vs_quality": sn_vs_quality,
        "stats": {
            "total_lots": int(len(df)),
            # 표본 1건이면 std() 는 NaN → null 로 나간다 (0.0 으로 채우지 않는다)
            "mean_quality": safe_float(df[quality_col].mean(), 2) if quality_col else None,
            "std_quality": safe_float(df[quality_col].std(), 2) if quality_col else None,
        },
    }


@router.get("/data/visualization", summary="FE-RT-35 시각화 시리즈")
def visualization(
    chart: Literal["trend", "distribution", "supplier"] = Query("trend"),
    days: int = Query(90, ge=1, le=730),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """DB `lots` 를 원천으로 하는 차트 시리즈. `/eda-stats` (학습 CSV) 와 원천이 다르다."""
    since = dt.date.today() - dt.timedelta(days=days)
    series: list[dict] = []

    if chart == "trend":
        rows = db.execute(
            select(Lot.date, func.avg(Lot.quality_score))
            .where(Lot.date >= since, Lot.quality_score.isnot(None))
            .group_by(Lot.date).order_by(Lot.date)
        ).all()
        series = [{
            "name": "평균 품질 점수",
            "points": [{"x": iso(r[0]), "y": safe_float(r[1], 2)} for r in rows],
        }]

    elif chart == "distribution":
        for label, column in (("Sn", Lot.sn_ratio), ("Ag", Lot.ag_ratio), ("Cu", Lot.cu_ratio)):
            values = db.execute(
                select(column).where(Lot.date >= since, column.isnot(None))
            ).scalars().all()
            floats = [f for f in (safe_float(v, 3) for v in values) if f is not None]
            if not floats:
                series.append({"name": label, "points": []})
                continue
            counts, edges = np.histogram(floats, bins=10)
            series.append({
                "name": label,
                "points": [
                    {"x": safe_float((edges[i] + edges[i + 1]) / 2, 3), "y": int(counts[i])}
                    for i in range(len(counts))
                ],
            })

    else:  # supplier
        rows = db.execute(
            select(Supplier.code, func.avg(Lot.quality_score), func.count(Lot.id))
            .join(Lot, Lot.supplier_id == Supplier.id)
            .where(Lot.date >= since)
            .group_by(Supplier.code).order_by(Supplier.code)
        ).all()
        series = [
            {"name": "공급사별 평균 품질",
             "points": [{"x": r[0], "y": safe_float(r[1], 2)} for r in rows]},
            {"name": "공급사별 LOT 수",
             "points": [{"x": r[0], "y": int(r[2] or 0)} for r in rows]},
        ]

    return {"chart": chart, "days": days, "series": series}


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-36 데이터 내보내기
# ══════════════════════════════════════════════════════════════════════════
@router.get("/data/export", summary="FE-RT-36 데이터 내보내기")
def data_export(
    entity: ExportEntity = Query("lots"),
    format: Literal["csv", "xlsx"] = Query("csv"),
    supplier: str | None = Query(None, pattern="^SUP_[ABC]$"),
    lot_id: str | None = Query(None, max_length=20),
    date_from: dt.date | None = Query(None),
    date_to: dt.date | None = Query(None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """**유일하게 JSON 이 아닌 응답**이다 (§8.9).

    `page_size` 상한(200)을 적용하지 않고 전체를 내보낸다. 대신 **최대 10만 행**
    제한을 걸고 초과 시 **422**.

    프론트 규약: `window.location.href` 나 `<a href>` 로 받지 마라 (인증 헤더가
    안 붙는다). `fetch` + `blob` 으로 받고 파일명은 `Content-Disposition` 에서 파싱한다.
    이 요청만 10초 타임아웃을 적용하지 않는다.

    `process/performance` 는 집계 결과라 export 대상이 아니다 →
    FE-RT-21 내보내기 버튼은 **만들지 마라**.
    """
    stmt, mapper = _entity_query(entity, supplier, date_from, date_to, lot_id)
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    if int(total) > EXPORT_MAX_ROWS:
        raise HTTPException(
            status_code=422,
            detail=f"내보내기 최대 {EXPORT_MAX_ROWS:,}행을 초과했습니다 ({int(total):,}행). 기간을 좁혀 주세요",
        )

    columns = _COLUMNS[entity]
    keys = [c["key"] for c in columns]
    labels = [c["label"] for c in columns]
    stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")

    if format == "xlsx":
        from openpyxl import Workbook

        wb = Workbook(write_only=True)
        ws = wb.create_sheet(entity)
        ws.append(labels)
        for row in db.execute(stmt).all():
            record = mapper(row)
            ws.append([record.get(k) for k in keys])
        buffer = io.BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        filename = f"{entity}_{stamp}.xlsx"
        return StreamingResponse(
            buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    def rows_iter():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        buffer.write("﻿")            # Excel 한글 깨짐 방지 (UTF-8 BOM)
        writer.writerow(labels)
        yield buffer.getvalue()
        buffer.seek(0)
        buffer.truncate(0)
        for row in db.execute(stmt).yield_per(1000):
            record = mapper(row)
            writer.writerow(["" if record.get(k) is None else record.get(k) for k in keys])
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate(0)

    filename = f"{entity}_{stamp}.csv"
    return StreamingResponse(
        rows_iter(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-37 학습 데이터셋 — 🚧 저장 테이블 없음
# ══════════════════════════════════════════════════════════════════════════
@router.get("/training-datasets", status_code=501, summary="FE-RT-37 학습 데이터셋 (미구현)")
def training_datasets(_: User = Depends(get_current_user)):
    """**501.** `training_datasets` 저장 테이블이 없다 (CR-DB-001 범위에서 의도적 제외).

    선택 요구사항이며 goal.md 2.1 이 "UI 동작까지만"으로 규정한다.
    **빈 배열이나 mock 을 반환하지 마라** (§5.1).
    """
    raise HTTPException(status_code=501, detail=NOT_IMPLEMENTED_DETAIL)
