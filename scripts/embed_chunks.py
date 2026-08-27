"""적재된 청크에 임베딩을 채우고 색인을 완료 처리한다.

    .venv/bin/python scripts/embed_chunks.py --status   # 색인 상태만 확인
    .venv/bin/python scripts/embed_chunks.py            # 임베딩 실행

🔴 **지금은 실행되지 않는다.** 대상 문서 WS-KS-001·QS-KS-001 은 표지에 "사내 표준
(대외비 · 무단 복제 및 반출 금지)" 이 찍혀 있고, 임베딩은 그 전문을 외부 API 로
보내는 행위다. 사업계획서 p.60 §9.2 의 폐쇄형 요구와 충돌하므로 `CR-ARCH-001`
승인 전에는 `src.agent.embed.assert_transfer_allowed()` 가 거부한다.

승인 후 순서:
  1. CISO 확인 → `AGENT_EXTERNAL_EMBED_APPROVED=1`
  2. `AGENT_EMBED_MODEL` 설정 + 제공자 어댑터 구현 (`embed.get_provider`)
  3. 이 스크립트 실행 → `index_status='indexed'`
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select

from src.agent import embed
from src.db.models import DocChunk, DocSource
from src.db.session import SessionLocal

#: 한 번에 보낼 청크 수. 제공자 어댑터가 더 작은 제한을 두면 그쪽이 이긴다.
BATCH = 64


def cmd_status(db) -> int:
    rows = db.execute(
        select(
            DocSource.title,
            DocSource.index_status,
            DocSource.chunk_count,
            func.count(DocChunk.embedding),
        )
        .join(DocChunk, DocChunk.source_id == DocSource.id)
        .group_by(DocSource.id, DocSource.title, DocSource.index_status, DocSource.chunk_count)
        .order_by(DocSource.id)
    ).all()

    if not rows:
        print("코퍼스가 비어 있다. scripts/ingest_docs.py 를 먼저 실행하라.")
        return 0

    print(f"{'문서':<34} {'상태':<9} {'청크':>5} {'임베딩':>6}")
    print("-" * 60)
    ready = True
    for title, status, total, embedded in rows:
        print(f"{title:<34} {status:<9} {total:>5} {embedded:>6}")
        if status != "indexed" or embedded != total:
            ready = False

    print(f"\nAGENT_EMBED_MODEL = {embed.model_id()} · 차원 {embed.EMBED_DIM}")
    print(f"외부 전송 승인({embed.APPROVAL_ENV}) = {embed.external_transfer_approved()}")
    print(f"검색 준비(index_ready) = {ready}")
    if not ready:
        print("\n→ 검색은 아직 동작하지 않는다. AI 는 이 문서로 답하지 못한다.")
    return 0


def cmd_embed(db, *, force: bool = False) -> int:
    stmt = select(DocChunk, DocSource.title).join(
        DocSource, DocSource.id == DocChunk.source_id
    ).order_by(DocChunk.id)
    if not force:
        stmt = stmt.where(DocChunk.embedding.is_(None))
    rows = db.execute(stmt).all()
    pending = [c for c, _ in rows]
    titles = {c.id: t for c, t in rows}
    if not pending:
        print("임베딩할 청크가 없다. 전량 다시 만들려면 --force 를 쓴다.")
        return 0

    # 승인 확인이 **첫 줄**이다. 키가 있는지, 네트워크가 되는지는 그 다음 문제다.
    embed.assert_transfer_allowed(len(pending))

    provider = embed.get_provider()
    if provider.dimension != embed.EMBED_DIM:
        raise RuntimeError(
            f"제공자 차원 {provider.dimension} 이 컬럼 정의 {embed.EMBED_DIM} 와 다르다. "
            "마이그레이션이 필요하다 — 조용히 진행하지 않는다."
        )

    done = 0
    for i in range(0, len(pending), BATCH):
        batch = pending[i : i + BATCH]
        # 🔴 본문만 넣지 않는다 — 제목 경로를 앞에 붙인다 (embed.text_for 참조).
        #    표 청크가 자연어 질문에 걸리지 않는 문제를 실측으로 확인하고 고쳤다.
        vectors = provider.embed_documents(
            [embed.text_for(titles[c.id], c.heading, c.content) for c in batch]
        )
        if len(vectors) != len(batch):
            raise RuntimeError(f"임베딩 개수 불일치: 요청 {len(batch)} / 응답 {len(vectors)}")
        for chunk, vec in zip(batch, vectors):
            chunk.embedding = vec
            chunk.embed_model = provider.model_id
            chunk.embed_dim = provider.dimension
        db.commit()
        done += len(batch)
        print(f"  {done}/{len(pending)}")

    # 전부 채워진 원본만 indexed 로 올린다 — 하나라도 비면 pending 이다
    for src in db.execute(select(DocSource)).scalars().all():
        missing = db.execute(
            select(func.count(DocChunk.id)).where(
                DocChunk.source_id == src.id, DocChunk.embedding.is_(None)
            )
        ).scalar_one()
        if missing == 0 and src.chunk_count > 0:
            src.index_status = "indexed"
            src.indexed_at = dt.datetime.now()
            src.index_error = None
    db.commit()
    print("\n색인 완료.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", action="store_true", help="색인 상태만 확인한다")
    ap.add_argument("--force", action="store_true",
                    help="이미 임베딩된 청크도 전량 다시 만든다 (모델·전처리 변경 시)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        if args.status:
            return cmd_status(db)
        try:
            return cmd_embed(db, force=args.force)
        except embed.ExternalTransferBlocked as exc:
            print(f"🔴 차단됨\n\n{exc}")
            return 2
        except NotImplementedError as exc:
            print(f"미구현\n\n{exc}")
            return 3
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
