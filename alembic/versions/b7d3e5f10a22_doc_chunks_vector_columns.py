"""doc_chunks 벡터 컬럼 — vector(1024) + HNSW

`agent-architecture.md` §6.7 의 벡터 3컬럼을 붙인다. 앞선 `fa92a1c0504e` 가
미룬 부분이며, 미결항목 2번(임베딩 모델·차원)이 **외부 API / 1024차원**으로
확정되어 진행한다.

차원 1024 근거 (`src/agent/embed.py` 참조): OpenAI text-embedding-3-large/small 은
`dimensions=1024` 축소를 지원하고 Voyage voyage-3 · Cohere embed-multilingual-v3 는
기본이 1024 다. 1024 로 두면 제공자를 바꿔도 **재임베딩만** 하면 되고 컬럼 타입
변경은 불필요하다.

⚠ **세 컬럼을 NULL 허용으로 만든다.** §6.7 은 NOT NULL 로 규정하지만 이미 122행이
적재돼 있고 아직 임베딩이 없다. 값 없이 NOT NULL 을 걸 수는 없고, 0 벡터로 채우면
**차원만 맞는 무의미한 벡터**가 색인에 들어가 AI 가 엉뚱한 청크를 근거로 답한다.
전량 임베딩이 끝난 뒤 후속 마이그레이션에서 NOT NULL 로 조인다.

그때까지 `doc_sources.index_status` 는 `pending` 이고 `GET /agents/health` 의
`index_ready` 는 false 다 — 컬럼이 생겼다는 것과 검색이 된다는 것은 다르다.

HNSW 인덱스는 §3.6 의 `m=16, ef_construction=64`, 거리는 코사인이다.

Revision ID: b7d3e5f10a22
Revises: fa92a1c0504e
Create Date: 2026-08-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "b7d3e5f10a22"
down_revision: Union[str, Sequence[str], None] = "fa92a1c0504e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: src/agent/embed.py 의 EMBED_DIM 과 반드시 같아야 한다.
EMBED_DIM = 1024


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.add_column("doc_chunks", sa.Column("embedding", Vector(EMBED_DIM), nullable=True))
    op.add_column("doc_chunks", sa.Column("embed_model", sa.String(length=60), nullable=True))
    op.add_column("doc_chunks", sa.Column("embed_dim", sa.Integer(), nullable=True))

    # §3.6 — 코사인 거리, m=16, ef_construction=64
    op.execute(
        "CREATE INDEX ix_doc_chunks_embedding_hnsw ON doc_chunks "
        "USING hnsw (embedding vector_cosine_ops) "
        "WITH (m = 16, ef_construction = 64)"
    )
    # 재색인 대상 스캔용 — `embed_model` 이 현재 설정과 다른 행을 찾는다 (§3.7)
    op.create_index("ix_doc_chunks_embed_model", "doc_chunks", ["embed_model"])


def downgrade() -> None:
    op.drop_index("ix_doc_chunks_embed_model", table_name="doc_chunks")
    op.execute("DROP INDEX IF EXISTS ix_doc_chunks_embedding_hnsw")
    op.drop_column("doc_chunks", "embed_dim")
    op.drop_column("doc_chunks", "embed_model")
    op.drop_column("doc_chunks", "embedding")
    # `vector` 확장은 남긴다 — 다른 곳이 쓰고 있을 수 있다
