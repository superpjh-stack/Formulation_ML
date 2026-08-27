"""RAG 검색 — pgvector 코사인. `agent-architecture.md` §3.6.

k=5, 코사인 거리, HNSW. **유사도 하한 컷오프가 이 모듈의 핵심**이다 — 설계서가
"환각 방지의 1차 방어선" 이라 부른 것이고, 미달이면 청크를 아예 넘기지 않아
`no_evidence` 가 된다. 넘기지 않으면 LLM 이 지어낼 재료가 없다 (§4.6).

컷오프 값은 `config.SIMILARITY_CUTOFF` 가 갖고 있고 **기본이 미설정(None)** 이다.
설계서가 "코퍼스 확보 후 실측으로 정한다 — 지금 숫자를 지어내지 않는다" 고
못박았기 때문이다. 미설정이면 컷오프를 적용하지 않고 그 사실을
`agent_runs.retrieval.cutoff = null` 로 남긴다 — 방어선이 없었다는 것이 로그에
보여야 한다.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.agent import config
from src.db.models import DocChunk, DocSource


@dataclass(frozen=True)
class Hit:
    chunk_id: int
    source_title: str
    heading: str | None
    content: str
    #: 코사인 유사도 (1 - 거리). 1 에 가까울수록 비슷하다.
    score: float

    @property
    def label(self) -> str:
        """인용 라벨 — "문서 3쪽" 이 아니라 절을 가리켜야 한다 (§3.6)."""
        return f"{self.source_title} · {self.heading}" if self.heading else self.source_title


@dataclass(frozen=True)
class RetrievalResult:
    hits: list[Hit]
    #: `agent_runs.retrieval` 에 그대로 들어간다 (§6.6)
    stats: dict


def index_ready(db: Session) -> tuple[bool, int]:
    """(검색 가능한가, 임베딩된 청크 수).

    `index_status='indexed'` 만 보지 않는다. 상태값과 실제 데이터가 어긋날 수 있고,
    검색이 되는지는 **임베딩이 실제로 있는지**가 정한다.
    """
    n = db.execute(
        select(DocChunk.id).where(DocChunk.embedding.isnot(None)).limit(1)
    ).first()
    count = 0
    if n is not None:
        from sqlalchemy import func

        count = db.execute(
            select(func.count(DocChunk.id)).where(DocChunk.embedding.isnot(None))
        ).scalar_one()
    return (n is not None), count


def search(
    db: Session,
    query_vector: list[float],
    *,
    k: int | None = None,
    scope: str | None = None,
) -> RetrievalResult:
    """`scope` 는 `doc_sources.scope` 로 좁힌다. `common` 은 항상 포함한다 (§3.6).

    입고 화면에서 물었다고 공통 문서를 빼면 작업표준서 전체가 사라진다.
    """
    k = k or config.RETRIEVE_K
    cutoff = config.SIMILARITY_CUTOFF

    distance = DocChunk.embedding.cosine_distance(query_vector)
    stmt = (
        select(DocChunk, DocSource.title, distance.label("distance"))
        .join(DocSource, DocSource.id == DocChunk.source_id)
        .where(DocChunk.embedding.isnot(None))
        .order_by(distance)
        .limit(k)
    )
    if scope and scope != "common":
        stmt = stmt.where(DocSource.scope.in_([scope, "common"]))

    rows = db.execute(stmt).all()
    raw = [
        Hit(
            chunk_id=chunk.id,
            source_title=title,
            heading=chunk.heading,
            content=chunk.content,
            score=round(1.0 - float(dist), 4),
        )
        for chunk, title, dist in rows
    ]

    kept = [h for h in raw if cutoff is None or h.score >= cutoff]

    return RetrievalResult(
        hits=kept,
        stats={
            "k": k,
            "returned": len(kept),
            "candidates": len(raw),
            "min_score": min((h.score for h in kept), default=None),
            "top_score": max((h.score for h in raw), default=None),
            # 🔴 None 이면 "컷오프를 적용하지 않았다" 는 뜻이다. 0 으로 채우지 않는다.
            "cutoff": cutoff,
        },
    )
