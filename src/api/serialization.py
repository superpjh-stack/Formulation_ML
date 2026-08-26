"""직렬화 규약 — `api-contract.md` §4.1 / `DEF-IT-002` 회귀 방지.

1. 와이어 포맷은 `snake_case`. Pydantic/dict 필드명 그대로 나간다.
2. `Decimal` 은 응답 직전에 `float()`.
3. **`NaN` / `Infinity` 를 JSON 에 내보내지 마라.** `numpy` 통계 결과는 반드시 통과시킨다.
4. `numpy` 스칼라(`np.float64`)를 그대로 반환하지 마라 — FastAPI 가 직렬화하지 못한다.
5. 날짜: `date` → `"YYYY-MM-DD"`, `datetime` → ISO 8601, 타임존 없음(naive).

`DEF-IT-002` 는 `/eda-stats` 에서 `np.histogram`/`Series.std()` 결과가 `NaN` 인 채로
JSON 에 새어나가 프론트 `JSON.parse` 가 깨진 결함이다. **표본이 1건이면 `std()` 는
`NaN` 이다.** 통계를 내보내는 모든 경로는 `safe_float()` 를 통과시켜야 한다.
"""
from __future__ import annotations

import datetime as dt
import math
from decimal import Decimal
from typing import Any


def safe_float(value: Any, digits: int | None = 4) -> float | None:
    """`float` 로 변환하되 `NaN`/`Inf`/`None` 은 `None` 으로 떨군다.

    `numpy` 스칼라·`Decimal` 도 여기서 파이썬 `float` 이 된다.
    """
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, digits) if digits is not None else f


def safe_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return int(f)


def iso(value: dt.date | dt.datetime | None) -> str | None:
    """`date` → "YYYY-MM-DD", `datetime` → ISO 8601 (naive)."""
    if value is None:
        return None
    if isinstance(value, dt.datetime):
        return value.replace(tzinfo=None).isoformat(timespec="seconds")
    if isinstance(value, dt.date):
        return value.isoformat()
    return str(value)


def clean(obj: Any) -> Any:
    """중첩 구조 전체를 JSON 안전 값으로 재귀 변환한다.

    응답 조립의 **마지막 단계**에 한 번만 통과시켜라. 중간에 여러 번 부르면
    반올림이 누적된다.
    """
    if obj is None or isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, Decimal):
        return safe_float(obj)
    if isinstance(obj, (dt.datetime, dt.date)):
        return iso(obj)
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [clean(v) for v in obj]
    # numpy 스칼라 / 그 밖의 __float__ 구현체
    item = getattr(obj, "item", None)
    if callable(item):
        try:
            return clean(item())
        except Exception:  # pragma: no cover - 방어적
            pass
    if hasattr(obj, "__float__"):
        return safe_float(obj)
    return obj


def pct(numerator: float | int | None, denominator: float | int | None,
        digits: int = 2) -> float | None:
    """백분율. 분모가 0/None 이면 `None` (0.0 으로 채우지 마라 — 구분이 안 된다)."""
    if not denominator:
        return None
    return safe_float((numerator or 0) / denominator * 100.0, digits)


def delta(current: float | None, previous: float | None, digits: int = 2) -> float | None:
    """전일/전월 대비 증감. 한쪽이라도 없으면 `None`.

    `api-contract.md` §8.2: "전일 데이터가 없으면 `null` 을 보내고 프론트는 증감 배지를
    숨긴다. **0 으로 채우지 마라** — 0%p 변화와 구분이 안 된다."
    """
    if current is None or previous is None:
        return None
    return safe_float(current - previous, digits)
