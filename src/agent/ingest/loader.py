"""청크를 `doc_sources` / `doc_chunks` 에 적재한다 — `agent-architecture.md` §3.7.

재색인 규약을 그대로 따른다: 원본 1건의 청크는 **삭제 후 재생성**한다.
증분 갱신(바뀐 청크만 교체)은 하지 않는다 — 문서 중간에 한 문단이 추가되면
그 뒤 `chunk_index` 가 전부 밀려서 어차피 전량이 바뀐다.

`content_hash` 가 같으면 **건드리지 않는다**(§3.7 주 1회 정합성 점검). 같은
문서를 다시 적재해도 청크 id 가 유지되므로, 나중에 `agent_citations.chunk_id`
가 가리키는 대상이 이유 없이 사라지지 않는다.
"""
from __future__ import annotations

import datetime as dt
import hashlib
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from src.agent.ingest.chunker import Chunk
from src.db.models import DocChunk, DocSource

#: `doc_sources.scope` 허용값 (§6.7)
SCOPES = ("receiving", "shipping", "common")


@dataclass
class LoadResult:
    source_id: int
    title: str
    action: str          # created | reindexed | unchanged
    chunk_count: int
    token_count: int


def content_hash(chunks: list[Chunk]) -> str:
    """제목·본문·순번을 전부 넣는다.

    본문만 해싱하면 **제목만 바뀐 개정**(절 번호 변경 등)을 놓친다. 인용 라벨이
    제목에서 나오므로 그건 실질적 변경이다.
    """
    h = hashlib.sha256()
    for c in chunks:
        h.update(f"{c.chunk_index}\x1f{c.heading}\x1f{c.content}\x1e".encode())
    return h.hexdigest()


def load_source(
    db: Session,
    *,
    source_type: str,
    source_key: str,
    title: str,
    version: int,
    chunks: list[Chunk],
    scope: str = "common",
) -> LoadResult:
    if scope not in SCOPES:
        raise ValueError(f"scope 는 {SCOPES} 중 하나여야 한다: {scope!r}")
    if not chunks:
        raise ValueError(f"청크가 0건이다 — 적재하지 않는다: {source_key}")

    digest = content_hash(chunks)
    tokens = sum(c.token_count for c in chunks)

    src = db.execute(
        select(DocSource).where(
            DocSource.source_type == source_type, DocSource.source_key == source_key
        )
    ).scalar_one_or_none()

    if src is not None and src.content_hash == digest and src.chunk_count == len(chunks):
        return LoadResult(src.id, title, "unchanged", src.chunk_count, tokens)

    action = "created"
    if src is None:
        src = DocSource(
            source_type=source_type,
            source_key=source_key,
            title=title,
            scope=scope,
            version=version,
            content_hash=digest,
        )
        db.add(src)
        db.flush()
    else:
        action = "reindexed"
        db.execute(delete(DocChunk).where(DocChunk.source_id == src.id))
        src.title, src.scope, src.version = title, scope, version
        src.content_hash = digest

    src.chunk_count = len(chunks)
    src.updated_at = dt.datetime.now()
    # 벡터 컬럼이 아직 없으므로 색인은 완료가 아니다. `indexed` 로 적으면
    # `GET /agents/health` 가 검색 준비 완료라고 거짓말하게 된다 (§3.5 D3).
    src.index_status = "pending"
    src.index_error = None
    src.indexed_at = None

    db.add_all(
        DocChunk(
            source_id=src.id,
            chunk_index=c.chunk_index,
            heading=c.heading or None,
            content=c.content,
            token_count=c.token_count,
        )
        for c in chunks
    )
    db.flush()
    return LoadResult(src.id, title, action, len(chunks), tokens)
