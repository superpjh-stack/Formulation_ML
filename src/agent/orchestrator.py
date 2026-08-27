"""오케스트레이션 — `agent-architecture.md` §3·§4.

    질문 → 도구 선택(LLM) → 도구 실행(우리 코드) → RAG 검색 → 답변 생성(LLM)
         → 검증 V1~V9 → (위반 시 1회 재생성) → 기록

**LLM 이 SQL 을 쓰지 않는다.** 어느 도구를 어떤 인자로 부를지만 고른다 (§3.3).
SQL 은 `src/agent/tools/` 에 개발자가 SQLAlchemy 로 미리 써 뒀다.

**근거가 없으면 LLM 을 아예 부르지 않는다** (§4.6). 부르지 않으면 지어낼 수 없다.
이게 환각 방지의 가장 확실한 방법이다.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import time
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from src.agent import config, embed, providers, redaction, retrieval, rules, validate
from src.agent import tools as tool_registry
from src.agent.tools._base import ToolError, ToolResult
from src.agent.validate import Evidence

#: §7.5 닫힌 집합. 새 값을 발명하지 않는다.
STATUS_OK = "ok"
STATUS_NO_EVIDENCE = "no_evidence"
STATUS_OUT_OF_SCOPE = "out_of_scope"
STATUS_TIMEOUT = "timeout"
STATUS_RULE_VIOLATION = "rule_violation"

#: `agent_runs.route`
ROUTE_TOOL = "tool"
ROUTE_RAG = "rag"
ROUTE_HYBRID = "hybrid"
ROUTE_REFUSE = "refuse"

NO_EVIDENCE_MESSAGE = "답변에 필요한 근거를 찾지 못했습니다."
NO_INDEX_MESSAGE = "AI 지식 문서가 아직 등록되지 않았습니다."

SCOPE_GUIDE = {
    "receiving": "원재료 입고 이력, 공급사별 성분 편차·안정성, 입고 검사 상태",
    "shipping": "출하 실적, 고객사별 출하량, 클레임 현황과 처리 상태",
}


@dataclass
class AgentOutcome:
    answer: str | None
    answer_status: str
    evidence: list[Evidence] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    route: str = ROUTE_REFUSE
    partial: bool = False
    provider: str | None = None
    model_id: str | None = None
    rule_hash: str = ""
    tool_calls: list[dict] = field(default_factory=list)
    retrieval_stats: dict | None = None
    latency_ms: dict[str, int] = field(default_factory=dict)
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    regenerated: bool = False
    error_code: str | None = None
    prompt_sent: str | None = None
    raw_answer: str | None = None

    @property
    def total_ms(self) -> int:
        return self.latency_ms.get("total", 0)


# ══════════════════════════════════════════════════════════════════════════
# 프롬프트
# ══════════════════════════════════════════════════════════════════════════
SYSTEM_BASE = """당신은 ㈜고려솔더 제조 현장의 질문에 답하는 사내 도우미다.

지켜야 할 것:
1. **주어진 근거에만 근거해 답한다.** 근거에 없는 사실을 만들지 마라.
   모르면 "확인할 수 없습니다" 라고 말한다. 그것이 정답일 때가 많다.
2. **판정하지 마라.** "출하 가능합니다"·"합격입니다" 같은 단정을 내리지 않는다.
   근거와 기준을 보여주고 판단은 담당자가 하게 한다.
3. 수치를 말할 때는 **어느 문서·어느 조회에서 나왔는지** 본문에 밝힌다.
4. 문서의 값에 `[현장확정]` 표시가 있으면 **잠정치라는 사실을 함께 말한다.**
5. 답은 한국어로, 현장에서 바로 읽을 수 있게 짧고 구체적으로 쓴다.
6. 근거에 없는 문서번호를 지어내 인용하지 마라."""


def _tool_schema(spec) -> dict[str, Any]:
    """`ToolSpec.args`(이름→설명) 를 JSON Schema 로 옮긴다.

    도구 모듈은 LLM 을 모른다(§3.3). 스키마 생성은 여기, 어댑터 쪽 책임이다.
    """
    return {
        "name": spec.name,
        "description": spec.summary,
        "input_schema": {
            "type": "object",
            "properties": {k: {"type": "string", "description": v} for k, v in spec.args.items()},
            "required": list(spec.required),
        },
    }


def _evidence_block(
    tool_results: list[ToolResult],
    hits: list[retrieval.Hit],
    book: redaction.AliasBook,
) -> tuple[str, list[str]]:
    """외부로 나갈 근거 블록을 만든다. **여기서 마스킹이 끝나야 한다.**

    조회 결과는 `to_wire()` 를 통과시킨다 — 공급사명·고객사명·클레임 원문은
    허용목록에 없어 통째로 빠지고, LOT 번호 같은 식별자는 `LOT#1` 로 치환된다.
    치환 사전(`book`)은 답변을 되돌릴 때 다시 쓴다 (§2.8.3).

    반환값의 두 번째는 **버려진 필드 목록**이다. 조용히 버리지 않는다.
    """
    parts: list[str] = []
    dropped: list[str] = []

    if tool_results:
        parts.append("[조회 결과]")
        for tr in tool_results:
            if tr.unanswerable:
                parts.append(f"· {tr.tool}: {tr.unanswerable.get('message', '답할 수 없음')}")
                continue
            wire = redaction.to_wire(tr.result, book)
            redaction.assert_wire_safe(wire)      # §2.8.4 단일 출구
            dropped.extend(wire.dropped)
            body = json.dumps(wire.fields, ensure_ascii=False, default=str)[:2500]
            parts.append(f"· {tr.tool}({_compact(tr.args)})\n{body}")

    if hits:
        # 🔴 문서 청크도 외부로 나간다. 임베딩과 같은 승인 게이트를 적용한다 —
        #    WS-KS-001·QS-KS-001 은 대외비다.
        embed.assert_transfer_allowed(len(hits))
        parts.append("\n[문서 근거]")
        for h in hits:
            parts.append(f"── {h.label} (유사도 {h.score})\n{h.content}")

    return "\n".join(parts), dropped


def _compact(args: dict) -> str:
    return ", ".join(f"{k}={v}" for k, v in args.items() if v is not None)


# ══════════════════════════════════════════════════════════════════════════
# 본체
# ══════════════════════════════════════════════════════════════════════════
def answer(
    db: Session,
    *,
    question: str,
    scope: str,
    role: str,
) -> AgentOutcome:
    t0 = time.perf_counter()
    lat: dict[str, int] = {}
    snapshot = rules.load(db)
    out = AgentOutcome(
        answer=None, answer_status=STATUS_NO_EVIDENCE, rule_hash=snapshot.hash()
    )

    llm = providers.get_llm()          # 미설정이면 ProviderUnavailable → 라우터가 501
    out.provider, out.model_id = llm.provider, llm.model_id

    specs = tool_registry.tools_for(scope, role)

    # ── 1) 도구 선택 — LLM 은 "어느 쿼리 + 어떤 파라미터" 만 고른다 ──────────
    plan_system = (
        f"{SYSTEM_BASE}\n\n오늘 날짜는 {dt.date.today().isoformat()} 다.\n"
        f"이 화면({scope})이 답할 수 있는 것: {SCOPE_GUIDE.get(scope, '')}\n\n"
        "질문에 답하는 데 필요한 도구를 골라 호출하라. 도구가 필요 없는 "
        "문서·기준 질문이면 아무 도구도 부르지 말고 그렇다고만 답하라."
    )
    plan, ms = providers.timed(
        llm.complete,
        system=plan_system,
        messages=[{"role": "user", "content": question}],
        tools=[_tool_schema(s) for s in specs],
    )
    lat["classify"] = ms
    out.input_tokens, out.output_tokens = plan.input_tokens, plan.output_tokens
    out.cached_input_tokens = plan.cached_input_tokens

    # ── 2) 도구 실행 — 우리 코드가 한다 ────────────────────────────────────
    tool_results: list[ToolResult] = []
    calls_log: list[dict] = []
    partial = False
    t_sql = time.perf_counter()
    for call in plan.tool_calls:
        started = time.perf_counter()
        try:
            tr = tool_registry.run(db, call["name"], scope=scope, role=role, **(call.get("args") or {}))
            tool_results.append(tr)
            rows = tr.citation.count if tr.citation else None
            calls_log.append({
                "tool": call["name"], "args": call.get("args"),
                "rows": rows, "ms": int((time.perf_counter() - started) * 1000),
            })
        except ToolError as exc:
            # 일부 조회 실패는 전체 실패가 아니다 (§5.2.3 partial)
            partial = True
            calls_log.append({
                "tool": call["name"], "args": call.get("args"),
                "error": str(exc), "ms": int((time.perf_counter() - started) * 1000),
            })
    lat["sql"] = int((time.perf_counter() - t_sql) * 1000)
    out.tool_calls, out.partial = calls_log, partial

    # ── 3) RAG 검색 ────────────────────────────────────────────────────────
    hits: list[retrieval.Hit] = []
    ready, _ = retrieval.index_ready(db)
    t_ret = time.perf_counter()
    if ready:
        embedder = providers.get_embeddings()
        vector = embedder.embed_query(question)
        found = retrieval.search(db, vector, scope=scope)
        hits, out.retrieval_stats = found.hits, found.stats
    else:
        out.retrieval_stats = {"k": config.RETRIEVE_K, "returned": 0, "index_ready": False}
    lat["retrieve"] = int((time.perf_counter() - t_ret) * 1000)

    # ── 4) 근거 수집 ───────────────────────────────────────────────────────
    evidence: list[Evidence] = []
    for tr in tool_results:
        c = tr.citation
        if c is None:
            continue
        evidence.append(Evidence(
            kind=c.kind, label=c.label, snippet=c.snippet, row_count=c.count,
            score=c.score, detail=c.detail, link=c.link,
            source_ref=f"{tr.tool}:{_args_hash(tr.args)}",
        ))
    for h in hits:
        evidence.append(Evidence(
            kind="doc", label=h.label, snippet=h.content[:1500], score=h.score,
            chunk_id=h.chunk_id, source_ref=h.label,
        ))

    # ── 5) 근거 0건이면 LLM 을 부르지 않는다 (§4.6) ────────────────────────
    qualified = [e for e in evidence if e.qualifies()]
    if not qualified:
        out.answer_status = STATUS_NO_EVIDENCE
        out.route = ROUTE_REFUSE
        out.evidence = []
        lat["total"] = int((time.perf_counter() - t0) * 1000)
        out.latency_ms = lat
        return out

    out.route = (
        ROUTE_HYBRID if tool_results and hits else (ROUTE_TOOL if tool_results else ROUTE_RAG)
    )

    # ── 6) 답변 생성 + 검증 (재생성 1회) ──────────────────────────────────
    gen_system = f"{SYSTEM_BASE}\n\n{snapshot.as_prompt_block()}"
    book = redaction.AliasBook()
    block, dropped = _evidence_block(tool_results, hits, book)
    sent = f"질문: {question}\n\n{block}"
    if dropped:
        # 버려진 필드가 있다는 사실을 LLM 에게 알린다. 모르면 "공급사명은
        # 확인되지 않았다" 대신 아무 이름이나 지어낼 수 있다.
        sent += f"\n\n[전송에서 제외된 항목 — 이 값은 모른다고 답하라]\n{', '.join(sorted(set(dropped)))}"

    # 🔴 실제 나간 것을 그대로 기록한다 (§6.6 prompt_sent — 통제의 사후 검증)
    out.prompt_sent = sent

    t_gen = time.perf_counter()
    result, _ = providers.timed(
        llm.complete, system=gen_system, messages=[{"role": "user", "content": sent}]
    )
    lat["generate"] = int((time.perf_counter() - t_gen) * 1000)
    out.raw_answer = result.text
    _add_tokens(out, result)

    t_val = time.perf_counter()
    # 별칭을 원문으로 되돌린 뒤 검증한다 — 화면에 `LOT#1` 이 남으면 안 된다
    checked = validate.validate(redaction.from_wire(result.text, book), qualified, snapshot)

    if checked.blocked:
        # 위반 항목을 명시해 1회만 재생성한다. 2회 해서 안 되면 모델이 못 하는 것이다.
        retry_msg = (
            f"{sent}\n\n[직전 답변이 다음 규칙을 어겼다. 고쳐서 다시 답하라]\n"
            + "\n".join(f"- {v}" for v in checked.violations)
        )
        retry, _ = providers.timed(
            llm.complete, system=gen_system, messages=[{"role": "user", "content": retry_msg}]
        )
        out.regenerated = True
        out.raw_answer = f"{result.text}\n\n--- 재생성 ---\n{retry.text}"
        _add_tokens(out, retry)
        checked = validate.validate(redaction.from_wire(retry.text, book), qualified, snapshot)

    lat["validate"] = int((time.perf_counter() - t_val) * 1000)
    lat["total"] = int((time.perf_counter() - t0) * 1000)
    out.latency_ms = lat
    out.evidence = checked.evidence
    out.violations = checked.as_strings()

    if checked.blocked:
        # 🔴 답변을 통째로 버린다. 부분 노출하면 어디가 지워졌는지 사용자가 모른다.
        out.answer, out.answer_status = None, STATUS_RULE_VIOLATION
    else:
        out.answer, out.answer_status = checked.answer, STATUS_OK
    return out


def _add_tokens(out: AgentOutcome, r: providers.LlmResult) -> None:
    for field_name, value in (
        ("input_tokens", r.input_tokens),
        ("output_tokens", r.output_tokens),
        ("cached_input_tokens", r.cached_input_tokens),
    ):
        if value is None:
            continue
        setattr(out, field_name, (getattr(out, field_name) or 0) + value)


def _args_hash(args: dict) -> str:
    return hashlib.sha256(
        json.dumps(args, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()[:12]
