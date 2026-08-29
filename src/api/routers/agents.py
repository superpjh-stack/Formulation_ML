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
| `/mixing` `/analysis` `/decision` `/recommendations` | **501 유지** | 선택 |

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
from src.api.deps import get_current_user, get_db, require_roles
from src.api.errors import NOT_IMPLEMENTED_DETAIL
from src.api.middleware import set_audit
from src.api.schemas import Page, PageParams, paginate
from src.api.serialization import iso
from src.db.models import (
    AgentCitation,
    AgentFeedback,
    AgentMessage,
    AgentRun,
    AgentSession,
    DocChunk,
    DocSource,
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

    return AgentAnswerOut(
        message_id=assistant.id,
        session_id=session.id,
        answer=outcome.answer,
        answer_status=outcome.answer_status,
        sources=[_citation_out(c) for c in assistant.citations],
        violations=outcome.violations,
        partial=outcome.partial,
        latency_ms=outcome.total_ms,
        provider=outcome.provider,
        model_id=outcome.model_id,
    )


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
# 501 유지 — 선택 화면 5종 (§7.2)
# ══════════════════════════════════════════════════════════════════════════
def _not_implemented():
    raise HTTPException(status_code=501, detail=NOT_IMPLEMENTED_DETAIL)


_STILL_501: tuple[tuple[str, str, str, str], ...] = (
    ("/mixing", "POST", "FE-RT-15", "배합 AI Agent"),
    ("/analysis", "POST", "FE-RT-39", "자동 분석 리포트"),
    ("/decision", "POST", "FE-RT-40", "의사결정 지원"),
    ("/recommendations", "GET", "FE-RT-41", "추천 이력"),
)

for _path, _method, _screen, _name in _STILL_501:
    router.add_api_route(
        _path, _not_implemented, methods=[_method], status_code=501,
        summary=f"{_screen} {_name} (미구현 — 501)",
        description=(
            f"**501 Not Implemented.** {_screen} 은 v1.1 게이트 밖이다 "
            "(agent-architecture.md §7.2). 프론트는 501 을 받아 \"준비 중\" 을 "
            "렌더링한다. 가짜 응답으로 채우지 마라."
        ),
    )

del _path, _method, _screen, _name

__all__ = ["router"]
