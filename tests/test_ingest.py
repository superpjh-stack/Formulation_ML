"""청킹 파이프라인 검증 — `agent-architecture.md` §3.6·§3.7.

여기서 지키려는 것은 두 가지다.
  1. **인용이 절을 가리킨다** — 제목 경로가 정확하고, 서로 다른 절이 한 청크에
     섞이지 않는다. 섞이면 AI 가 A절 근거로 B절 답을 한다.
  2. **표가 헤더와 떨어지지 않는다** — "관리 기준: 30분" 만 남으면 무엇의 30분인지
     알 수 없다.
"""
from __future__ import annotations

import pytest

from src.agent.ingest.chunker import (
    MAX_CHARS,
    MIN_CHARS,
    Chunk,
    chunk_blocks,
    count_tokens,
)
from src.agent.ingest.docx_reader import Block, render_table
from src.agent.ingest.loader import content_hash


def h(level: int, text: str) -> Block:
    return Block(kind="heading", text=text, level=level)


def p(text: str) -> Block:
    return Block(kind="text", text=text)


def tbl(rows: list[list[str]]) -> Block:
    return Block(kind="table", rows=rows)


# ── 제목 경로 ────────────────────────────────────────────────────────────
def test_heading_path_is_hierarchical():
    chunks = chunk_blocks([
        h(1, "제4장  공정별 작업표준"),
        h(2, "4.4  WS-04  배합"),
        h(3, "다. 작업 순서 및 관리 기준"),
        p("본문"),
    ])
    assert len(chunks) == 1
    assert chunks[0].heading == "제4장 공정별 작업표준 > 4.4 WS-04 배합 > 다. 작업 순서 및 관리 기준"


def test_sibling_heading_pops_the_previous_one():
    """`나.` 다음에 `다.` 가 오면 `나.` 는 경로에서 빠져야 한다."""
    chunks = chunk_blocks([
        h(2, "4.4  WS-04  배합"),
        h(3, "나. 사용 설비"),
        p("설비 본문"),
        h(3, "다. 작업 순서"),
        p("순서 본문"),
    ])
    assert [c.heading for c in chunks] == [
        "4.4 WS-04 배합 > 나. 사용 설비",
        "4.4 WS-04 배합 > 다. 작업 순서",
    ]


def test_front_matter_does_not_stick_to_every_chunk():
    """표지(제목 없는 앞머리)가 스택 바닥에 남으면 모든 인용이 오염된다."""
    chunks = chunk_blocks([
        p("주식회사 고려솔더"),
        tbl([["문서번호", "WS-KS-001"]]),
        h(1, "제1장  총칙"),
        p("목적은 …"),
    ])
    assert chunks[0].heading == "문서 정보"
    assert chunks[1].heading == "제1장 총칙"
    assert not chunks[1].heading.startswith("문서 정보")


def test_heading_path_truncates_from_the_front():
    """200자 상한을 넘으면 **상위 제목부터** 버린다 — 꼬리가 인용에 더 중요하다."""
    deep = chunk_blocks([
        h(1, "가" * 150),
        h(2, "나" * 150),
        h(3, "다. 작업 순서"),
        p("본문"),
    ])[0]
    assert len(deep.heading) <= 200
    assert deep.heading.endswith("다. 작업 순서")


def test_empty_heading_produces_no_chunk():
    """장 표제처럼 본문 없는 제목은 청크가 되지 않는다 (경로에는 남는다)."""
    chunks = chunk_blocks([
        h(1, "제4장  공정별 작업표준"),
        h(2, "4.1  WS-01  원료 입고"),
        p("본문"),
    ])
    assert len(chunks) == 1
    assert chunks[0].heading.startswith("제4장")


# ── 표 ──────────────────────────────────────────────────────────────────
def test_table_follows_its_heading():
    """`Document.tables` 를 따로 읽으면 이 관계가 끊긴다."""
    chunks = chunk_blocks([
        h(2, "다. 작업 순서 및 관리 기준"),
        tbl([["순서", "작업", "관리 기준"], ["7", "교반", "3분 이상"]]),
    ])
    assert len(chunks) == 1
    assert "3분 이상" in chunks[0].content
    assert "관리 기준" in chunks[0].content


def test_oversized_table_repeats_header_on_each_piece():
    rows = [["순서", "작업 내용", "관리 기준"]]
    rows += [[str(i), f"작업 {i} " + "가" * 200, f"기준 {i}"] for i in range(1, 30)]
    chunks = chunk_blocks([h(2, "다. 작업 순서"), tbl(rows)])
    assert len(chunks) > 1, "상한을 넘겼는데 쪼개지지 않았다"
    for c in chunks:
        assert "순서 | 작업 내용 | 관리 기준" in c.content
        assert len(c.content) <= MAX_CHARS


def test_render_table_does_not_repeat_header_per_row():
    """행마다 헤더를 붙이면 같은 문구가 반복돼 검색 점수가 왜곡된다."""
    out = render_table([["A", "B"], ["1", "2"], ["3", "4"]])
    assert out.count("A | B") == 1


# ── 크기 규약 (§3.6) ─────────────────────────────────────────────────────
def test_no_chunk_exceeds_the_cap():
    chunks = chunk_blocks([h(2, "절"), p("가" * 400)] + [p("나" * 400) for _ in range(10)])
    assert chunks
    assert all(len(c.content) <= MAX_CHARS for c in chunks)


def test_split_text_overlaps_so_evidence_is_not_halved():
    lines = [f"{i}번 문단 " + "가" * 100 for i in range(40)]
    chunks = chunk_blocks([h(2, "절")] + [p(x) for x in lines])
    assert len(chunks) > 1
    joined = [c.content for c in chunks]
    tail_of_first = joined[0].split("\n")[-1]
    assert tail_of_first in joined[1], "오버랩이 없어 경계 문단이 한쪽에만 남았다"


def test_short_chunk_merges_only_within_the_same_heading():
    """제목이 다른데 병합하면 인용이 엉뚱한 절을 가리킨다."""
    chunks = chunk_blocks([
        h(2, "가. 짧은 절"),
        p("짧다."),
        h(2, "나. 다른 절"),
        p("여기도 짧다."),
    ])
    assert len(chunks) == 2
    assert chunks[0].content == "짧다."


def test_min_chars_is_below_max():
    assert 0 < MIN_CHARS < MAX_CHARS


# ── 토큰 추정 ────────────────────────────────────────────────────────────
def test_token_count_is_set_and_positive():
    c = Chunk(chunk_index=0, heading="절", content="가나다라마바사")
    assert c.token_count >= 1


def test_count_tokens_never_returns_zero_for_nonempty():
    assert count_tokens("가") >= 1


# ── 해시 (§3.7 정합성 점검) ──────────────────────────────────────────────
def test_hash_changes_when_only_the_heading_changes():
    """인용 라벨이 제목에서 나오므로 제목만 바뀐 개정도 재색인 대상이다."""
    a = [Chunk(0, "가. 목적", "같은 본문")]
    b = [Chunk(0, "가. 목적 및 적용범위", "같은 본문")]
    assert content_hash(a) != content_hash(b)


def test_hash_is_stable_for_identical_input():
    a = [Chunk(0, "가", "본문"), Chunk(1, "나", "본문2")]
    b = [Chunk(0, "가", "본문"), Chunk(1, "나", "본문2")]
    assert content_hash(a) == content_hash(b)


def test_hash_detects_reordering():
    a = [Chunk(0, "가", "A"), Chunk(1, "나", "B")]
    b = [Chunk(0, "나", "B"), Chunk(1, "가", "A")]
    assert content_hash(a) != content_hash(b)


# ── 적재 방어 ────────────────────────────────────────────────────────────
def test_load_source_rejects_unknown_scope():
    from src.agent.ingest.loader import load_source

    with pytest.raises(ValueError, match="scope"):
        load_source(
            None, source_type="file", source_key="k", title="t",
            version=1, chunks=[Chunk(0, "가", "본문")], scope="quality",
        )


def test_load_source_refuses_empty_chunks():
    """청크 0건을 조용히 적재하면 코퍼스가 빈 채로 '완료' 가 된다."""
    from src.agent.ingest.loader import load_source

    with pytest.raises(ValueError, match="청크가 0건"):
        load_source(
            None, source_type="file", source_key="k", title="t",
            version=1, chunks=[], scope="common",
        )
