"""평가셋 10문항을 **실제 Agent 로** 돌려 채점한다.

`scripts/evalset.py` 가 "정답이 코퍼스에 있다" 까지 확인한다면, 이 스크립트는
**Agent 가 실제로 그 답을 내는가** 를 본다. 둘은 다른 질문이다.

채점 기준 (evalset.py 의 `Q` 가 갖고 있다):
    must_say   답변에 반드시 들어가야 하는 사실 — 하나라도 없으면 미달
    must_not   들어가면 틀린 것 — 하나라도 있으면 실패
    must_hit   검색됐어야 하는 청크 — 인용 라벨로 확인

⚠ 이건 **사람 평가를 대신하지 않는다.** 설계서 §6.8 은 정확도의 유일한 실측
  원천을 `agent_feedback`(👍/👎)으로 못박았다. 이 스크립트는 회귀 감지용이다 —
  모델·프롬프트·청킹을 바꿨을 때 뭐가 깨졌는지 빨리 보려는 것이다.

    .venv/bin/python scripts/run_evalset.py                 # 입고 Agent 로 전부
    .venv/bin/python scripts/run_evalset.py --scope shipping
    .venv/bin/python scripts/run_evalset.py --only 3,7
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.agent import orchestrator
from src.db.session import SessionLocal
from scripts.evalset import QUESTIONS


def grade(q, outcome) -> tuple[str, list[str]]:
    """(판정, 사유). 판정은 pass | partial | fail | blocked."""
    problems: list[str] = []

    if outcome.answer_status != "ok":
        return outcome.answer_status, [f"answer_status={outcome.answer_status}"]

    answer = outcome.answer or ""
    # `a|b` 는 택일이다 — 하나만 들어 있으면 충족
    missing = [f for f in q.must_say if not any(alt in answer for alt in f.split('|'))]
    wrong = [f for f in q.must_not if f in answer]

    labels = " ".join(e.label for e in outcome.evidence)
    unhit = [h for _, h in q.must_hit if h.lower() not in labels.lower()]

    if wrong:
        problems.append(f"오답 문구: {', '.join(wrong)}")
    if missing:
        problems.append(f"누락: {', '.join(missing)}")
    if unhit:
        problems.append(f"근거 미검색: {', '.join(unhit)}")

    if wrong:
        return "fail", problems
    if missing:
        return "partial", problems
    return "pass", problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--scope", default="receiving", choices=("receiving", "shipping"))
    ap.add_argument("--role", default="admin")
    ap.add_argument("--only", help="문항 번호 (쉼표 구분)")
    args = ap.parse_args()

    picked = QUESTIONS
    if args.only:
        wanted = {int(x) for x in args.only.split(",")}
        picked = tuple(q for q in QUESTIONS if q.no in wanted)

    db = SessionLocal()
    tally: dict[str, int] = {}
    try:
        for q in picked:
            outcome = orchestrator.answer(
                db, question=q.question, scope=args.scope, role=args.role
            )
            verdict, problems = grade(q, outcome)
            tally[verdict] = tally.get(verdict, 0) + 1

            mark = {"pass": "✅", "partial": "🟡", "fail": "❌"}.get(verdict, "⚠")
            print(f"\n{mark} [{q.no}] {q.question}")
            print(f"   {outcome.answer_status} · {outcome.total_ms}ms · "
                  f"근거 {len(outcome.evidence)}건 · route={outcome.route}"
                  + (" · 재생성" if outcome.regenerated else ""))
            body = (outcome.answer or "(답변 없음)").replace("\n", "\n   ")
            print(f"   {body[:400]}")
            for p in problems:
                print(f"   ⚠ {p}")
            if outcome.violations:
                print(f"   위반: {outcome.violations}")

        print("\n" + "=" * 70)
        total = sum(tally.values())
        line = " · ".join(f"{k} {v}" for k, v in sorted(tally.items()))
        print(f"{args.scope} Agent — {total}문항: {line}")
        print(
            "\n※ 이 점수는 회귀 감지용이다. FE-RT-42 의 '정확도' 는 이 값이 아니라\n"
            "   agent_feedback(👍/👎) 기반 만족도다 (설계서 §6.8). 지어낸 지표를\n"
            "   화면에 띄우지 않는다."
        )
        return 0 if tally.get("fail", 0) == 0 else 1
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
