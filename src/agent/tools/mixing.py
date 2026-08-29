"""배합 Agent 쿼리 카탈로그 (FE-RT-15) — `agent-architecture.md` §3.3.

    predict_quality       배합비로 품질 점수 예측       ← /predict 와 같은 코드
    recommend_mix         공정 조건에서 최적 배합 추천   ← /recommend 와 같은 코드
    mixing_history        과거 배합 실적 조회

🔴 **모델 목록 도구는 두지 않는다.** 설계서 §7.7 T-5 가 `ml_models` 를
   "어느 역할에도 도구로 노출되지 않는" 테이블로 못박았다. 한 번 만들었다가
   지웠다 — 봉투 키를 `models` 로 바꾸면 `FORBIDDEN_TABLES` 검사를 피할 수
   있었지만, 그건 통제를 우회한 것이지 지킨 것이 아니다.
   모델 성능은 FE-RT-16 모델 관리 화면이 보여준다.
   (게다가 그 지표는 합성 시드 기준이라 검증기 V3 가 인용을 막는 값이다.)

🔴 **예측·추천은 `app.py` 의 함수를 그대로 부른다.** 여기서 다시 구현하면
   경계 검증(`API_BOUNDS`)·피처 순서(`BUG-001`)·baseline 차단 같은 규칙이
   두 벌이 되고, 한쪽만 고쳐지는 날이 반드시 온다. **Agent 가 추천한 배합을
   예측 API 가 거부하는** 모순이 실제로 있었다(2차 QA) — 그걸 다시 만들지 않는다.

⚠ 이 도구들은 **판정하지 않는다.** 점수와 기준을 내놓고 판단은 담당자가 한다
  (§2.12.1 · 사업계획서 p.26). 검증기 V4·V5·V6 가 답변 단계에서 한 번 더 막는다.
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
    require_date_range,
)
from src.db.models import Lot

SCOPE = "mixing"


def _f(value: Any, name: str) -> float:
    """숫자만 받는다. LLM 이 `"62.0%"` 처럼 단위를 붙여 보내는 일이 흔하다."""
    if value is None:
        raise ToolArgumentError(f"{name} 이(가) 필요합니다")
    try:
        return float(str(value).replace("%", "").replace(",", "").strip())
    except (TypeError, ValueError) as exc:
        raise ToolArgumentError(f"{name} 은 숫자여야 합니다: {value!r}") from exc


# ══════════════════════════════════════════════════════════════════════════
# 1. predict_quality — 배합비 → 품질 점수
# ══════════════════════════════════════════════════════════════════════════
def predict_quality(
    db: Session,
    *,
    sn_pct: Any,
    ag_pct: Any,
    cu_pct: Any,
    pb_pct: Any = None,
    temperature: Any = 250,
    process_time: Any = 45,
    supplier: str = "SUP_A",
    model: str = "gradient_boosting",
) -> ToolResult:
    """배합비와 공정 조건으로 품질 점수를 예측한다.

    `pb_pct` 를 주지 않으면 `100 − Sn − Ag − Cu` 로 채운다 — 화면(FE-RT-13)이
    같은 규칙을 쓴다. 합계가 100.0 이 아니면 **거부한다**(goal.md 2.3).
    """
    from app import PredictRequest, predict as _predict

    sn, ag, cu = _f(sn_pct, "Sn"), _f(ag_pct, "Ag"), _f(cu_pct, "Cu")
    pb = round(100.0 - sn - ag - cu, 4) if pb_pct is None else _f(pb_pct, "Pb")

    total = round(sn + ag + cu + pb, 4)
    if abs(total - 100.0) > 0.05:
        raise ToolArgumentError(
            f"성분 합계가 {total}% 입니다. 정확히 100.0% 여야 예측이 실행됩니다."
        )

    try:
        req = PredictRequest(
            sn_ratio=sn, ag_ratio=ag, cu_ratio=cu, pb_ratio=pb,
            temperature=_f(temperature, "온도"), process_time=_f(process_time, "시간"),
            supplier=supplier, model=model,
        )
    except Exception as exc:  # noqa: BLE001 — Pydantic 경계 위반
        raise ToolArgumentError(f"입력이 허용 경계를 벗어났습니다: {exc}") from exc

    result = _predict(req)
    args = {"sn": sn, "ag": ag, "cu": cu, "pb": pb, "model": model}

    # 🔴 **중첩 dict 를 만들지 않는다.** `redaction._scalar()` 가 알 수 없는 타입을
    #    버리도록 설계돼 있어(§2.8.3 기본 차단), `deviations: {...}` 같은 중첩은
    #    통째로 사라진다. 마스킹 계층을 느슨하게 만드는 대신 여기서 평탄화한다 —
    #    보안 코드는 손대지 않는 쪽이 맞다.
    dev = result.get("deviations") or {}
    metrics = result.get("model_metrics") or {}
    flat = {
        "predicted_quality": result.get("predicted_quality"),
        "model_used": result.get("model_used"),
        "passed": result.get("passed"),
        "deviation_sn": dev.get("sn"),
        "deviation_ag": dev.get("ag"),
        "deviation_cu": dev.get("cu"),
        "rmse": metrics.get("RMSE") or metrics.get("rmse"),
        "r2": metrics.get("R2") or metrics.get("r2"),
    }
    return ToolResult(
        tool="predict_quality",
        scope=SCOPE,
        args=args,
        result={"prediction": flat, "meta": {"tool": "predict_quality", "row_count": 1, **args}},
        citation=Citation(
            kind="model",
            label=f"품질 예측 ({model})",
            detail=f"Sn {sn:g} / Ag {ag:g} / Cu {cu:g} / Pb {pb:g}",
            link="/mixing/predict",
            count=1,
        ),
        notes=[
            "예측 점수는 ML 값이며 LOT 합부 판정이 아니다. "
            "합부는 품질기준서 QS-KS-001 §5.1 이 정한다."
        ],
    )


# ══════════════════════════════════════════════════════════════════════════
# 2. recommend_ratios — 공정 조건 → 최적 배합
# ══════════════════════════════════════════════════════════════════════════
def recommend_mix(
    db: Session,
    *,
    temperature: Any = 250,
    process_time: Any = 45,
    supplier: str = "SUP_A",
    model: str = "gradient_boosting",
) -> ToolResult:
    """공정 조건에서 최적 배합비율을 추천한다 (SLSQP).

    🔴 **수렴 실패는 오류가 아니다.** `optimization_success:false` 로 돌려주고
    답변이 그 사실을 말하게 한다 (§5 오류 계약). 실패를 성공으로 위장하지 않는다.
    """
    from app import RecommendRequest, recommend as _recommend

    try:
        req = RecommendRequest(
            temperature=_f(temperature, "온도"),
            process_time=_f(process_time, "시간"),
            supplier=supplier,
            model=model,
        )
    except Exception as exc:  # noqa: BLE001
        raise ToolArgumentError(f"입력이 허용 경계를 벗어났습니다: {exc}") from exc

    result = _recommend(req)
    ok = bool(result.get("optimization_success"))
    r = result.get("recommended_ratios") or {}
    flat = {
        "sn": r.get("sn"), "ag": r.get("ag"), "cu": r.get("cu"), "pb": r.get("pb"),
        "predicted_quality": result.get("predicted_quality"),
        # 🔴 이 값을 빼면 수렴 실패한 추천을 LLM 이 성공한 값으로 읽는다
        "optimization_success": ok,
        "iterations": result.get("iterations"),
        "message": result.get("message"),
    }
    args = {"temperature": req.temperature, "process_time": req.process_time,
            "supplier": supplier, "model": model}

    notes = ["추천값은 예상치다. 실제 투입 후 XRF 재측정으로 확인해야 한다 "
             "(WS-KS-001 부속서 B). 계산만으로 합격 판정은 금지다."]
    if not ok:
        notes.append("최적화가 수렴하지 못했다. 이 배합을 사용하면 안 된다.")

    return ToolResult(
        tool="recommend_mix",
        scope=SCOPE,
        args=args,
        result={"recommendation": flat,
                "meta": {"tool": "recommend_mix", "row_count": 1,
                         "optimization_success": ok, **args}},
        citation=Citation(
            kind="model",
            label=f"배합 최적화 ({model})",
            detail=f"{req.temperature:g}°C · {req.process_time:g}분 · {supplier}",
            link="/mixing/optimize",
            count=1,
        ),
        notes=notes,
    )


# ══════════════════════════════════════════════════════════════════════════
# 3. mixing_history — 과거 배합 실적
# ══════════════════════════════════════════════════════════════════════════
def mixing_history(
    db: Session,
    *,
    date_from: Any,
    date_to: Any,
    status: str | None = None,
    limit: int | None = None,
) -> ToolResult:
    """기간 내 LOT 의 배합 성분과 품질 점수.

    `date_from`·`date_to` 는 **필수**다. 기간을 조용히 기본값으로 채우면
    그게 곧 지어내기다 (§C-5).
    """
    a, b = require_date_range(date_from, date_to)
    n = clamp_limit(limit)
    apply_statement_timeout(db)

    stmt = select(Lot).where(Lot.date >= a, Lot.date <= b)
    if status:
        stmt = stmt.where(Lot.status == status)
    total = int(
        db.execute(
            select(func.count()).select_from(stmt.order_by(None).subquery())
        ).scalar_one()
    )
    rows = db.execute(stmt.order_by(Lot.date.desc(), Lot.id.desc()).limit(n)).scalars().all()

    return ToolResult(
        tool="mixing_history",
        scope=SCOPE,
        args={"date_from": str(a), "date_to": str(b), "status": status},
        result={
            "lots": [
                {
                    "lot_id": r.lot_id,
                    "date": str(r.date),
                    "sn_pct": num(r.sn_pct, 3),
                    "ag_pct": num(r.ag_pct, 3),
                    "cu_pct": num(r.cu_pct, 3),
                    "pb_pct": num(r.pb_pct, 3),
                    "melt_temp_c": num(r.melt_temp_c, 1),
                    "melt_time_min": num(r.melt_time_min, 1),
                    "quality_score": num(r.quality_score, 2),
                    "status": r.status,
                }
                for r in rows
            ],
            "meta": {"tool": "mixing_history", "date_from": str(a), "date_to": str(b),
                     "status": status, "limit": n, "row_count": total,
                     "truncated": total > len(rows)},
        },
        citation=Citation(
            kind="data", label="배합 실적 조회",
            detail=f"{fmt_range(a, b)}{f' · {status}' if status else ''}",
            link="/mixing/data", count=total,
        ),
    )
