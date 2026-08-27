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
        else:
            print(
                f"\n⚠ 두 분포가 겹친다 (정답 최소 {lo_right:.4f} ≤ 오답 최대 {hi_wrong:.4f}).\n"
                "  어떤 값을 골라도 정답을 버리거나 오답을 통과시킨다.\n"
                "  컷오프로 해결할 문제가 아니다 — 청킹이나 임베딩 모델을 먼저 본다.\n"
                f"  굳이 건다면 정답 최소값보다 낮게: {round(lo_right - 0.02, 3)}"
            )
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
