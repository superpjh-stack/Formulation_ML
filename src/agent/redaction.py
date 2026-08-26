"""마스킹 계층 — `agent-architecture.md` §2.8.3 · §2.8.4.

**어댑터 바로 앞**이 유일하게 "밖으로 나가는 모든 바이트"가 지나는 지점이다.
FastAPI 미들웨어는 HTTP **응답** 경로에만 있어 외부 API 호출을 보지 못한다.

    그래프 노드(§5)             ← 별칭이 붙은 데이터만 본다
          ↓ ctx (Evidence[])
      to_wire(ctx)              ← ★ 허용목록 + 별칭 치환 + 이름기반 안전망
          ↓ 마스킹된 프롬프트
      LLMProvider.stream()      ← 외부로 나가는 유일한 지점  (⚠ CR-ARCH-001 승인 대기)
          ↓ 응답
      from_wire()               ← 별칭 역치환 (LOT#1 → LOT-2026-001)
          ↓
      룰 검증(§4) → 응답

### `src/api/middleware.py:_REDACT_KEY_FRAGMENTS` 와의 관계
**합치지 않는다** (§2.8.3). 목적·방식·가역성·적용지점이 전부 다르다.
다만 **최종 안전망으로 한 번 더 통과**시킨다 — 허용목록이 실수로 비밀값을
허용해도 이름 기반으로 걸린다.

### 봉투(envelope) 규약
`to_wire()` 는 임의의 dict 를 받지 않는다. **테이블 키로 묶인 봉투**를 받는다.

    {"lots": {...}, "components": [{...}], "meta": {...}}

키가 `allowlist.ALLOWLIST` 에 없으면 **통째로 버린다.** 모르는 것은 차단이다.
"""
from __future__ import annotations

import datetime as dt
import decimal
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from src.agent.allowlist import (
    ALIAS_FIELDS,
    ALIAS_FORMATS,
    ALIAS_KINDS,
    ALIAS_OUTPUT_NAMES,
    ALLOWLIST,
    FORBIDDEN_FIELD_NAMES,
    FORBIDDEN_QUALIFIED,
    FORBIDDEN_TABLES,
)

# 최종 안전망 — **기존 미들웨어 상수를 재사용**한다 (복사하지 않는다).
from src.api.middleware import _REDACT_KEY_FRAGMENTS

__all__ = [
    "AliasBook",
    "RedactionError",
    "WireResult",
    "assert_wire_safe",
    "from_wire",
    "to_wire",
]


class RedactionError(RuntimeError):
    """마스킹을 통과하지 않은 문자열이 어댑터에 도달했을 때 (§2.8.4 단일 출구)."""


# ══════════════════════════════════════════════════════════════════════════
# 별칭 사전 — §2.8.1 P3 "식별자는 나가지 않는다. 별칭이 나간다"
# ══════════════════════════════════════════════════════════════════════════
class AliasBook:
    """세션 스코프 가역 별칭 사전.

    * `alias(kind, value)` — 같은 값에는 **항상 같은 별칭**을 준다 (멱등)
    * `real(alias)` — 별칭 → 원문
    * `restore(text)` — 답변 문자열의 별칭을 전부 원문으로 되돌린다

    별칭은 종류마다 **네임스페이스가 분리**된다. `LOT#1` 과 `입고#1` 은 다른 값이다.
    """

    __slots__ = ("_forward", "_reverse")

    def __init__(self) -> None:
        # {kind: {원문: 별칭}}
        self._forward: dict[str, dict[str, str]] = {k: {} for k in ALIAS_KINDS}
        # {별칭: 원문}  — 별칭 문자열이 종류를 이미 담고 있어 평평하게 둔다
        self._reverse: dict[str, str] = {}

    # ── 치환 ────────────────────────────────────────────────────────────
    def alias(self, kind: str, value: Any) -> str | None:
        """원문 식별자 → 별칭. `None` 은 `None` 그대로 (없는 것을 지어내지 않는다)."""
        if value is None:
            return None
        if kind not in self._forward:
            raise RedactionError(f"알 수 없는 별칭 종류: {kind!r} (허용: {ALIAS_KINDS})")
        key = str(value)
        table = self._forward[kind]
        existing = table.get(key)
        if existing is not None:
            return existing
        made = ALIAS_FORMATS[kind].format(n=len(table) + 1)
        table[key] = made
        self._reverse[made] = key
        return made

    # ── 역치환 ──────────────────────────────────────────────────────────
    def real(self, alias: str) -> str | None:
        return self._reverse.get(alias)

    def restore(self, text: str) -> str:
        """답변 문자열의 별칭을 원문으로 되돌린다.

        긴 별칭부터 치환한다 — `LOT#1` 이 `LOT#12` 의 앞부분을 먹지 않게.
        """
        if not text or not self._reverse:
            return text
        keys = sorted(self._reverse, key=len, reverse=True)
        pattern = re.compile("|".join(re.escape(k) for k in keys))
        return pattern.sub(lambda m: self._reverse[m.group(0)], text)

    def mask(self, text: str) -> str:
        """`restore()` 의 반대 — 문자열 안의 **원문 식별자**를 별칭으로 바꾼다.

        근거(Citation)의 `label`·`detail` 처럼 사람이 읽을 문장에 식별자가
        섞여 들어가는 경로를 막는다. **이미 사전에 등록된 값만** 바꾼다 —
        모르는 문자열을 추측해서 가리지 않는다.
        """
        if not text or not self._reverse:
            return text
        pairs = {real: alias for table in self._forward.values() for real, alias in table.items()}
        if not pairs:
            return text
        keys = sorted(pairs, key=len, reverse=True)
        pattern = re.compile("|".join(re.escape(k) for k in keys))
        return pattern.sub(lambda m: pairs[m.group(0)], text)

    # ── 감사·디버깅 ─────────────────────────────────────────────────────
    def as_dict(self) -> dict[str, str]:
        """`{별칭: 원문}` 사본. **외부로 내보내면 안 된다** — 화면 복원 전용."""
        return dict(self._reverse)

    def __len__(self) -> int:
        return len(self._reverse)


# ══════════════════════════════════════════════════════════════════════════
# 값 정규화 — 프롬프트에 넣을 수 있는 원시 타입으로만
# ══════════════════════════════════════════════════════════════════════════
#: 알 수 없는 타입 표식 — `None`(=정당한 null) 과 구분한다.
_UNSUPPORTED = object()


def _scalar(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        # NaN/Inf 는 JSON 이 아니다 — `serialization.safe_float` 과 같은 규칙으로 null
        return value if math.isfinite(value) else None
    if isinstance(value, decimal.Decimal):
        f = float(value)
        return int(f) if f.is_integer() else f
    if isinstance(value, dt.datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, (list, tuple)):
        return [v for v in (_scalar(x) for x in value) if v is not _UNSUPPORTED]
    # 알 수 없는 타입은 문자열로 강제하지 않는다 — 버린다.
    return _UNSUPPORTED


def _safety_net(field: str) -> bool:
    """`_REDACT_KEY_FRAGMENTS` 이름 기반 최종 안전망 (§2.8.3)."""
    low = field.lower()
    return any(frag in low for frag in _REDACT_KEY_FRAGMENTS)


# ══════════════════════════════════════════════════════════════════════════
# 결과 타입
# ══════════════════════════════════════════════════════════════════════════
class WireResult(dict):
    """`to_wire()` 결과. **이 타입이 아니면 어댑터가 거부한다** (§2.8.4 단일 출구).

    키
      `fields`  — 허용목록을 통과한 봉투
      `dropped` — 버려진 `<봉투키>.<필드>` 목록 (감사·테스트용)
    """

    __slots__ = ()

    @property
    def fields(self) -> dict[str, Any]:
        return self["fields"]

    @property
    def dropped(self) -> list[str]:
        return self["dropped"]


# ══════════════════════════════════════════════════════════════════════════
# to_wire — 허용목록 필터 + 별칭 치환
# ══════════════════════════════════════════════════════════════════════════
def _redact_row(
    table: str,
    row: Mapping[str, Any],
    book: AliasBook,
    dropped: list[str],
) -> dict[str, Any]:
    allowed = ALLOWLIST[table]
    aliases = ALIAS_FIELDS.get(table, {})
    out: dict[str, Any] = {}

    for field, value in row.items():
        qualified = f"{table}.{field}"

        # ① 절대 금지 — 허용목록에 실수로 들어와도 여기서 막는다
        if qualified in FORBIDDEN_QUALIFIED or field in FORBIDDEN_FIELD_NAMES:
            # 단, 별칭 대상 필드는 "치환해서 내보낸다" 가 정책이다
            if field not in aliases:
                dropped.append(qualified)
                continue

        # ② 이름 기반 안전망
        if _safety_net(field):
            dropped.append(qualified)
            continue

        # ③ 별칭 치환 — 원문 필드명을 버리고 별칭 필드명으로 내보낸다
        if field in aliases:
            out_name = ALIAS_OUTPUT_NAMES.get(field, f"{field}_alias")
            if out_name not in allowed:
                dropped.append(qualified)
                continue
            out[out_name] = book.alias(aliases[field], value)
            continue

        # ④ 허용목록 — 없으면 차단이 기본이다
        if field not in allowed:
            dropped.append(qualified)
            continue

        coerced = _scalar(value)
        if coerced is _UNSUPPORTED:
            dropped.append(qualified)
            continue
        out[field] = coerced

    return out


def to_wire(envelope: Mapping[str, Any], book: AliasBook | None = None) -> WireResult:
    """봉투를 허용목록으로 거르고 식별자를 별칭으로 치환한다.

    Parameters
    ----------
    envelope
        `{<테이블키>: dict | list[dict]}`. 키가 허용목록에 없으면 통째로 버린다.
    book
        별칭 사전. 생략하면 새로 만든다 — 그 경우 **역치환이 불가능**하므로
        보통은 세션 사전을 넘긴다.

    Returns
    -------
    WireResult
        `fields` 는 허용 필드만, `dropped` 는 버려진 것들.
    """
    if book is None:
        book = AliasBook()
    if not isinstance(envelope, Mapping):
        raise RedactionError(f"봉투는 매핑이어야 한다: {type(envelope).__name__}")

    fields: dict[str, Any] = {}
    dropped: list[str] = []

    for table, payload in envelope.items():
        if table in FORBIDDEN_TABLES:
            dropped.append(f"{table}.*")
            continue
        if table not in ALLOWLIST:
            # 모르는 봉투 키는 기본 차단 (§2.8.1 P2)
            dropped.append(f"{table}.*")
            continue

        if payload is None:
            fields[table] = None
        elif isinstance(payload, Mapping):
            fields[table] = _redact_row(table, payload, book, dropped)
        elif isinstance(payload, Sequence) and not isinstance(payload, (str, bytes)):
            rows = []
            for item in payload:
                if not isinstance(item, Mapping):
                    dropped.append(f"{table}.<non-mapping>")
                    continue
                rows.append(_redact_row(table, item, book, dropped))
            fields[table] = rows
        else:
            dropped.append(f"{table}.<scalar>")

    return WireResult(fields=fields, dropped=dropped)


# ══════════════════════════════════════════════════════════════════════════
# from_wire — 별칭 역치환
# ══════════════════════════════════════════════════════════════════════════
def from_wire(text: str, book: AliasBook) -> str:
    """LLM 응답의 별칭(`LOT#1`)을 화면에 보일 원문(`LOT-2026-001`)으로 되돌린다."""
    return book.restore(text)


# ══════════════════════════════════════════════════════════════════════════
# 단일 출구 강제 (§2.8.4)
# ══════════════════════════════════════════════════════════════════════════
def assert_wire_safe(payload: Any) -> WireResult:
    """`LLMProvider` 구현체가 호출한다. `to_wire()` 를 통과하지 않았으면 예외.

    ⚠ `LLMProvider` 자체는 `CR-ARCH-001` 승인 전까지 구현하지 않는다.
    이 함수는 **승인 후 어댑터가 붙을 지점의 계약**을 먼저 못박아 둔 것이다.
    """
    if not isinstance(payload, WireResult):
        raise RedactionError(
            "마스킹되지 않은 데이터가 어댑터에 도달했다. "
            "redaction.to_wire() 를 먼저 통과시켜라 (§2.8.4 단일 출구)."
        )
    return payload


def leaked_fields(result: WireResult) -> list[str]:
    """`fields` 안에 금지 필드명이 남아 있는지 재검사. 테스트 게이트용."""
    leaks: list[str] = []

    def walk(table: str, obj: Any) -> None:
        if isinstance(obj, Mapping):
            for key, value in obj.items():
                if key in FORBIDDEN_FIELD_NAMES or _safety_net(key):
                    leaks.append(f"{table}.{key}")
                if f"{table}.{key}" in FORBIDDEN_QUALIFIED:
                    leaks.append(f"{table}.{key}")
                walk(table, value)
        elif isinstance(obj, Iterable) and not isinstance(obj, (str, bytes)):
            for item in obj:
                walk(table, item)

    for table, payload in result.fields.items():
        walk(table, payload)
    return leaks
