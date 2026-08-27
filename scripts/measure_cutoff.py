"""유사도 하한 컷오프를 **실측한다** — `agent-architecture.md` §3.6.

설계서는 컷오프를 "환각 방지의 1차 방어선" 이라 부르면서 같은 줄에서
**"임계값은 코퍼스 확보 후 실측으로 정한다 — 지금 숫자를 지어내지 않는다"**
고 못박았다. 이 스크립트가 그 실측이다.

방법
    `scripts/evalset.py` 의 10문항을 임베딩해 검색한다. 각 문항은 정답 청크가
    무엇인지 이미 안다(`must_hit`). 그래서 두 분포를 나눌 수 있다.

        정답 유사도  — 검색 결과 중 must_hit 청크의 점수
        오답 유사도  — 그 외 청크의 점수

    좋은 컷오프는 **정답의 최솟값보다 낮고 오답의 상위값보다 높은** 구간에 있다.
    두 분포가 겹치면 겹친다고 말한다. 겹치는데 아무 값이나 고르면 정답을 버리거나
    오답을 통과시킨다.

⚠ 임베딩 호출이 필요하다 — 대외비 문서가 외부로 나가므로 `AGENT_EXTERNAL_EMBED_APPROVED`
  가 있어야 한다. 10문항 + 질문 임베딩이라 비용은 작다.

    .venv/bin/python scripts/measure_cutoff.py
"""
from __future__ import annotations

import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agent import embed, providers, retrieval
from src.db.session import SessionLocal
from scripts.evalset import QUESTIONS

#: 코퍼스가 답할 수 없는 질문. 컷오프가 실제로 막아야 하는 것은 이쪽이다.
#: 앞 세 개는 명백히 무관하고, 뒤 두 개는 **사내 질문이지만 이 문서에 없는 것**이라
#: 유사도가 어중간하게 높다 — 컷오프의 진짜 시험대는 이 두 개다.
OFF_TOPIC: tuple[str, ...] = (
    "오늘 점심 뭐 먹지?",
    "서울 날씨 어때?",
    "파이썬으로 정렬하는 법 알려줘",
    "휴가 언제 쓸 수 있어?",
    "우리 회사 주가 얼마야?",
)


def main() -> int:
    db = SessionLocal()
    try:
        ready, count = retrieval.index_ready(db)
        if not ready:
            print("색인이 비어 있다. scripts/embed_chunks.py 를 먼저 실행하라.")
            return 1
        print(f"색인 {count}청크 · 문항 {len(QUESTIONS)}개\n")

        embedder = providers.get_embeddings()
        right: list[float] = []
        wrong: list[float] = []

        print(f"{'No':>3}  {'정답순위':>6}  {'정답점수':>8}  {'최고오답':>8}  질문")
        print("-" * 78)
        for q in QUESTIONS:
            vector = embedder.embed_query(q.question)
            # 컷오프 실측이 목적이므로 넉넉히 뽑는다
            found = retrieval.search(db, vector, k=20)
            wanted = {h.lower() for _, h in q.must_hit}

            hit_scores, miss_scores, rank = [], [], None
            for i, h in enumerate(found.hits, start=1):
                head = (h.heading or "").lower()
                if any(w in head for w in wanted):
                    hit_scores.append(h.score)
                    rank = rank or i
                else:
                    miss_scores.append(h.score)

            right.extend(hit_scores)
            wrong.extend(miss_scores)
            best_hit = max(hit_scores, default=None)
            best_miss = max(miss_scores, default=None)
            print(
                f"{q.no:>3}  {rank if rank else '—':>6}  "
                f"{best_hit if best_hit is not None else '—':>8}  "
                f"{best_miss if best_miss is not None else '—':>8}  {q.question[:34]}"
            )

        print("-" * 78)
        if not right:
            print("정답 청크가 한 번도 검색되지 않았다. 컷오프 이전에 검색 자체를 봐야 한다.")
            return 1

        lo_right, hi_wrong = min(right), max(wrong) if wrong else 0.0
        print(f"\n정답 유사도  n={len(right):>3}  최소 {lo_right:.4f}  중앙 {statistics.median(right):.4f}")
        print(f"오답 유사도  n={len(wrong):>3}  최대 {hi_wrong:.4f}  중앙 "
              f"{statistics.median(wrong) if wrong else 0:.4f}")

        if lo_right > hi_wrong:
            suggested = round((lo_right + hi_wrong) / 2, 3)
            print(f"\n두 분포가 겹치지 않는다. 권장 컷오프: **{suggested}**")
            print(f"  .env 에  AGENT_SIMILARITY_CUTOFF={suggested}")
            return 0

        print(
            f"\n⚠ 코퍼스 안에서는 두 분포가 겹친다 (정답 최소 {lo_right:.4f} ≤ 오답 최대 {hi_wrong:.4f}).\n"
            "  **컷오프로 코퍼스 내부의 옳고 그름을 가릴 수는 없다.** 같은 문서에서 나온\n"
            "  청크들이라 서로 비슷한 것이 당연하고, 이건 컷오프가 아니라 검색 순위와\n"
            "  LLM·검증기가 맡을 일이다.\n"
            "\n  컷오프가 실제로 하는 일은 **주제 이탈 차단**이다. 그걸 재 본다."
        )

        # ── 주제 이탈 질문 ────────────────────────────────────────────────
        print(f"\n{'최고유사도':>10}  주제 이탈 질문")
        print("-" * 78)
        off_top: list[float] = []
        for q in OFF_TOPIC:
            hits = retrieval.search(db, embedder.embed_query(q), k=5).hits
            top = max((h.score for h in hits), default=0.0)
            off_top.append(top)
            print(f"{top:>10.4f}  {q}")

        worst_off = max(off_top)
        print("-" * 78)
        print(f"\n주제 이탈 최고 {worst_off:.4f}  vs  코퍼스 정답 최소 {lo_right:.4f}")

        if worst_off < lo_right:
            suggested = round((worst_off + lo_right) / 2, 3)
            print(f"\n권장 컷오프: **{suggested}**")
            print("  이 값은 주제 이탈 질문을 막고, 평가셋 정답 청크는 하나도 버리지 않는다.")
        else:
            # 정답을 하나도 버리지 않는 **가장 높은** 값을 고른다.
            # 더 낮추면 막을 수 있던 이탈 질문까지 통과하고, 더 높이면 정답이 잘린다.
            safe = round(lo_right - 0.005, 3)
            blocked = [q for q, s in zip(OFF_TOPIC, off_top) if s < safe]
            passed = [f"{q}({s:.3f})" for q, s in zip(OFF_TOPIC, off_top) if s >= safe]
            print(
                f"\n⚠ 주제 이탈 중 일부가 정답 최소값보다 높다. 완전히 가르는 값은 없다.\n"
                f"\n권장 컷오프: **{safe}** — 정답을 버리지 않는 **가장 높은** 값이다.\n"
                "  더 낮추면 막을 수 있던 이탈 질문까지 통과하고, 더 높이면 정답이 잘린다.\n"
                "  정답 청크를 버리면 답할 수 있는 질문에 '모르겠다' 가 나가고, 그건\n"
                "  사용자가 고칠 방법이 없다. 반대로 이탈이 통과하는 것은 LLM 이\n"
                "  '확인할 수 없습니다' 로 처리하고 V2·V7 검증기가 한 번 더 막는다."
            )
            print(f"\n  차단 {len(blocked)}/{len(OFF_TOPIC)}: {', '.join(blocked) or '없음'}")
            if passed:
                print(f"  통과(막지 못함): {', '.join(passed)}")
        print(f"\n  .env 에  AGENT_SIMILARITY_CUTOFF=<위 값>")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except embed.ExternalTransferBlocked as exc:
        print(f"🔴 차단됨\n\n{exc}")
        sys.exit(2)
    except providers.ProviderUnavailable as exc:
        print(f"제공자를 부를 수 없다: {exc}")
        sys.exit(3)
