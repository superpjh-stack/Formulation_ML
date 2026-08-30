"""AI Agent — `agent-architecture.md` §7.

v1.1 게이트는 **`/agents/receiving`(FE-RT-10) · `/agents/shipping`(FE-RT-20) 두 개**다
(§2.12). 나머지 5개 생성 엔드포인트는 **501 을 그대로 둔다** — 화면은 "준비 중" 을
렌더링한다. 가짜 응답으로 채우지 않는다.

| 경로 | 상태 | 화면 |
|---|---|---|
| `POST /agents/receiving` | 🔴 **실동작** | FE-RT-10 |
| `POST /agents/shipping` | 🔴 **실동작** | FE-RT-20 |
| `GET  /agents/health` | 실동작 | 화면이 "준비됨/미구성" 을 판단하는 유일한 근거 |
| `GET  /agents/sessions` · `/{id}` · DELETE | 실동작 | 본인 것만 |
| `POST /agents/messages/{id}/feedback` | 실동작 | 정확도의 실측 원천 |
| `GET  /agents/logs` | 실동작 (**admin 전용**) | FE-RT-42 |
| `POST /agents/reindex` | 실동작 (**admin 전용**) | §3.7 |
| `POST /agents/query` | 실동작 (**문서 전용**) | FE-RT-38 |
| `POST /agents/mixing` | 실동작 | FE-RT-15 |
| `POST /agents/decision` | 실동작 | FE-RT-40 |
| `POST /agents/analysis` | 실동작 (**차트 없음**) | FE-RT-39 |
| `GET  /agents/recommendations` | 실동작 | FE-RT-41 (**LLM 을 부르지 않는다**) |
| `POST/DELETE /agents/recommendations/{id}/apply` | 실동작 | 추천 ↔ 실제 LOT 연결 |

**`/agents/logs` 를 admin 전용으로 좁혔다** (§7.1). `agent_runs.prompt_sent` 에
외부 송출 전문이 들어가므로 다른 사용자의 질문 전문을 전 직원이 보면 안 된다.

오류 계약은 §7.6 — **새 코드를 발명하지 않는다.**
    제공자 미설정/키 없음 → **501** (§5.1 문구 그대로)
    LLM 장애·레이트리밋   → **503** "서비스 일시 중단"
    남의 세션            → **403** · 없는 세션 → **404** · 재평가 → **409**
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from src.agent import config, embed, orchestrator, providers, retrieval
from src.agent import tools as tool_registry
from src.agent.tools._base import ToolError
from src.api.deps import get_current_user, get_db, require_roles
from src.api.errors import NOT_IMPLEMENTED_DETAIL
from src.api.middleware import set_audit
from src.api.recommendation_log import SOURCE_AGENT, record as record_recommendation
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import iso
from src.api.serialization import safe_float
from src.db.models import (
    AgentCitation,
    AgentFeedback,
    AgentMessage,
    AgentRecommendation,
    AgentRun,
    AgentSession,
    DocChunk,
    DocSource,
    Lot,
    User,
)

router = APIRouter(prefix="/agents", tags=["G9 AI Agent"],
                   dependencies=[Depends(get_current_user)])

SERVICE_UNAVAILABLE = "서비스 일시 중단"
SESSION_NOT_FOUND = "세션을 찾을 수 없습니다"
FORBIDDEN = "접근 권한이 없습니다"


# ══════════════════════════════════════════════════════════════════════════
# 스키마
# ══════════════════════════════════════════════════════════════════════════
class AgentAskIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    session_id: int | None = None
    #: SSE 는 v1.1 미채택 (§7.4). 필드는 계약에 있으므로 받되 무시한다.
    stream: bool = False


class CitationOut(BaseModel):
    ord: int
    kind: str
    label: str
    link: str | None = None
    snippet: str | None = None
    score: float | None = None
    detail: str | None = None
    count: int | None = None


class AgentAnswerOut(BaseModel):
    message_id: int | None
    session_id: int
    #: 🔴 null 이 정상 값이다 (§6.4). 빈 문자열로 위장하지 않는다.
    answer: str | None
    answer_status: str
    sources: list[CitationOut]
    violations: list[str] = []
    partial: bool = False
    latency_ms: int
    provider: str | None = None
    model_id: str | None = None
    #: FE-RT-15 전용. `recommend_mix` 도구가 실행됐을 때만 채운다 (§7.1).
    #: 🔴 **수렴 실패면 `optimization_success:false` 를 담아 그대로 준다.**
    #:    실패를 성공으로 위장하지 않는다 (§5 오류 계약).
    recommended_ratios: dict | None = None


class DecisionIn(BaseModel):
    lot_id: str = Field(min_length=1, max_length=30)
    #: 계약(§7.1)에는 `{lot_id}` 뿐이지만 대화 이력에 남기려면 세션이 필요하다.
    #: 생략하면 새 세션을 연다 — `AgentAskIn` 과 같은 규약이다.
    session_id: int | None = None


class DecisionOut(BaseModel):
    """FE-RT-40. `AgentAnswerOut` + 구조화된 소견.

    🔴 `root_causes`·`recommendations` 는 **LLM 이 만들지 않는다.**
       목록 형태로 나오면 사람은 그것을 확인된 사실로 읽는다. 서술문이면
       "~로 보입니다" 로 넘길 수 있지만 불릿에는 그런 여지가 없다.
       그래서 데이터에서 직접 읽히는 것만 `src/agent/decision.py` 가 뽑는다.
    """

    message_id: int | None
    session_id: int
    answer: str | None
    answer_status: str
    sources: list[CitationOut]
    violations: list[str] = []
    latency_ms: int
    provider: str | None = None
    model_id: str | None = None
    root_causes: list[str]
    recommendations: list[str]
    #: 🔴 **항상 `null` 이다.** 계약에 필드가 있지만 신뢰도를 계산할 근거가 없다.
    #:    숫자를 넣으면 그 순간 지어낸 지표가 된다 — 화면은 `null` 을 "—" 로 그린다.
    confidence: float | None = None
    #: 목록의 성격을 화면이 오해하지 않도록 함께 보낸다
    disclaimer: str


class AnalysisIn(BaseModel):
    topic: str = Field(min_length=1, max_length=200)
    lot_id: str | None = Field(default=None, max_length=20)
    date_from: dt.date | None = None
    date_to: dt.date | None = None
    session_id: int | None = None


class AnalysisOut(BaseModel):
    """FE-RT-39. 화면은 `report` 를 본문으로 그리고 `charts` 는 개수만 센다.

    🔴 **`charts` 는 항상 빈 배열이다.** 계약(§7.1)에 필드는 있지만 **원소
       스키마가 정의돼 있지 않다.** 지어내면 화면이 그 형태에 묶이고, 나중에
       실제 스키마가 정해지면 양쪽을 다시 갈아야 한다. 스키마가 없다는 사실을
       `charts_note` 로 그대로 알린다 — 빈 배열을 조용히 돌려주고 "차트 없음"
       으로 보이게 두지 않는다.
    """

    report: str | None
    answer_status: str
    charts: list = []
    charts_note: str
    sources: list[CitationOut] = []
    latency_ms: int
    message_id: int | None = None
    session_id: int
    provider: str | None = None
    model_id: str | None = None


class AgentHealthOut(BaseModel):
    provider: str | None
    model_id: str | None
    configured: bool
    embed_model: str | None
    index_ready: bool
    chunk_count: int
    failed_sources: int
    reason: str | None


class AgentSessionOut(BaseModel):
    id: int
    scope: str
    title: str | None
    started_at: str
    last_active_at: str
    message_count: int


class AgentMessageOut(BaseModel):
    id: int
    seq: int
    role: str
    content: str | None
    answer_status: str | None
    created_at: str
    sources: list[CitationOut] = []


class FeedbackIn(BaseModel):
    rating: int = Field(description="1 = 👍, -1 = 👎")
    reason: str | None = Field(default=None, max_length=30)
    comment: str | None = Field(default=None, max_length=500)


class FeedbackOut(BaseModel):
    id: int
    message_id: int
    rating: int
    reason: str | None
    created_at: str


class AgentLogOut(BaseModel):
    id: int
    scope: str
    route: str
    answer_status: str
    provider: str | None
    model_id: str | None
    total_ms: int
    input_tokens: int | None
    output_tokens: int | None
    violations: list | None
    regenerated: bool
    error_code: str | None
    created_at: str
    #: 누가 물었나 — 감사 로그의 핵심이다. `admin` 전용 엔드포인트라 노출한다.
    username: str | None = None
    #: 질문 원문. **`prompt_sent`·`raw_answer` 는 여전히 내보내지 않는다** —
    #: 그쪽은 검색된 청크와 조회 결과가 통째로 붙은 외부 송출 전문이다.
    #: 질문만으로도 "누가 무엇을 물었나" 는 성립하고, 그게 p.60 이 요구한 것이다.
    question: str | None = None
    #: 👍 1 / 👎 -1 / 미평가 null. **null 을 0 으로 바꾸지 마라** — 평가 안 한 것과
    #: 중립 평가는 다르다 (§6.8 은 rating 을 1|-1 두 값으로만 정의했다).
    rating: int | None = None


class FeedbackSummaryOut(BaseModel):
    """FE-RT-42 "정확도" 의 정본 — `agent_feedback` 기반 만족도 (§6.8).

    🔴 **자동 지표를 지어내지 않는다.** 정답 라벨이 없는 자연어 답변에서 정확도를
    계산할 방법은 사람의 평가밖에 없다. 그래서 화면에도 "정확도" 가 아니라
    **"만족도(n건 평가)"** 로 표기한다.
    """

    positive: int
    negative: int
    rated: int
    #: 평가 대상이 될 수 있는 전체 실행 수 (분모가 아니라 **평가율**을 위한 값)
    total_runs: int
    #: 👍 / (👍 + 👎). 🔴 **평가가 0건이면 `null`** — 0.0 이 아니다.
    #: 0.0 을 내보내면 화면에 "만족도 0%" 가 뜨고, 그건 "아무도 평가 안 함" 이
    #: 아니라 "전원 불만족" 으로 읽힌다.
    satisfaction: float | None
    #: 사람이 읽는 설명. 값이 없으면 왜 없는지 말한다.
    note: str | None = None


# ══════════════════════════════════════════════════════════════════════════
# 실행
# ══════════════════════════════════════════════════════════════════════════
def _citation_out(c: AgentCitation) -> CitationOut:
    return CitationOut(
        ord=c.ord, kind=c.kind, label=c.label, link=c.link, snippet=c.snippet,
        score=float(c.score) if c.score is not None else None,
        detail=c.detail, count=c.row_count,
    )


def _ask(scope: str, body: AgentAskIn, request: Request, db: Session, user: User) -> AgentAnswerOut:
    session = _session_for(db, body.session_id, scope, user)

    try:
        outcome = orchestrator.answer(
            db, question=body.question, scope=scope, role=user.role
        )
    except providers.ProviderUnavailable as exc:
        # 제공자 미설정은 501, 호출 실패는 503 (§7.6). 둘을 섞지 않는다.
        if exc.code == "not_configured":
            raise HTTPException(status_code=501, detail=NOT_IMPLEMENTED_DETAIL) from exc
        _log_failure(db, session, user, scope, exc.code)
        raise HTTPException(status_code=503, detail=SERVICE_UNAVAILABLE) from exc
    except embed.ExternalTransferBlocked as exc:
        # 승인 없이 대외비 문서가 나가려 했다. 501 로 "미구성" 을 말한다 —
        # 503 은 일시 장애를 뜻해서 담당자가 재시도하게 만든다.
        _log_failure(db, session, user, scope, "transfer_blocked")
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    # 질문 저장
    seq = session.message_count
    db.add(AgentMessage(session_id=session.id, seq=seq, role="user", content=body.question))
    session.message_count = seq + 1

    assistant = AgentMessage(
        session_id=session.id,
        seq=session.message_count,
        role="assistant",
        content=outcome.answer,           # None 일 수 있다 — 그게 설계다
        answer_status=outcome.answer_status,
    )
    db.add(assistant)
    session.message_count += 1
    session.last_active_at = dt.datetime.now()
    if session.title is None:
        session.title = body.question[:200]
    db.flush()

    for i, e in enumerate(outcome.evidence):
        db.add(AgentCitation(
            message_id=assistant.id, ord=i, kind=e.kind, chunk_id=e.chunk_id,
            detail=e.detail, row_count=e.row_count,
            source_ref=e.source_ref[:200] or e.label[:200], label=e.label[:200],
            link=e.link, snippet=e.snippet, score=e.score,
        ))

    db.add(AgentRun(
        message_id=assistant.id, session_id=session.id, user_id=user.id,
        scope=scope, route=outcome.route, answer_status=outcome.answer_status,
        provider=outcome.provider, model_id=outcome.model_id,
        rule_hash=outcome.rule_hash, tool_calls=outcome.tool_calls or None,
        retrieval=outcome.retrieval_stats, latency_ms=outcome.latency_ms,
        total_ms=outcome.total_ms, input_tokens=outcome.input_tokens,
        output_tokens=outcome.output_tokens,
        cached_input_tokens=outcome.cached_input_tokens,
        violations=outcome.violations or None, regenerated=outcome.regenerated,
        error_code=outcome.error_code,
        prompt_sent=outcome.prompt_sent, raw_answer=outcome.raw_answer,
    ))
    db.commit()
    db.refresh(assistant)

    set_audit(request, target_table="agent_messages", target_id=assistant.id,
              after={"scope": scope, "answer_status": outcome.answer_status})

    # FE-RT-41 이력 — 추천이 실행됐으면 남긴다 (§6.9). 메시지가 커밋된 뒤라야
    # `message_id` 를 걸 수 있다. 적재 실패는 답변을 죽이지 않는다
    # (`recommendation_log` 모듈 주석 참조).
    rec = outcome.recommendation
    if rec:
        record_recommendation(
            db, source=SOURCE_AGENT,
            ratios={k: rec.get(k) for k in ("sn", "ag", "cu", "pb")},
            predicted_quality=rec.get("predicted_quality"),
            optimization_success=bool(rec.get("optimization_success")),
            model_name=rec.get("model"),
            temperature=rec.get("temperature"),
            process_time=rec.get("process_time"),
            supplier=rec.get("supplier"),
            user_id=user.id, message_id=assistant.id,
        )

    # 배합 추천이 실행됐으면 구조화된 값을 함께 준다 — 화면이 카드로 그린다.
    # 답변 텍스트에서 숫자를 파싱하지 않는다. 그건 LLM 표현에 의존하는 짓이다.
    ratios = None
    for call in outcome.tool_calls:
        if call.get("tool") == "recommend_mix" and call.get("rows"):
            ratios = _recommendation_of(outcome)
            break

    return AgentAnswerOut(
        message_id=assistant.id,
        session_id=session.id,
        recommended_ratios=ratios,
        answer=outcome.answer,
        answer_status=outcome.answer_status,
        sources=[_citation_out(c) for c in assistant.citations],
        violations=outcome.violations,
        partial=outcome.partial,
        latency_ms=outcome.total_ms,
        provider=outcome.provider,
        model_id=outcome.model_id,
    )


def _recommendation_of(outcome) -> dict | None:
    """`recommend_mix` 결과에서 배합비를 꺼낸다.

    오케스트레이터는 도구 원본을 들고 있지 않고 `tool_calls` 요약만 남기므로,
    구조화 값이 필요하면 여기서 다시 부르는 대신 **인용에 담긴 것만** 쓴다.
    지금은 답변 텍스트가 값을 말하고 있고, 화면이 필요로 하는 것은 "추천이
    실행됐다" 는 사실이다. 값 자체를 다시 계산해 붙이면 답변과 어긋날 수 있다.
    """
    for e in outcome.evidence:
        if e.kind == "model" and "배합 최적화" in e.label:
            return {"executed": True, "label": e.label, "detail": e.detail}
    return None


def _session_for(db: Session, session_id: int | None, scope: str, user: User) -> AgentSession:
    if session_id is None:
        s = AgentSession(user_id=user.id, scope=scope)
        db.add(s)
        db.flush()
        return s
    s = db.get(AgentSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND)
    if s.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail=FORBIDDEN)
    if s.scope != scope:
        # 입고 세션을 출하 화면에서 이어가면 도구 범위가 어긋난다 (§3.3.1)
        raise HTTPException(status_code=403, detail=FORBIDDEN)
    return s


def _log_failure(db: Session, session: AgentSession, user: User, scope: str, code: str) -> None:
    """실패도 남긴다 — 사업계획서 p.60 "사용 로그 기록·관리"."""
    db.add(AgentRun(
        session_id=session.id, user_id=user.id, scope=scope, route="refuse",
        answer_status="no_evidence", rule_hash="", latency_ms={}, total_ms=0,
        error_code=code,
    ))
    db.commit()


@router.post("/receiving", response_model=AgentAnswerOut, summary="FE-RT-10 입고 AI Agent")
def receiving_agent(body: AgentAskIn, request: Request, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    return _ask("receiving", body, request, db, user)


@router.post("/shipping", response_model=AgentAnswerOut, summary="FE-RT-20 출하 AI Agent")
def shipping_agent(body: AgentAskIn, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    return _ask("shipping", body, request, db, user)


@router.post("/mixing", response_model=AgentAnswerOut, summary="FE-RT-15 배합 AI Agent")
def mixing_agent(body: AgentAskIn, request: Request, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """배합 예측·최적화·실적 조회.

    도구는 `/predict`·`/recommend` 와 **같은 함수**를 부른다. 여기서 다시
    구현하면 경계 검증(`API_BOUNDS`)·피처 순서(`BUG-001`)·baseline 차단이
    두 벌이 되고 한쪽만 고쳐지는 날이 온다.

    `sales` 는 이 스코프에 도구가 없어 문서 근거로만 답한다 (`ROLE_SCOPES`).
    """
    return _ask("mixing", body, request, db, user)


@router.post("/decision", response_model=DecisionOut, summary="FE-RT-40 의사결정 지원")
def decision_agent(body: DecisionIn, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """LOT 하나의 이상 소견 + 표준이 규정한 조치.

    흐름이 다른 화면과 다르다 — **도구를 LLM 이 고르지 않는다.** 질문이 아니라
    `lot_id` 하나가 입력이므로 `lot_trace_full` 을 우리가 직접 부르고, 이상
    판정도 결정적 코드(`decision.analyze`)가 한다. LLM 은 그 결과를 **읽기 좋게
    풀어 쓰는 일만** 한다.
    """
    from src.agent import decision as decision_mod
    from src.agent import rules as rules_mod

    lot_id = body.lot_id.strip()
    session = _session_for(db, body.session_id, "shipping", user)

    try:
        trace = tool_registry.run(
            db, "lot_trace_full", scope="shipping", role=user.role, lot_id=lot_id
        )
    except ToolError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not (trace.result.get("lots") or {}).get("lot_id"):
        raise HTTPException(status_code=404, detail="LOT 을 찾을 수 없습니다")

    snapshot = rules_mod.load(db)
    report = decision_mod.analyze(
        trace.result,
        {
            "dev_warn_sn": snapshot.dev_warn_sn,
            "dev_warn_ag": snapshot.dev_warn_ag,
            "dev_warn_cu": snapshot.dev_warn_cu,
            "temp_warn_c": snapshot.temp_warn_c,
            "quality_pass_score": snapshot.quality_pass_score,
        },
    )

    # 소견을 질문으로 바꿔 서술을 맡긴다. 이상이 없으면 그것도 사실이다.
    if report.findings:
        question = (
            f"{lot_id} 에서 다음 이상이 관측됐다. 각각이 무엇을 뜻하고 "
            f"작업표준서·품질기준서가 어떤 조치를 규정하는지 설명해줘.\n"
            + "\n".join(f"- {c}" for c in report.root_causes)
        )
    else:
        question = f"{lot_id} 의 이력을 요약해줘. 임계를 넘은 항목은 없다."

    body2 = AgentAskIn(question=question, session_id=session.id)
    answer = _ask("shipping", body2, request, db, user)

    return DecisionOut(
        message_id=answer.message_id,
        session_id=answer.session_id,
        answer=answer.answer,
        answer_status=answer.answer_status,
        sources=answer.sources,
        violations=answer.violations,
        latency_ms=answer.latency_ms,
        provider=answer.provider,
        model_id=answer.model_id,
        root_causes=report.root_causes,
        recommendations=report.recommendations,
        confidence=None,
        disclaimer=(
            "위 항목은 **관측된 이상**이며 확인된 근본 원인이 아닙니다. "
            "편차가 났다는 사실과 그것이 불량의 원인이라는 것은 다른 말입니다. "
            "조치는 작업표준서·품질기준서가 규정한 내용이며, 최종 판단은 담당자가 합니다."
        ),
    )


@router.post("/analysis", response_model=AnalysisOut, summary="FE-RT-39 자동 분석 리포트")
def analysis_agent(body: AnalysisIn, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """주제·기간·LOT 으로 분석 리포트를 만든다.

    스코프는 `global`(문서 전용)이다. 이 화면은 전 역할이 쓰므로 DB 도구를
    붙이면 §7.7 의 역할별 통제를 우회한다 — `/query` 와 같은 판단이다.

    다만 `lot_id` 가 주어지면 **그 LOT 하나만** 역할 검사를 거쳐 붙인다.
    권한이 없으면 조용히 빼지 않고 리포트 안에서 그 사실을 말한다.
    """
    parts = [f"분석 주제: {body.topic.strip()}"]
    if body.date_from or body.date_to:
        parts.append(f"기간: {body.date_from or '미지정'} ~ {body.date_to or '미지정'}")

    lot_note: str | None = None
    if body.lot_id:
        lot_id = body.lot_id.strip()
        try:
            trace = tool_registry.run(
                db, "lot_trace_full", scope="shipping", role=user.role, lot_id=lot_id
            )
            lot = (trace.result.get("lots") or {})
            if lot.get("lot_id"):
                parts.append(
                    f"대상 LOT {lot_id} — 상태 {lot.get('status')}, "
                    f"품질 {lot.get('quality_score')}점, 온도 {lot.get('temperature')}°C"
                )
            else:
                lot_note = f"{lot_id} 을(를) 찾을 수 없어 LOT 정보 없이 분석했습니다."
        except ToolError:
            # 🔴 조용히 빼지 않는다. 권한 때문에 빠졌다는 사실을 리포트가 말해야
            #    사용자가 "왜 이 LOT 얘기가 없지" 를 묻지 않는다.
            lot_note = (
                f"{user.role} 역할은 LOT 상세를 조회할 수 없어 "
                f"{lot_id} 정보 없이 문서 근거로만 분석했습니다."
            )
    if lot_note:
        parts.append(lot_note)

    ask = AgentAskIn(question="\n".join(parts), session_id=body.session_id)
    answer = _ask("global", ask, request, db, user)

    report = answer.answer
    if lot_note and report:
        report = f"{report}\n\n※ {lot_note}"

    return AnalysisOut(
        report=report,
        answer_status=answer.answer_status,
        charts=[],
        charts_note=(
            "차트는 제공하지 않습니다 — 계약에 charts[] 원소 스키마가 "
            "정의돼 있지 않습니다 (agent-architecture.md §7.1). "
            "필요한 차트 종류가 정해지면 추가합니다."
        ),
        sources=answer.sources,
        latency_ms=answer.latency_ms,
        message_id=answer.message_id,
        session_id=answer.session_id,
        provider=answer.provider,
        model_id=answer.model_id,
    )


@router.post("/query", response_model=AgentAnswerOut, summary="FE-RT-38 자연어 질의")
def query_agent(body: AgentAskIn, request: Request, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    """사내 기준 문서에 대한 자연어 질의 — **문서 근거 전용**.

    스코프 `global` 에는 DB 도구가 없다(`tools.SCOPE_TOOLS`). 두 스코프의 도구를
    합쳐 주고 싶어지지만 그러면 §7.7 의 역할별 통제를 정확히 우회한다 —
    `sales` 가 이 화면으로 입고 데이터에 닿는다. 실적 조회는 각 화면의 Agent 가
    한다.

    도구가 없으므로 오케스트레이터가 **도구 선택 호출을 건너뛴다.** 질문 1건에
    LLM 호출이 1회로 줄어 TPM 부담도 작다.
    """
    return _ask("global", body, request, db, user)


# ══════════════════════════════════════════════════════════════════════════
# 상태 — 화면이 "준비됨/미구성" 을 판단하는 유일한 근거 (§2.9)
# ══════════════════════════════════════════════════════════════════════════
@router.get("/health", response_model=AgentHealthOut, summary="AI Agent 구성 상태")
def health(db: Session = Depends(get_db)):
    """🔴 **키 값·앞자리·길이를 절대 반환하지 않는다.**"""
    cfg = config.llm_config()
    ready, chunks = retrieval.index_ready(db)
    failed = db.execute(
        select(func.count(DocSource.id)).where(DocSource.index_status == "failed")
    ).scalar_one()

    reason = cfg.reason
    if reason is None and not ready:
        total = db.execute(select(func.count(DocChunk.id))).scalar_one()
        reason = (
            f"청크 {total}건이 적재됐으나 임베딩이 없습니다. "
            "scripts/embed_chunks.py 를 실행하세요."
            if total else "AI 지식 문서가 아직 등록되지 않았습니다."
        )
    if reason is None and not embed.external_transfer_approved():
        reason = f"{embed.APPROVAL_ENV} 가 설정되지 않아 문서 근거를 사용할 수 없습니다."

    return AgentHealthOut(
        provider=cfg.provider, model_id=cfg.model_id, configured=cfg.configured,
        embed_model=embed.model_id() if cfg.configured else None,
        index_ready=ready, chunk_count=chunks, failed_sources=failed, reason=reason,
    )


# ══════════════════════════════════════════════════════════════════════════
# 세션
# ══════════════════════════════════════════════════════════════════════════
@router.get("/sessions", response_model=Page[AgentSessionOut], summary="내 대화 목록")
def list_sessions(db: Session = Depends(get_db), pg: PageParams = Depends(),
                  scope: str | None = Query(None), user: User = Depends(get_current_user)):
    stmt = select(AgentSession).where(AgentSession.user_id == user.id)
    if scope:
        stmt = stmt.where(AgentSession.scope == scope)
    stmt = stmt.order_by(AgentSession.last_active_at.desc())
    return paginate(db, stmt, pg, lambda s: {
        "id": s.id, "scope": s.scope, "title": s.title,
        "started_at": iso(s.started_at), "last_active_at": iso(s.last_active_at),
        "message_count": s.message_count,
    })


@router.get("/questions/recent", summary="내가 최근 물어본 질문")
def recent_questions(
    db: Session = Depends(get_db),
    scope: str | None = Query(None),
    limit: int = Query(10, ge=1, le=50),
    user: User = Depends(get_current_user),
):
    """다시 묻기용 목록. **본인 것만.**

    `/agents/sessions` 와 다르다. 세션 목록의 `title` 은 그 대화의 **첫 질문**
    하나뿐이라, 이어서 물은 후속 질문이 전부 빠진다. 여기서는 `agent_messages`
    의 user 행을 그대로 최신순으로 낸다.

    같은 문구를 여러 번 물었으면 **가장 최근 것 하나만** 남긴다 — 목록이
    같은 질문으로 채워지면 다시 묻기 목록으로서 쓸모가 없다.
    """
    stmt = (
        select(AgentMessage.content, func.max(AgentMessage.created_at).label("asked_at"))
        .join(AgentSession, AgentSession.id == AgentMessage.session_id)
        .where(
            AgentMessage.role == "user",
            AgentMessage.content.isnot(None),
            AgentSession.user_id == user.id,
        )
        .group_by(AgentMessage.content)
        .order_by(func.max(AgentMessage.created_at).desc())
        .limit(limit)
    )
    if scope:
        stmt = stmt.where(AgentSession.scope == scope)

    return {
        "items": [
            {"question": content, "asked_at": iso(asked_at)}
            for content, asked_at in db.execute(stmt).all()
        ]
    }


@router.get("/sessions/{session_id}", summary="대화 재개")
def get_session(session_id: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    s = db.get(AgentSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND)
    if s.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail=FORBIDDEN)
    messages = db.execute(
        select(AgentMessage).options(selectinload(AgentMessage.citations))
        .where(AgentMessage.session_id == s.id).order_by(AgentMessage.seq)
    ).scalars().all()
    return {
        "session": {
            "id": s.id, "scope": s.scope, "title": s.title,
            "started_at": iso(s.started_at), "last_active_at": iso(s.last_active_at),
            "message_count": s.message_count,
        },
        "messages": [
            {
                "id": m.id, "seq": m.seq, "role": m.role, "content": m.content,
                "answer_status": m.answer_status, "created_at": iso(m.created_at),
                "sources": [_citation_out(c).model_dump() for c in sorted(m.citations, key=lambda x: x.ord)],
            }
            for m in messages
        ],
    }


@router.delete("/sessions/{session_id}", status_code=204, summary="세션 삭제")
def delete_session(session_id: int, request: Request, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    s = db.get(AgentSession, session_id)
    if s is None:
        raise HTTPException(status_code=404, detail=SESSION_NOT_FOUND)
    if s.user_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail=FORBIDDEN)
    set_audit(request, target_table="agent_sessions", target_id=s.id,
              before={"scope": s.scope, "message_count": s.message_count})
    db.execute(delete(AgentSession).where(AgentSession.id == s.id))
    db.commit()


# ══════════════════════════════════════════════════════════════════════════
# 피드백 — 정확도의 유일한 실측 원천 (§6.8)
# ══════════════════════════════════════════════════════════════════════════
@router.post("/messages/{message_id}/feedback", response_model=FeedbackOut, status_code=201,
             summary="답변 평가 👍/👎")
def submit_feedback(message_id: int, body: FeedbackIn, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    if body.rating not in (1, -1):
        raise HTTPException(status_code=422, detail="rating 은 1 또는 -1 이어야 합니다")
    msg = db.get(AgentMessage, message_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="메시지를 찾을 수 없습니다")

    fb = AgentFeedback(message_id=message_id, user_id=user.id, rating=body.rating,
                       reason=body.reason, comment=body.comment)
    db.add(fb)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # 1인 1평가 (uq message_id, user_id) — §7.6 409
        raise HTTPException(status_code=409, detail="이미 평가한 답변입니다") from exc
    db.refresh(fb)
    return FeedbackOut(id=fb.id, message_id=fb.message_id, rating=fb.rating,
                       reason=fb.reason, created_at=iso(fb.created_at))


# ══════════════════════════════════════════════════════════════════════════
# 실행 로그 — admin 전용 (prompt_sent 가 들어 있다)
# ══════════════════════════════════════════════════════════════════════════
@router.get("/logs", response_model=Page[AgentLogOut], summary="FE-RT-42 실행 로그 (admin)",
            dependencies=[Depends(require_roles("admin"))])
def list_logs(db: Session = Depends(get_db), pg: PageParams = Depends(),
              scope: str | None = Query(None), status: str | None = Query(None),
              date_from: dt.date | None = Query(None), date_to: dt.date | None = Query(None)):
    """🔴 `prompt_sent`·`raw_answer` 는 **목록에 싣지 않는다.**

    admin 이라도 목록 화면에서 전 사용자의 질문 전문이 흘러나올 이유가 없다.
    필요하면 단건 조회를 별도로 만든다.
    """
    # 질문 원문은 **assistant 메시지의 바로 앞 user 메시지**다.
    # `agent_runs.message_id` 는 답변(assistant)을 가리키므로 `seq - 1` 을 집는다.
    asked = (
        select(AgentMessage.session_id, AgentMessage.seq, AgentMessage.content)
        .where(AgentMessage.role == "user")
        .subquery()
    )
    answered = select(AgentMessage.id, AgentMessage.session_id, AgentMessage.seq).subquery()

    stmt = (
        select(AgentRun, User.username, asked.c.content, AgentFeedback.rating)
        .outerjoin(User, User.id == AgentRun.user_id)
        .outerjoin(answered, answered.c.id == AgentRun.message_id)
        .outerjoin(
            asked,
            (asked.c.session_id == answered.c.session_id)
            & (asked.c.seq == answered.c.seq - 1),
        )
        .outerjoin(AgentFeedback, AgentFeedback.message_id == AgentRun.message_id)
    )
    if scope:
        stmt = stmt.where(AgentRun.scope == scope)
    if status:
        stmt = stmt.where(AgentRun.answer_status == status)
    if date_from:
        stmt = stmt.where(AgentRun.created_at >= dt.datetime.combine(date_from, dt.time.min))
    if date_to:
        stmt = stmt.where(AgentRun.created_at <= dt.datetime.combine(date_to, dt.time.max))
    stmt = stmt.order_by(AgentRun.created_at.desc(), AgentRun.id.desc())

    def row_dto(row) -> dict:
        r, username, question, rating = row
        return {
            "id": r.id, "scope": r.scope, "route": r.route,
            "answer_status": r.answer_status, "provider": r.provider,
            "model_id": r.model_id, "total_ms": r.total_ms,
            "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
            "violations": r.violations, "regenerated": r.regenerated,
            "error_code": r.error_code, "created_at": iso(r.created_at),
            "username": username, "question": question, "rating": rating,
        }

    return paginate(db, stmt, pg, row_dto, scalars=False)


@router.get("/feedback/summary", response_model=FeedbackSummaryOut,
            summary="FE-RT-42 만족도 (정확도의 정본)",
            dependencies=[Depends(get_current_user)])
def feedback_summary(
    db: Session = Depends(get_db),
    scope: str | None = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    """👍/(👍+👎). **평가가 0건이면 `satisfaction` 은 `null` 이다.**

    0.0 을 돌려주면 화면에 "만족도 0%" 가 뜨고, 그건 "아무도 평가하지 않음" 이
    아니라 "전원 불만족" 으로 읽힌다. 이 프로젝트가 걷어낸 조용한 실패와 같은
    종류다 — 없는 값을 그럴듯한 숫자로 채우는 것.
    """
    since = dt.datetime.now() - dt.timedelta(days=days)

    runs = select(AgentRun.message_id).where(
        AgentRun.created_at >= since, AgentRun.message_id.isnot(None)
    )
    if scope:
        runs = runs.where(AgentRun.scope == scope)
    ids = [r for (r,) in db.execute(runs).all()]
    total_runs = len(ids)

    positive = negative = 0
    if ids:
        rows = db.execute(
            select(AgentFeedback.rating, func.count(AgentFeedback.id))
            .where(AgentFeedback.message_id.in_(ids))
            .group_by(AgentFeedback.rating)
        ).all()
        counts = {int(k): int(v) for k, v in rows}
        positive, negative = counts.get(1, 0), counts.get(-1, 0)

    rated = positive + negative
    if rated == 0:
        note = (
            f"최근 {days}일 실행 {total_runs}건 중 평가가 0건입니다. "
            "만족도는 사용자가 👍/👎 를 눌러야 계산됩니다."
            if total_runs else f"최근 {days}일 실행 기록이 없습니다."
        )
        return FeedbackSummaryOut(
            positive=0, negative=0, rated=0, total_runs=total_runs,
            satisfaction=None, note=note,
        )

    return FeedbackSummaryOut(
        positive=positive, negative=negative, rated=rated, total_runs=total_runs,
        satisfaction=round(positive / rated * 100, 1),
        note=f"최근 {days}일 실행 {total_runs}건 중 {rated}건 평가 기준",
    )


@router.post("/reindex", summary="재색인 트리거 (admin)",
             dependencies=[Depends(require_roles("admin"))])
def reindex(db: Session = Depends(get_db)):
    """§3.7 — 상태만 되돌린다. 실제 임베딩은 `scripts/embed_chunks.py` 가 한다.

    HTTP 요청 안에서 전량 임베딩을 돌리면 타임아웃이 난다. 큐 인프라는 v1.1
    범위 밖이라, **무엇을 다시 만들어야 하는지 표시만** 하고 실행은 배치로 넘긴다.
    큐에 넣었다고 거짓말하지 않는다.
    """
    sources = db.execute(select(DocSource)).scalars().all()
    for s in sources:
        s.index_status = "stale"
    db.commit()
    return {
        "queued": False,
        "sources": len(sources),
        "detail": "재색인 대상으로 표시했습니다. scripts/embed_chunks.py 를 실행하세요.",
    }


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-41 추천 이력 — `FR-AG-04` "AI 배합 추천 이력 및 실제 적용 결과 비교"
#
# ── 2026-08-30: 501 을 해제했다 ────────────────────────────────────────────
#
# 이 화면만 501 이 남아 있던 이유는 UI 가 아니라 **저장소**였다. 추천이 어디에도
# 기록되지 않아 "지난달 추천을 몇 번 적용했나" 에 답할 방법이 없었다.
# `agent_recommendations`(§6.9)를 CR-DB-008 로 만들고, 추천이 나오는 두 경로
# (`POST /recommend` · `POST /agents/mixing`)가 전부 적재하게 했다.
#
# 🔴 **이 엔드포인트는 LLM 을 부르지 않는다** (§7.2 각주). 테이블 조회다.
# ══════════════════════════════════════════════════════════════════════════
class RatioSet(BaseModel):
    """배합 4성분. **없는 값은 `null` 이다** — 0 으로 채우면 "0% 투입"으로 읽힌다."""

    sn: float | None = None
    ag: float | None = None
    cu: float | None = None
    pb: float | None = None


class AgentRecommendationOut(BaseModel):
    """추천 1건 + 그 추천이 적용된 LOT 의 실적.

    🔴 `actual_ratios`·`actual_quality` 는 **저장값이 아니라 `lots` 조인 결과**다
       (§6.9 의 `actual_quality` 컬럼을 만들지 않은 이유는 모델 주석 참조).
       적용 LOT 이 없으면 `null` 이고, 화면은 그걸 `—` 로 그린다.

    ⚠ 차이(추천−적용)는 **서버가 계산하지 않는다.** 프론트가 두 값에서 만든다
       (plan-agent FE-RT-41 §4). 여기서 만들면 소수 자릿수 규약이 두 벌이 된다.
    """

    id: int
    recommended_at: str | None
    source: str
    username: str | None = None
    model_name: str | None = None
    input_temp: float | None = None
    input_time: float | None = None
    input_supplier: str | None = None
    recommended_ratios: RatioSet
    predicted_quality: float | None = None
    #: 🔴 `false` 인 행이 존재한다. 수렴 실패한 추천도 이력에 남는다 (§5)
    optimization_success: bool
    applied: bool
    applied_lot_id: str | None = None
    applied_at: str | None = None
    actual_ratios: RatioSet | None = None
    actual_quality: float | None = None


class ApplyIn(BaseModel):
    lot_id: str = Field(min_length=1, max_length=20)


#: 성분 3자리(`lots.*_ratio DECIMAL(6,3)`) · 품질 2자리(`quality.score DECIMAL(5,2)`)
_RATIO_DIGITS = 3
_SCORE_DIGITS = 2


def _username_of(db: Session, user_id: int | None) -> str | None:
    """목록은 조인으로 한 번에 읽지만, 단건 응답은 여기서 채운다.

    ⚠ **추천을 받은 사람**이지 지금 연결하는 사람이 아니다. 두 사람이 다를 수
      있고(작업자가 추천을 받고 반장이 적용을 확정), 그 구분이 사라지면
      화면이 연결자를 추천자로 읽는다.
    """
    if user_id is None:
        return None
    return db.execute(select(User.username).where(User.id == user_id)).scalar_one_or_none()


def _recommendation_out(rec: AgentRecommendation, lot: Lot | None,
                        username: str | None = None) -> dict:
    """행 하나를 응답 dict 로. **적용 LOT 이 없으면 실적 칸은 통째로 `null`.**"""
    actual = None
    if lot is not None:
        actual = RatioSet(
            sn=safe_float(lot.sn_ratio, _RATIO_DIGITS),
            ag=safe_float(lot.ag_ratio, _RATIO_DIGITS),
            cu=safe_float(lot.cu_ratio, _RATIO_DIGITS),
            pb=safe_float(lot.pb_ratio, _RATIO_DIGITS),
        )
    return {
        "id": rec.id,
        "recommended_at": iso(rec.recommended_at),
        "source": rec.source,
        "username": username,
        "model_name": rec.model_name,
        "input_temp": safe_float(rec.input_temp, 2),
        "input_time": safe_float(rec.input_time, 2),
        "input_supplier": rec.input_supplier,
        "recommended_ratios": RatioSet(
            sn=safe_float(rec.rec_sn, _RATIO_DIGITS),
            ag=safe_float(rec.rec_ag, _RATIO_DIGITS),
            cu=safe_float(rec.rec_cu, _RATIO_DIGITS),
            pb=safe_float(rec.rec_pb, _RATIO_DIGITS),
        ),
        "predicted_quality": safe_float(rec.predicted_quality, _SCORE_DIGITS),
        "optimization_success": bool(rec.optimization_success),
        "applied": rec.applied_lot_id is not None,
        "applied_lot_id": rec.applied_lot_id,
        "applied_at": iso(rec.applied_at),
        "actual_ratios": actual,
        # 실측 품질은 LOT 이 들고 있다. 미검사 LOT 이면 NULL 이고 그대로 내보낸다
        "actual_quality": safe_float(lot.quality_score, _SCORE_DIGITS) if lot else None,
    }


@router.get("/recommendations", response_model=Page[AgentRecommendationOut],
            summary="FE-RT-41 추천 이력 (추천 vs 실제 적용)")
def list_recommendations(
    db: Session = Depends(get_db),
    pg: PageParams = Depends(),
    applied: bool | None = Query(None, description="적용 여부. 생략하면 전체"),
    source: str | None = Query(None, description="`recommend_api` | `agent`"),
):
    """전 역할 R. 최신 추천이 위다.

    적용 LOT 의 배합·품질은 `lots` 를 **LEFT JOIN** 해서 조회 시점 값을 읽는다 —
    복사해 두지 않으므로 LOT 이 재검사되면 이 화면도 함께 바뀐다.
    """
    order = pg.parse_sort(
        {
            "recommended_at": AgentRecommendation.recommended_at,
            "applied_at": AgentRecommendation.applied_at,
            "predicted_quality": AgentRecommendation.predicted_quality,
        },
        default=AgentRecommendation.recommended_at.desc(),
    )

    stmt = (
        select(AgentRecommendation, Lot, User.username)
        .outerjoin(Lot, Lot.lot_id == AgentRecommendation.applied_lot_id)
        .outerjoin(User, User.id == AgentRecommendation.user_id)
        .order_by(order, AgentRecommendation.id.desc())
    )
    if applied is True:
        stmt = stmt.where(AgentRecommendation.applied_lot_id.isnot(None))
    elif applied is False:
        stmt = stmt.where(AgentRecommendation.applied_lot_id.is_(None))
    if source:
        stmt = stmt.where(AgentRecommendation.source == source)

    return paginate(
        db, stmt, pg,
        lambda row: _recommendation_out(row[0], row[1], row[2]),
        scalars=False,
    )


@router.post("/recommendations/{rec_id}/apply", response_model=AgentRecommendationOut,
             summary="추천을 실제 적용 LOT 에 연결",
             dependencies=[Depends(require_roles("admin", "manufacture", "quality"))])
def apply_recommendation(rec_id: int, body: ApplyIn, request: Request,
                         db: Session = Depends(get_db)):
    """"이 추천대로 배합했다" 를 사람이 확정한다.

    🔴 **자동으로 짝지어 주지 않는다.** 시간·배합비가 비슷한 LOT 을 골라 붙이면
       그건 추측이고, 화면은 그 추측을 "실제 적용 결과" 라고 읽는다 (FR-AG-04).
       누가 언제 연결했는지는 감사로그에 남는다.

    이미 연결된 추천은 **409** 다. 조용히 덮어쓰면 앞의 연결이 사라진다 —
    바꾸려면 DELETE 로 먼저 해제한다.
    """
    rec = db.get(AgentRecommendation, rec_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="추천 이력을 찾을 수 없습니다")
    if rec.applied_lot_id is not None:
        raise HTTPException(
            status_code=409,
            detail=f"이미 {rec.applied_lot_id} 에 연결된 추천입니다. 먼저 연결을 해제하세요",
        )

    lot_id = body.lot_id.strip()
    lot = db.execute(select(Lot).where(Lot.lot_id == lot_id)).scalar_one_or_none()
    if lot is None:
        raise HTTPException(status_code=404, detail="LOT 을 찾을 수 없습니다")

    rec.applied_lot_id = lot.lot_id
    rec.applied_at = dt.datetime.now()
    db.commit()
    db.refresh(rec)

    set_audit(request, target_table="agent_recommendations", target_id=rec.id,
              before={"applied_lot_id": None},
              after={"applied_lot_id": rec.applied_lot_id})
    return _recommendation_out(rec, lot, _username_of(db, rec.user_id))


@router.delete("/recommendations/{rec_id}/apply", response_model=AgentRecommendationOut,
               summary="추천–LOT 연결 해제",
               dependencies=[Depends(require_roles("admin", "manufacture", "quality"))])
def unapply_recommendation(rec_id: int, request: Request, db: Session = Depends(get_db)):
    """잘못 연결한 것을 되돌린다. 이미 해제된 추천에 다시 불러도 200 이다 (멱등).

    추천 행 자체는 지우지 않는다 — 추천이 있었다는 사실은 감사 기록이다.
    """
    rec = db.get(AgentRecommendation, rec_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="추천 이력을 찾을 수 없습니다")

    before = rec.applied_lot_id
    rec.applied_lot_id = None
    rec.applied_at = None
    db.commit()
    db.refresh(rec)

    set_audit(request, target_table="agent_recommendations", target_id=rec.id,
              before={"applied_lot_id": before}, after={"applied_lot_id": None})
    return _recommendation_out(rec, None, _username_of(db, rec.user_id))


__all__ = ["router"]
