"""쿼리 카탈로그 — `agent-architecture.md` §3.3.3 · §7.7.

### 왜 자유 Text-to-SQL 이 아닌가 (§3.3.2 — 설계 결정, 바꾸지 마라)
① `NFR-S-05` 가 **ORM · 파라미터 바인딩**을 요구한다. LLM 이 만든 SQL 문자열을
   실행하는 것은 SQL 인젝션의 정의 그 자체다.
② **잘못된 조인이 틀린 숫자를 자신 있게 내놓는 게 가장 위험한 실패**다.
→ LLM 은 **"어느 도구 + 어떤 인자"만** 고른다. SQL 은 여기 미리 쓰여 있다.

### 권한 — Agent 도입 최대 보안 위험 (§7.7 예외 2)
> `sales` 사용자가 출하 화면에서 *"공급사별 성분 편차 알려줘"* 라고 물으면
> Agent 가 **입고 도구를 실행해 제조 데이터를 반환**할 수 있다.
> RBAC 이 라우터에서만 걸리면 **Agent 가 권한 우회 통로가 된다.**

두 겹으로 막는다.

| 통제 | 구현 |
|---|---|
| **T-1 화면 스코프** | `resolve()` 가 `scope` 를 받는다. 스코프 밖 도구는 `ToolScopeError` |
| **T-2 역할 필터** | 스코프 안에서도 `ROLE_SCOPES` 로 한 번 더 거른다. 위반은 `ToolPermissionError` |
| **T-3 실행 주체** | 도구는 호출자 세션으로 실행한다. 서비스 계정 승격 없음 |
| **T-5 금지 목록** | `users`·`audit_logs`·`system_settings`·`ml_models` 도구 없음 |

**도구 목록은 엔드포인트가 결정하고 LLM 이 고르지 않는다.**
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from src.agent.tools import receiving, shipping
from src.agent.tools._base import (
    MAX_ROWS,
    STATEMENT_TIMEOUT_MS,
    Citation,
    ToolArgumentError,
    ToolError,
    ToolPermissionError,
    ToolResult,
    ToolScopeError,
    thresholds,
)

SCOPES: tuple[str, ...] = ("receiving", "shipping")


@dataclass(frozen=True, slots=True)
class ToolSpec:
    """LLM 에게 넘길 도구 서술 + 실제 구현.

    `args` 는 **인자 이름 → 설명**이다. 스키마 생성은 어댑터(승인 후)가 한다.
    이 모듈은 LLM 을 모른다.
    """

    name: str
    scope: str
    fn: Callable[..., ToolResult]
    summary: str
    args: dict[str, str]
    required: tuple[str, ...] = ()
    #: 원천이 없어 항상 [X] 를 반환하는 도구 (§C-2). 답이 아니라 **설명**을 준다.
    always_unanswerable: bool = False

    def __call__(self, db: Session, **params: Any) -> ToolResult:
        return self.fn(db, **params)


# ══════════════════════════════════════════════════════════════════════════
# 입고 Agent (FE-RT-10) — 5개
# ══════════════════════════════════════════════════════════════════════════
_RECEIVING: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="receipt_history",
        scope="receiving",
        fn=receiving.receipt_history,
        summary="원재료 입고 이력을 기간·공급사·자재·상태로 조회한다.",
        args={
            "date_from": "조회 시작일 (YYYY-MM-DD, 필수)",
            "date_to": "조회 종료일 (YYYY-MM-DD, 필수)",
            "supplier": "공급사 코드 (예: SUP_A). 생략 시 전체",
            "material": "자재명 (예: Sn ingot). 생략 시 전체",
            "status": "accepted | rejected | inspecting. 생략 시 전체",
            "limit": f"반환 행 수 (최대 {MAX_ROWS})",
        },
        required=("date_from", "date_to"),
    ),
    ToolSpec(
        name="supplier_deviation_stats",
        scope="receiving",
        fn=receiving.supplier_deviation_stats,
        summary="공급사별 Sn/Ag/Cu 평균·표준편차와 평균 품질·합격률을 집계한다.",
        args={"days": "최근 며칠 (기본 90)"},
    ),
    ToolSpec(
        name="material_stock",
        scope="receiving",
        fn=receiving.material_stock,
        summary="자재 재고 잔량. ⚠ 출고·소요 기록이 없어 답할 수 없다.",
        args={"material": "자재명"},
        always_unanswerable=True,
    ),
    ToolSpec(
        name="lot_trace_upstream",
        scope="receiving",
        fn=receiving.lot_trace_upstream,
        summary="생산 LOT 을 공급사·성분까지 역추적한다.",
        args={"lot_id": "LOT 번호 (예: LOT-2026-0001, 필수)"},
        required=("lot_id",),
    ),
    ToolSpec(
        name="component_deviation",
        scope="receiving",
        fn=receiving.component_deviation,
        summary="LOT 의 성분 실측값·목표 대비 편차·임계 초과 여부를 낸다.",
        args={"lot_id": "LOT 번호 (필수)"},
        required=("lot_id",),
    ),
)

# ══════════════════════════════════════════════════════════════════════════
# 출하 Agent (FE-RT-20) — 6개
# ══════════════════════════════════════════════════════════════════════════
_SHIPPING: tuple[ToolSpec, ...] = (
    ToolSpec(
        name="shipment_history",
        scope="shipping",
        fn=shipping.shipment_history,
        summary="출하 이력을 기간·고객사·제품으로 조회한다.",
        args={
            "date_from": "조회 시작일 (YYYY-MM-DD, 필수)",
            "date_to": "조회 종료일 (YYYY-MM-DD, 필수)",
            "customer": "고객사명. 생략 시 전체",
            "product": "제품명. 생략 시 전체",
            "limit": f"반환 행 수 (최대 {MAX_ROWS})",
        },
        required=("date_from", "date_to"),
    ),
    ToolSpec(
        name="lot_quality_summary",
        scope="shipping",
        fn=shipping.lot_quality_summary,
        summary="LOT 의 품질 점수·합격 여부·검사일과 합격선 대비 판정 근거를 낸다.",
        args={"lot_id": "LOT 번호 (필수)"},
        required=("lot_id",),
    ),
    ToolSpec(
        name="lot_trace_full",
        scope="shipping",
        fn=shipping.lot_trace_full,
        summary="LOT 을 공급사·생산·성분·품질·출하·클레임 전 구간으로 추적한다.",
        args={"lot_id": "LOT 번호 (필수)"},
        required=("lot_id",),
    ),
    ToolSpec(
        name="claim_search",
        scope="shipping",
        fn=shipping.claim_search,
        summary="고객 클레임을 기간·고객사·상태·LOT 으로 조회한다.",
        args={
            "date_from": "조회 시작일 (YYYY-MM-DD, 필수)",
            "date_to": "조회 종료일 (YYYY-MM-DD, 필수)",
            "customer": "고객사명",
            "status": "open | analyzing | resolved | rejected",
            "lot_id": "LOT 번호",
            "limit": f"반환 행 수 (최대 {MAX_ROWS})",
        },
        required=("date_from", "date_to"),
    ),
    ToolSpec(
        name="lot_match_for_customer",
        scope="shipping",
        fn=shipping.lot_match_for_customer,
        summary="고객사 조건을 만족하는 미출하 LOT 후보 목록을 낸다.",
        args={
            "customer": "고객사명 (필수)",
            "min_score": "최소 품질 점수. 생략 시 합격선을 쓴다",
            "limit": f"반환 행 수 (최대 {MAX_ROWS})",
        },
        required=("customer",),
    ),
    ToolSpec(
        name="shipment_due_risk",
        scope="shipping",
        fn=shipping.shipment_due_risk,
        summary="납기 임박·지연 출하. ⚠ 납기일 컬럼이 없어 답할 수 없다.",
        args={"days": "최근 며칠 (기본 14)"},
        always_unanswerable=True,
    ),
)

CATALOG: dict[str, ToolSpec] = {
    spec.name: spec for spec in (*_RECEIVING, *_SHIPPING)
}

SCOPE_TOOLS: dict[str, tuple[str, ...]] = {
    "receiving": tuple(s.name for s in _RECEIVING),
    "shipping": tuple(s.name for s in _SHIPPING),
}


# ══════════════════════════════════════════════════════════════════════════
# §7.7 T-2 역할별 도구 필터
# ══════════════════════════════════════════════════════════════════════════
#: 역할 → 접근 가능한 화면 스코프.
#:
#: **판단으로 정한 부분** — `api-contract.md` §8 은 두 화면의 GET 을 모두
#: "전 역할 R" 로 뒀다. 그 문자 그대로면 `sales` 도 입고 도구를 쓸 수 있고,
#: 그건 §7.7 이 "Agent 도입 최대 보안 위험" 으로 지목한 바로 그 경로다.
#: → 도메인 **쓰기 권한을 가진 역할**(라우터 `require_roles`) 을 스코프 소유자로 보고
#:   `sales` 를 입고에서, `manufacture` 를 출하에서 제외했다.
#:   `viewer` 는 쓰기가 없고 전 화면 조회가 계약이므로 양쪽 모두 허용한다.
#:   운영 중 조정이 필요하면 **여기서만** 바꾼다 — 도구 코드는 손대지 않는다.
ROLE_SCOPES: dict[str, frozenset[str]] = {
    "admin":       frozenset({"receiving", "shipping"}),
    "manufacture": frozenset({"receiving"}),
    "quality":     frozenset({"receiving", "shipping"}),
    "sales":       frozenset({"shipping"}),
    "viewer":      frozenset({"receiving", "shipping"}),
}


def tools_for(scope: str, role: str) -> tuple[ToolSpec, ...]:
    """엔드포인트가 LLM 에게 노출할 도구 목록. **LLM 이 고르지 않는다** (T-1)."""
    if scope not in SCOPE_TOOLS:
        raise ToolScopeError(f"알 수 없는 화면 스코프: {scope!r} (허용: {SCOPES})")
    if role not in ROLE_SCOPES:
        raise ToolPermissionError(f"알 수 없는 역할: {role!r}")
    if scope not in ROLE_SCOPES[role]:
        return ()
    return tuple(CATALOG[name] for name in SCOPE_TOOLS[scope])


def resolve(name: str, *, scope: str, role: str) -> ToolSpec:
    """도구를 이름으로 찾되 **스코프와 역할을 먼저 검사**한다.

    Raises
    ------
    ToolScopeError
        도구가 없거나 이 화면의 도구가 아님 (T-1).
    ToolPermissionError
        역할이 이 화면 스코프에 접근할 수 없음 (T-2). **[X] 와 구분한다** (§C-4).
    """
    if scope not in SCOPE_TOOLS:
        raise ToolScopeError(f"알 수 없는 화면 스코프: {scope!r} (허용: {SCOPES})")
    if role not in ROLE_SCOPES:
        raise ToolPermissionError(f"알 수 없는 역할: {role!r}")
    if name not in CATALOG:
        raise ToolScopeError(f"알 수 없는 도구: {name!r}")
    if name not in SCOPE_TOOLS[scope]:
        raise ToolScopeError(
            f"도구 {name!r} 은 {scope!r} 화면의 도구가 아닙니다 "
            f"(소관: {CATALOG[name].scope!r})."
        )
    if scope not in ROLE_SCOPES[role]:
        raise ToolPermissionError(
            f"역할 {role!r} 은 {scope!r} 화면 데이터에 접근할 수 없습니다."
        )
    return CATALOG[name]


def run(db: Session, name: str, *, scope: str, role: str, **params: Any) -> ToolResult:
    """스코프·역할 검사 후 도구를 실행한다. **모든 도구 실행의 단일 입구.**

    반환값의 `tool`·`args` 는 그대로 `agent_runs.tool_calls` 에 기록한다 (T-4).
    """
    spec = resolve(name, scope=scope, role=role)
    unknown = set(params) - set(spec.args)
    if unknown:
        raise ToolArgumentError(
            f"{name} 이 모르는 인자입니다: {sorted(unknown)} (허용: {sorted(spec.args)})"
        )
    missing = [a for a in spec.required if params.get(a) in (None, "")]
    if missing:
        raise ToolArgumentError(
            f"{name} 에 필요한 인자가 없습니다: {missing}. "
            "기본값으로 채우지 말고 사용자에게 되물으세요."
        )
    return spec(db, **params)


__all__ = [
    "CATALOG",
    "MAX_ROWS",
    "ROLE_SCOPES",
    "SCOPES",
    "SCOPE_TOOLS",
    "STATEMENT_TIMEOUT_MS",
    "Citation",
    "ToolArgumentError",
    "ToolError",
    "ToolPermissionError",
    "ToolResult",
    "ToolScopeError",
    "ToolSpec",
    "resolve",
    "run",
    "thresholds",
    "tools_for",
]
