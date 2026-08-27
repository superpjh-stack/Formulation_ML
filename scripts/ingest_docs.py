"""현장 문서(.docx)를 청킹해 RAG 코퍼스에 적재한다.

    .venv/bin/python scripts/ingest_docs.py --dry-run          # 청킹 결과만 확인
    .venv/bin/python scripts/ingest_docs.py                    # DB 적재
    .venv/bin/python scripts/ingest_docs.py --show WS-KS-001   # 청크 목록 출력
    .venv/bin/python scripts/ingest_docs.py --search 드로스     # 적재 결과 확인용 검색

⚠ **`--search` 는 RAG 검색이 아니다.** 임베딩 모델이 미정이라 벡터 검색은 아직
없고, 이건 적재가 제대로 됐는지 눈으로 보려고 붙인 단순 부분일치 조회다.
운영 검색 경로로 쓰면 안 된다.

문서 목록은 `SOURCES` 에 명시한다. 디렉터리를 훑지 않는다 — 어떤 문서가 코퍼스에
들어갔는지가 감사 대상이고, 폴더에 파일을 떨어뜨리면 자동으로 색인되는 구조는
승인받지 않은 문서가 조용히 들어갈 길을 연다.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from src.agent.ingest import chunk_blocks, load_source, read_blocks
from src.db.models import DocChunk, DocSource
from src.db.session import SessionLocal

DATA_DIR = Path(
    "/Users/gerardo92/Desktop/03 고려솔더 제조AI 플랫폼 구축 프로젝트 /고려솔더 데이터"
)


@dataclass(frozen=True)
class SourceSpec:
    doc_no: str
    filename: str
    title: str
    version: int
    scope: str


#: 코퍼스에 넣을 문서. 제조팀·품질보증팀이 제정한 **현장 문서만** 넣는다.
#: `docs/산출물/` 의 설계·요구사항 문서는 넣지 않는다 — 현장 질문에 설계서
#: 문장을 근거로 답하면 그럴듯하지만 틀린 답이 된다 (agent-architecture.md D1).
SOURCES: tuple[SourceSpec, ...] = (
    SourceSpec(
        doc_no="WS-KS-001",
        filename="고려솔더_작업표준서_WS-KS-001_v1.0.docx",
        title="작업표준서 WS-KS-001 Rev.0",
        version=1,
        # 8개 공정 전체를 다룬다. 입고(WS-01)·출하(WS-08) 절만 따로 떼면
        # 나머지 6개 공정이 검색에서 사라진다 → 문서 단위 scope 는 common.
        scope="common",
    ),
    SourceSpec(
        doc_no="QS-KS-001",
        filename="고려솔더_품질기준서_QS-KS-001_v1.0.docx",
        title="품질기준서 QS-KS-001 Rev.0",
        version=1,
        scope="common",
    ),
)


def build(spec: SourceSpec):
    path = DATA_DIR / spec.filename
    if not path.exists():
        raise FileNotFoundError(path)
    chunks = chunk_blocks(read_blocks(str(path)))
    # 청킹 결과가 비면 조용히 0건을 적재하지 않고 멈춘다
    if not chunks:
        raise RuntimeError(f"청크 0건 — 파서가 본문을 못 읽었다: {path}")
    return path, chunks


def cmd_show(doc_no: str) -> int:
    spec = next((s for s in SOURCES if s.doc_no == doc_no), None)
    if spec is None:
        print(f"모르는 문서번호: {doc_no}. 가능: {[s.doc_no for s in SOURCES]}")
        return 1
    _, chunks = build(spec)
    for c in chunks:
        print(f"[{c.chunk_index:>3}] {c.token_count:>4}tok  {c.heading}")
    return 0


def cmd_search(term: str) -> int:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(DocChunk, DocSource.title)
            .join(DocSource, DocSource.id == DocChunk.source_id)
            .where(DocChunk.content.ilike(f"%{term}%"))
            .order_by(DocSource.id, DocChunk.chunk_index)
        ).all()
        if not rows:
            print(f"'{term}' 를 포함한 청크가 없다.")
            return 0
        print(f"'{term}' — {len(rows)}개 청크\n")
        for chunk, title in rows:
            print(f"  {title} · {chunk.heading}")
            for line in chunk.content.split("\n"):
                if term in line:
                    print(f"      {line[:150]}")
        return 0
    finally:
        db.close()


def cmd_ingest(dry_run: bool) -> int:
    built = [(spec, *build(spec)) for spec in SOURCES]

    print(f"{'문서':<12} {'청크':>5} {'토큰':>7}  상태")
    print("-" * 60)
    db = SessionLocal()
    try:
        for spec, path, chunks in built:
            tokens = sum(c.token_count for c in chunks)
            if dry_run:
                print(f"{spec.doc_no:<12} {len(chunks):>5} {tokens:>7}  [dry-run]")
                continue
            r = load_source(
                db,
                source_type="file",
                source_key=str(path),
                title=spec.title,
                version=spec.version,
                chunks=chunks,
                scope=spec.scope,
            )
            print(f"{spec.doc_no:<12} {r.chunk_count:>5} {r.token_count:>7}  {r.action}")

        if dry_run:
            db.rollback()
            print("\n[dry-run] 저장하지 않았다.")
            return 0

        db.commit()
        total_c = db.execute(select(DocChunk.id)).scalars().all()
        srcs = db.execute(select(DocSource)).scalars().all()
        print(f"\n코퍼스: 원본 {len(srcs)}건 · 청크 {len(total_c)}건")
        pending = [s.title for s in srcs if s.index_status != "indexed"]
        if pending:
            print(
                "\n⚠ 벡터 색인은 아직 없다 — index_status=pending.\n"
                "  임베딩 모델(AGENT_EMBED_MODEL)이 확정돼야 벡터 컬럼을 만들 수 있다\n"
                "  (agent-architecture.md §8 미결 2번). 그때까지 AI 는 이 문서로 답하지 못한다."
            )
        return 0
    finally:
        db.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="청킹만 하고 저장하지 않는다")
    ap.add_argument("--show", metavar="DOC_NO", help="청크 목록 출력 (DB 불필요)")
    ap.add_argument("--search", metavar="TERM", help="적재 확인용 부분일치 조회")
    args = ap.parse_args()

    if args.show:
        return cmd_show(args.show)
    if args.search:
        return cmd_search(args.search)
    return cmd_ingest(args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
