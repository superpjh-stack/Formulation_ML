"""쿼리 카탈로그 공통 기반 — `agent-architecture.md` §3.3.

### 이 계층이 지키는 것
* 도구는 **순수 함수**다: `(db: Session, **params) -> ToolResult`.
  LLM·프롬프트·프로바이더를 **모른다.** import 도 하지 않는다.
* 반환값에 **근거가 함께 나온다.** 숫자만 주면 인용을 만들 수 없다 (§7.11).
* **`count: 0` 은 유효한 결과다.** "해당 기간 클레임 0건" 은 사실이다
  (`plan-agent.md` §C-2.4). 근거가 **아닌** 것은 `count is None` 인 경우다.
* 하드 룰은 하드코딩하지 않고 `system_settings` 에서 읽는다 (goal.md 2.3 정본).
* 상한 50행 · `statement_timeout` 3초 (§3.3.3 공통 제약).
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from src.api import settings_store as ss

# ══════════════════════════════════════════════════════════════════════════
# §3.3.3 공통 제약
# ══════════════════════════════════════════════════════════════════════════
#: 반환 행 수 상한. 초과분은 잘리고 `truncated=True` 로 답변에 명시된다.
MAX_ROWS = 50

#: 도구 실행 타임아웃 (§7 성능 예산 3초).
STATEMENT_TIMEOUT_MS = 3000

CitationKind = Literal["data", "doc", "model"]


# ══════════════════════════════════════════════════════════════════════════
# 오류 — 라우터가 HTTP 로 번역한다 (승인 후)
# ══════════════════════════════════════════════════════════════════════════
class ToolError(RuntimeError):
    """도구 계층 오류의 최상위."""


class ToolArgumentError(ToolError):
    """인자가 없거나 범위를 벗어남. → 되묻기(§C-5) 또는 422."""


class ToolPermissionError(ToolError):
    """호출자 역할이 이 도구에 접근할 수 없음 (§7.7 T-2). → 403.

    ⚠ **[X] 답할 수 없음과 구분한다** (§C-4). 데이터는 있고 권한이 없는 것이다.
    """


class ToolScopeError(ToolError):
    """화면 스코프 밖의 도구를 부름 (§7.7 T-1). → 403.

    `sales` 사용자가 출하 화면에서 입고 도구에 도달하는 경로를 여기서 끊는다.
    """


# ══════════════════════════════════════════════════════════════════════════
# 근거 (§7.11.2 Citation) — `kind` 어휘는 data / doc / model 로 확정
# ══════════════════════════════════════════════════════════════════════════
@dataclass(frozen=True, slots=True)
class Citation:
    """`ord` 는 수집기(N5)가 채운다 — 도구는 순서를 모른다."""

    kind: CitationKind
    label: str
    detail: str | None = None
    link: str | None = None
    count: int | None = None
    snippet: str | None = None
    score: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "label": self.label,
            "detail": self.detail,
            "link": self.link,
            "count": self.count,
            "snippet": self.snippet,
            "score": self.score,
        }

    @property
    def qualifies(self) -> bool:
        """§7.11.3 근거의 자격 — `kind='data'` 인데 `count` 가 `None` 이면 근거가 아니다."""
        if self.kind == "data":
            return self.count is not None
        if self.kind == "doc":
            return bool(self.snippet)
        return True


# ══════════════════════════════════════════════════════════════════════════
# 도구 반환 계약
# ══════════════════════════════════════════════════════════════════════════
@dataclass(slots=True)
class ToolResult:
    """도구 1회 실행의 결과.

    `result`
        **마스킹 전** 봉투. 키가 테이블명인 dict — `redaction.to_wire()` 의 입력이다.
        화면(내부)에는 이대로 쓰고, 외부로 나갈 때만 `to_wire()` 를 통과한다.
    `citation`
        근거. `None` 이면 **근거 없음**이고, 그때 답변을 렌더링하면 안 된다 (§C-1).
    `unanswerable`
        원천이 없어 답할 수 없는 질문 (§C-2). **숫자를 담지 않는다** —
        숫자가 들어가는 순간 그것이 답으로 읽힌다 (§C-2.3).
    `notes`
        부분적 한계. 데이터는 냈지만 못 낸 조각이 있을 때의 표준 문구.
    """

    tool: str
    scope: str
    args: dict[str, Any] = field(default_factory=dict)
    result: dict[str, Any] = field(default_factory=dict)
    citation: Citation | None = None
    unanswerable: dict[str, str] | None = None
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool": self.tool,
            "scope": self.scope,
            "args": self.args,
            "result": self.result,
            "citation": self.citation.to_dict() if self.citation else None,
            "unanswerable": self.unanswerable,
            "notes": list(self.notes),
        }

    @property
    def has_evidence(self) -> bool:
        return self.citation is not None and self.citation.qualifies


def unanswerable(tool: str, scope: str, topic: str, message: str,
                 args: dict[str, Any] | None = None) -> ToolResult:
    """[X] 답할 수 없음 — `citation` 은 `None` 이고 숫자를 담지 않는다."""
    return ToolResult(
        tool=tool,
        scope=scope,
        args=args or {},
        result={},
        citation=None,
        unanswerable={"topic": topic, "message": message},
    )


# ══════════════════════════════════════════════════════════════════════════
# 하드 룰 — goal.md 2.3 이 정본. **하드코딩하지 않는다.**
# ══════════════════════════════════════════════════════════════════════════
@dataclass(frozen=True, slots=True)
class Thresholds:
    pass_score: float
    warn_score: float
    temp_warn_c: float
    dev_warn_sn: float
    dev_warn_ag: float
    dev_warn_cu: float
    sn_target: float
    ag_target: float
    cu_target: float

    def to_meta(self) -> dict[str, Any]:
        return {
            "pass_score": self.pass_score,
            "warn_score": self.warn_score,
            "temp_warn_c": self.temp_warn_c,
            "dev_warn_sn": self.dev_warn_sn,
            "dev_warn_ag": self.dev_warn_ag,
            "dev_warn_cu": self.dev_warn_cu,
            "sn_target": self.sn_target,
            "ag_target": self.ag_target,
            "cu_target": self.cu_target,
        }


def thresholds(db: Session) -> Thresholds:
    """`system_settings` 에서 읽는다. 행이 없으면 `settings_store.DEFAULTS`.

    합격선 70 · 편차 2.0/0.3/0.1 · 온도 255°C 를 **여기 다시 쓰지 않는다.**
    """
    v = ss.load(db, prefixes=ss.SETTINGS_PREFIXES)
    return Thresholds(
        pass_score=float(v[ss.K_PASS_SCORE]),
        warn_score=float(v[ss.K_WARN_SCORE]),
        temp_warn_c=float(v[ss.K_TEMP_WARN]),
        dev_warn_sn=float(v[ss.K_DEV_SN]),
        dev_warn_ag=float(v[ss.K_DEV_AG]),
        dev_warn_cu=float(v[ss.K_DEV_CU]),
        sn_target=float(v[ss.K_SN_TARGET]),
        ag_target=float(v[ss.K_AG_TARGET]),
        cu_target=float(v[ss.K_CU_TARGET]),
    )


# ══════════════════════════════════════════════════════════════════════════
# 실행 보호
# ══════════════════════════════════════════════════════════════════════════
def apply_statement_timeout(db: Session, ms: int = STATEMENT_TIMEOUT_MS) -> None:
    """`SET LOCAL statement_timeout` — 세션이 아니라 **현재 트랜잭션에만** 건다.

    ⚠ `SET` 은 **바인드 파라미터를 받지 않는다** (`SET ... = $1` 은 문법 오류).
    그래서 값을 문자열로 조립하는데, `int()` 로 강제 변환한 뒤에만 조립한다 —
    이 함수에는 사용자 입력이 도달하지 않고, 도달해도 정수가 아니면 여기서 죽는다.
    `NFR-S-05` 가 금지한 것은 **바인딩 없이 사용자 값을 잇는 것**이지 상수 조립이 아니다.

    PostgreSQL 이 아니면(SQLite 등) **실행 자체를 하지 않는다.** 실패시킨 뒤
    롤백으로 수습하면 호출자의 세이브포인트까지 날아간다 — 실제로 그렇게 깨졌다.
    """
    try:
        n = int(ms)
    except (TypeError, ValueError):  # pragma: no cover - 호출자가 상수를 준다
        n = STATEMENT_TIMEOUT_MS
    if n <= 0:  # pragma: no cover
        return
    try:
        dialect = db.get_bind().dialect.name
    except Exception:  # pragma: no cover - 바인드가 없는 세션
        return
    if dialect != "postgresql":
        return
    db.execute(sql_text(f"SET LOCAL statement_timeout = {n}"))


# ══════════════════════════════════════════════════════════════════════════
# 인자 검증 — 조용히 기본값으로 채우지 않는다 (§C-5)
# ══════════════════════════════════════════════════════════════════════════
def require_date_range(date_from: Any, date_to: Any) -> tuple[dt.date, dt.date]:
    a = coerce_date(date_from, "date_from")
    b = coerce_date(date_to, "date_to")
    if a > b:
        raise ToolArgumentError("date_from 이 date_to 보다 늦습니다.")
    return a, b


def coerce_date(value: Any, name: str) -> dt.date:
    if value is None:
        raise ToolArgumentError(
            f"{name} 이 필요합니다. 기간을 지정하지 않으면 답을 만들 수 없습니다."
        )
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value.strip())
        except ValueError as exc:
            raise ToolArgumentError(f"{name} 형식이 잘못됐습니다 (YYYY-MM-DD): {value!r}") from exc
    raise ToolArgumentError(f"{name} 형식이 잘못됐습니다: {value!r}")


def clamp_limit(limit: Any) -> int:
    if limit is None:
        return MAX_ROWS
    try:
        n = int(limit)
    except (TypeError, ValueError) as exc:
        raise ToolArgumentError(f"limit 은 정수여야 합니다: {limit!r}") from exc
    if n <= 0:
        raise ToolArgumentError("limit 은 1 이상이어야 합니다.")
    return min(n, MAX_ROWS)


def positive_days(days: Any, name: str = "days") -> int:
    try:
        n = int(days)
    except (TypeError, ValueError) as exc:
        raise ToolArgumentError(f"{name} 는 정수여야 합니다: {days!r}") from exc
    if n <= 0:
        raise ToolArgumentError(f"{name} 는 1 이상이어야 합니다.")
    return n


# ══════════════════════════════════════════════════════════════════════════
# 값 변환 헬퍼
# ══════════════════════════════════════════════════════════════════════════
def num(value: Any, digits: int | None = None) -> float | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, (int, float)):
        f = float(value)
        return round(f, digits) if digits is not None else f
    return None


def fmt_range(a: dt.date, b: dt.date) -> str:
    return f"{a.isoformat()} ~ {b.isoformat()}"


__all__ = [
    "MAX_ROWS",
    "STATEMENT_TIMEOUT_MS",
    "Citation",
    "Thresholds",
    "ToolArgumentError",
    "ToolError",
    "ToolPermissionError",
    "ToolResult",
    "ToolScopeError",
    "apply_statement_timeout",
    "clamp_limit",
    "coerce_date",
    "fmt_range",
    "num",
    "positive_days",
    "require_date_range",
    "thresholds",
    "unanswerable",
]
