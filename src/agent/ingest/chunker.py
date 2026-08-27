"""구조 우선 청킹 — `agent-architecture.md` §3.6.

인용이 "문서 3쪽 어딘가" 가 아니라 **"WS-KS-001 §4.4 다. 작업 순서 및 관리 기준"**
을 가리켜야 한다. 그래서 자르는 기준은 글자 수가 아니라 **제목 경계**다.
글자 수는 상한을 넘길 때만 개입한다.

§3.6 파라미터를 그대로 쓴다:
  목표 400토큰 · 상한 700 · 하한 80(미만은 앞 청크에 병합) · 오버랩 80토큰

**표는 자르지 않는 것을 우선한다.** 관리기준표의 한 행이 헤더와 떨어지면
"관리 기준: 30분" 만 남아 무엇의 30분인지 알 수 없게 된다. 부득이 자를 때는
헤더 행을 다시 붙인다.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from src.agent.ingest.docx_reader import Block, render_table

#: 한국어 문서의 글자→토큰 환산. §3.6 이 "400토큰 ≈ 600~800자" 라 했으므로 1.75 자/토큰.
#: **추정치다.** 실제 토크나이저가 정해지면 `count_tokens` 만 갈아끼운다.
CHARS_PER_TOKEN = 1.75

TARGET_TOKENS = 400
MAX_TOKENS = 700
MIN_TOKENS = 80
OVERLAP_TOKENS = 80

MAX_CHARS = int(MAX_TOKENS * CHARS_PER_TOKEN)      # 1225
MIN_CHARS = int(MIN_TOKENS * CHARS_PER_TOKEN)      # 140
OVERLAP_CHARS = int(OVERLAP_TOKENS * CHARS_PER_TOKEN)  # 140


def count_tokens(text: str) -> int:
    """글자 수 기반 **추정**이다. 컨텍스트 예산 계산용이며 과금 근거가 아니다."""
    return max(1, round(len(text) / CHARS_PER_TOKEN))


@dataclass
class Chunk:
    chunk_index: int
    heading: str
    content: str
    token_count: int = 0
    meta: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.token_count:
            self.token_count = count_tokens(self.content)


# ── 제목 경로 ────────────────────────────────────────────────────────────
def _heading_path(stack: list[tuple[int, str]]) -> str:
    """`제4장 공정별 작업표준 > 4.4  WS-04  배합 > 다. 작업 순서 및 관리 기준`

    200자(`doc_chunks.heading` VARCHAR(200))를 넘으면 **앞쪽 상위 제목부터** 버린다.
    가장 구체적인 꼬리가 인용에서 제일 중요하기 때문이다.
    """
    parts = [re.sub(r"\s+", " ", t).strip() for _, t in stack]
    path = " > ".join(parts)
    while len(path) > 200 and len(parts) > 1:
        parts.pop(0)
        path = " > ".join(parts)
    return path[:200]


# ── 상한 초과 청크 자르기 ────────────────────────────────────────────────
def _split_table(rows: list[list[str]]) -> list[str]:
    """행 경계에서 자르고, 조각마다 헤더 행을 다시 붙인다."""
    if not rows:
        return []
    header = rows[0]
    header_text = " | ".join(header)
    out: list[str] = []
    cur: list[list[str]] = []

    def flush(first: bool) -> None:
        if not cur:
            return
        body = "\n".join(" | ".join(r) for r in cur)
        out.append(body if first else f"{header_text}\n{body}")

    first_piece = True
    cur.append(header)
    for row in rows[1:]:
        line = " | ".join(row)
        cur_len = sum(len(" | ".join(r)) + 1 for r in cur)
        if cur_len + len(line) > MAX_CHARS and len(cur) > 1:
            flush(first_piece)
            first_piece = False
            cur = [row]
        else:
            cur.append(row)
    flush(first_piece)
    # 헤더만 남은 조각은 버린다
    return [p for p in out if p.strip() and p.strip() != header_text]


def _split_text(text: str) -> list[str]:
    """문단(줄) 경계에서 자르고 §3.6 대로 80토큰만큼 겹친다."""
    lines = [ln for ln in text.split("\n") if ln.strip()]
    out: list[str] = []
    cur: list[str] = []
    for line in lines:
        cur_len = sum(len(x) + 1 for x in cur)
        if cur and cur_len + len(line) > MAX_CHARS:
            piece = "\n".join(cur)
            out.append(piece)
            # 오버랩 — 꼬리 몇 줄을 다음 조각 머리로 다시 넣는다
            tail: list[str] = []
            for prev in reversed(cur):
                if sum(len(x) + 1 for x in tail) + len(prev) > OVERLAP_CHARS:
                    break
                tail.insert(0, prev)
            cur = tail + [line]
        else:
            cur.append(line)
    if cur:
        out.append("\n".join(cur))
    return out


# ── 본체 ────────────────────────────────────────────────────────────────
def chunk_blocks(blocks: list[Block], meta_for=None) -> list[Chunk]:
    """제목마다 새 청크를 연다.

    `meta_for(heading_path) -> dict` 를 주면 청크마다 메타를 덧붙인다
    (예: 이 절의 값이 잠정치인지 여부).
    """
    stack: list[tuple[int, str]] = []
    raw: list[tuple[str, list[str]]] = []   # (heading_path, body pieces)

    def open_chunk() -> None:
        raw.append((_heading_path(stack), []))

    for b in blocks:
        if b.kind == "heading":
            while stack and stack[-1][0] >= b.level:
                stack.pop()
            stack.append((b.level, b.text))
            open_chunk()
            continue

        if not raw:
            # 첫 제목 이전의 표지·머리말(문서번호·개정번호·승인란). 제목이 없으므로
            # 가상 제목으로 묶되 **레벨 1** 을 준다 — 레벨 0 으로 두면 실제 `Heading 1`
            # 이 와도 `>= b.level` 에 걸리지 않아 스택 바닥에 영원히 남고,
            # 모든 청크의 인용이 `문서 정보 > …` 로 시작하게 된다.
            stack = [(1, "문서 정보")]
            open_chunk()

        body = raw[-1][1]
        if b.kind == "table":
            rendered = render_table(b.rows)
            if len(rendered) > MAX_CHARS:
                body.extend(_split_table(b.rows))
            else:
                body.append(rendered)
        else:
            body.append(b.text)

    # 본문이 없는 제목(장 표제 등)은 버린다 — 제목 경로에는 이미 반영돼 있다
    filled = [(h, "\n".join(p).strip()) for h, p in raw]
    filled = [(h, t) for h, t in filled if t]

    # 상한 초과 분할
    expanded: list[tuple[str, str]] = []
    for h, text in filled:
        if len(text) <= MAX_CHARS:
            expanded.append((h, text))
        else:
            expanded.extend((h, piece) for piece in _split_text(text))

    # 하한 미만은 **같은 제목의** 앞 청크에만 병합한다.
    # 제목이 다른데 붙이면 인용이 엉뚱한 절을 가리킨다.
    merged: list[tuple[str, str]] = []
    for h, text in expanded:
        if (
            merged
            and len(text) < MIN_CHARS
            and merged[-1][0] == h
            and len(merged[-1][1]) + len(text) <= MAX_CHARS
        ):
            merged[-1] = (h, merged[-1][1] + "\n" + text)
        else:
            merged.append((h, text))

    return [
        Chunk(
            chunk_index=i,
            heading=h,
            content=text,
            meta=(meta_for(h) if meta_for else {}),
        )
        for i, (h, text) in enumerate(merged)
    ]
