"""현장 문서 → RAG 청크 적재 파이프라인 (`agent-architecture.md` §3.6·§3.7).

    read_blocks(path)   .docx 를 문서 순서대로 블록화 (표를 제목과 붙여 둔다)
    chunk_blocks(...)   제목 경계 우선 청킹
    load_source(...)    doc_sources / doc_chunks 에 삭제 후 재생성

**임베딩은 여기 없다.** 모델과 차원이 미정이라(§8 미결 2번) 벡터 컬럼을 아직
만들지 않았다. 확정되면 `embed.py` 를 붙이고 후속 마이그레이션으로 컬럼을
추가한 뒤 `index_status` 를 `indexed` 로 올린다.
"""
from src.agent.ingest.chunker import Chunk, chunk_blocks, count_tokens
from src.agent.ingest.docx_reader import Block, read_blocks, render_table
from src.agent.ingest.loader import LoadResult, content_hash, load_source

__all__ = [
    "Block",
    "read_blocks",
    "render_table",
    "Chunk",
    "chunk_blocks",
    "count_tokens",
    "LoadResult",
    "content_hash",
    "load_source",
]
