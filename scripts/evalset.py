"""현장 문서 2종으로 답할 수 있는 질문 10개 — RAG 평가셋.

이건 질문 목록이 아니라 **채점표**다. 설계서 §3.6 이 검색 하한 컷오프를
"코퍼스 확보 후 실측으로 정한다 — 지금 숫자를 지어내지 않는다" 로 남겨 뒀고,
§6.8 은 `agent_feedback` 을 "정확도의 유일한 실측 원천" 이라 못박았다.
그 실측을 하려면 **정답을 아는 질문**이 먼저 있어야 한다.

각 항목은 세 가지를 갖는다.
    must_hit   이 질문에 답하려면 반드시 검색돼야 하는 청크(제목으로 지정)
    must_say   답변에 반드시 들어가야 하는 사실. `a|b` 는 **택일**이다
    must_not   답변에 들어가면 **틀린** 것 (환각·혼동 유발 값)

`--check` 는 `must_hit` 청크가 실제로 존재하고 그 안에 `must_say` 가 들어 있는지
DB 로 확인한다. **질문을 지어내지 않았다는 증명**이다. 검색 정확도 측정이 아니다 —
그건 임베딩이 붙은 뒤에 한다.

    .venv/bin/python scripts/evalset.py            # 질문지 출력 (현장 배포용)
    .venv/bin/python scripts/evalset.py --check    # 정답이 코퍼스에 있는지 검증
    .venv/bin/python scripts/evalset.py --answers  # 정답까지 출력 (채점용)
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from src.db.models import DocChunk, DocSource
from src.db.session import SessionLocal

WS = "작업표준서 WS-KS-001 Rev.0"
QS = "품질기준서 QS-KS-001 Rev.0"


@dataclass(frozen=True)
class Q:
    no: int
    kind: str            # lookup | table | compute | multi | cross | negative
    question: str
    must_hit: tuple[tuple[str, str], ...]   # (문서, 제목에 포함될 문구)
    must_say: tuple[str, ...]
    answer: str
    must_not: tuple[str, ...] = ()
    note: str = ""
    #: `any` = 두 화면 모두에서 답할 수 있어야 한다 (문서 근거는 scope=common).
    #: `shipping`·`receiving` = 그 화면의 **도구**를 써야 답할 수 있는 질문.
    scope: str = "any"
    #: 이 문항이 호출해야 하는 도구. 비어 있으면 도구 없이 문서로만 답해도 된다.
    #: 🔴 도구 기대치가 있는데 route 가 rag 면, 답이 맞아도 **그 도구는 미검증**이다.
    must_call: tuple[str, ...] = ()
    #: 네거티브 문항 — 이 문구가 코퍼스에 **없어야** 정답이 "모른다" 가 된다
    absent_from_corpus: tuple[str, ...] = field(default=())


QUESTIONS: tuple[Q, ...] = (
    Q(
        no=1,
        kind="lookup",
        question="SAC305 의 Ag 규격이 몇 % 야?",
        must_hit=((QS, "3.3 합금 성분 규격"),),
        must_say=("2.8", "3.2"),
        answer="Ag 2.8 ~ 3.2 % 다. Cu 는 0.4 ~ 0.6 %, Sn 은 잔부다. (QS-KS-001 [표 3-3])",
        must_not=("3.0 ± 0.3",),
        note="가장 기본. 여기서 틀리면 나머지는 볼 필요가 없다.",
    ),
    Q(
        no=2,
        kind="lookup",
        question="무연 제품 납 상한이 얼마야?",
        must_hit=((QS, "3.3 합금 성분 규격"),),
        must_say=("0.07", "0.1", "RoHS"),
        answer=(
            "두 개를 구분해서 답해야 한다. 법규(RoHS) 기준은 Pb ≤ 0.1 질량%(1,000 ppm) "
            "이고, 당사 사내 기준은 Pb ≤ 0.07 질량%(700 ppm) 다. 사내 기준이 법규 대비 "
            "30 % 여유를 둔 값이다. (QS-KS-001 §3.3)"
        ),
        note="한 청크에 값이 두 개다. 하나만 말하면 반쪽이다 — 사내 기준을 놓치면 위험하다.",
    ),
    Q(
        no=3,
        kind="lookup",
        question="용해할 때 몇 분이나 유지해야 해?",
        must_hit=((WS, "4.2 WS-02 용해 > 다."),),
        must_say=("15분 이상",),
        answer=(
            "설정 온도에서 15분 이상 유지한다. 성분 균질화가 목적이다. "
            "다만 이 값은 [현장확정] 잠정치이고, 성분 산포 실험으로 최소 시간을 정해 "
            "Rev.1 에서 확정한다. (WS-KS-001 WS-02 7단계 · 제10장 표 10-1)"
        ),
        note="잠정치를 확정값처럼 말하면 감점. 원문의 [현장확정] 표시를 살려야 한다.",
    ),
    Q(
        no=4,
        kind="lookup",
        question="배합 편차가 규격 폭 50 % 를 넘었어. 어떻게 해?",
        must_hit=((WS, "4.4 WS-04 배합 > 라."),),
        must_say=("재용해", "품질보증팀장"),
        answer=(
            "원료 LOT별 실측값과 계량 기록을 역검산한다. 원인이 확인되지 않으면 전량 "
            "재용해한다. 보고 대상은 품질보증팀장이다. 추정 원인은 원료 성분 오등록, "
            "계량 오차, 과도한 산화 손실, 잔탕 혼입이다. (WS-KS-001 WS-04 라)"
        ),
        note="조치와 보고 대상을 함께 말해야 실무에서 쓸 수 있다.",
    ),
    Q(
        no=5,
        kind="table",
        question="LOT 번호 B-637-260827-2-01 이 무슨 뜻이야?",
        must_hit=((QS, "7.1 LOT 번호 체계"),),
        must_say=("솔더바", "637", "용해"),
        answer=(
            "B = 솔더바, 637 = Sn63Pb37, 260827 = 2026년 8월 27일, 2 = 2호 용해로, "
            "01 = 당일 1번째 배치다. 생산 일자는 **용해 개시일** 기준이며 주조일이 아니다. "
            "(QS-KS-001 [표 7-1])"
        ),
        must_not=("주조일",),
        note="5개 자리를 모두 풀어야 한다. '용해 개시일(주조일 아님)' 을 놓치면 감점.",
    ),
    Q(
        no=6,
        kind="lookup",
        question="XRF 시업 전에 뭘 확인해야 하고, 합격 기준이 뭐야?",
        must_hit=((QS, "6.3 XRF 일상 정도관리"),),
        must_say=("CRM", "0.2", "0.05"),
        answer=(
            "합금 계열별 CRM(유연용·무연용 각 1종)을 각 3회 반복 측정한다. 판정은 "
            "3회 평균이 인증값 ±0.2 % 이내이고 3회 반복 표준편차가 0.05 % 이하일 것. "
            "측정값은 X-R 관리도에 기입하고, 연속 7점이 중심선 한쪽에 몰리면 이상 "
            "징후로 보아 점검을 의뢰한다. (QS-KS-001 §6.3)"
        ),
        note="두 개의 판정 조건이 AND 다. 하나만 말하면 틀린 답이다.",
    ),
    Q(
        no=7,
        kind="compute",
        question=(
            "유연 배치 500 kg 인데 Sn 이 62.30 % 나왔어. 63.00 % 로 맞추려면 "
            "순 Sn 을 몇 kg 넣어야 해?"
        ),
        must_hit=((WS, "부속서 B"),),
        # `|` 는 **택일**이다 — 하나만 있으면 통과. 문서가 "재측정"·"재채취"·"재확인"
        # 을 섞어 쓰므로 한 단어만 요구하면 맞는 답을 틀렸다고 채점한다.
        must_say=("9.46", "재측정|재채취|재확인"),
        answer=(
            "약 9.46 kg 이다. x = W₀ × (Cₜ − C₀) ÷ (100 − Cₜ) = 500 × 0.70 ÷ 37.00. "
            "투입 후 교반 3분 + 유지 5분 뒤 시료를 재채취해 XRF 재측정으로 확인한다. "
            "계산만으로 합격 판정을 내리는 것은 금지다. (WS-KS-001 부속서 B.3·B.4)"
        ),
        # `must_not` 을 두지 않는다. 원래 "계산만으로 합격" 을 금칙으로 뒀는데,
        # 문서 자체가 "계산만으로 합격 판정을 내리는 것은 금지" 라는 문장을 갖고 있어
        # **금지를 올바로 인용한 답변이 오답으로 채점됐다** (실측 2026-08-27).
        # 부분 문자열로는 주장과 인용을 구분할 수 없다. 재측정 요구는 `must_say` 로 본다.
        note="문서의 계산 예시와 같은 조건이다. 숫자만 맞고 '재측정 필수' 를 빼면 위험한 답이다.",
    ),
    Q(
        no=8,
        kind="multi",
        question="치명결함이 나왔어. 어떻게 처리하고 작업 재개는 누가 승인해?",
        must_hit=(
            (WS, "4.7 WS-07 검사 · 포장 > 라."),
            (WS, "5.2 작업 재개 조건"),
        ),
        must_say=("격리", "품질보증팀장", "대표이사", "QR-701"),
        answer=(
            "LOT 전량을 불합격 처리하고 격리한다. 전후 LOT 을 전개 확인한 뒤 시정조치 "
            "요구서를 발행한다. 작업 재개는 품질보증팀장 + 대표이사 승인이 필요하고, "
            "시정조치 요구서(QR-701) 발행이 선행 조건이다. "
            "(WS-KS-001 WS-07 라 · [표 5-2])"
        ),
        note="서로 다른 두 절을 합쳐야 답이 된다. 청크 하나만 집으면 반쪽 답이 나온다.",
    ),
    Q(
        no=9,
        kind="table",
        question="XRF 성분분석 기록은 몇 년 보관해?",
        must_hit=((QS, "8.1 품질기록"),),
        must_say=("QR-202", "5년"),
        answer=(
            "QR-202 성분분석(XRF) 기록은 5년 보존하며 보관 형태는 전자(원본 데이터 포함)다. "
            "고객이 계약으로 더 긴 보존기간을 요구하면 그에 따른다. (QS-KS-001 [표 8-1])"
        ),
        must_not=("3년",),
        note="같은 표에 3년짜리가 여럿이라 행을 잘못 집기 쉽다.",
    ),
    Q(
        no=10,
        kind="negative",
        question="품질 점수 70점 넘으면 합격이야?",
        must_hit=((QS, "5.1 합부 판정 기준"),),
        must_say=("치명결함", "규격"),
        answer=(
            "두 문서에는 **품질 점수라는 개념 자체가 없다.** QS-KS-001 §5.1 의 합격은 "
            "성분·치수·외관·중량 전 항목이 규격 이내이고 치명결함이 0개일 것이다. "
            "판정 구분은 합격 / 조건부 합격(특채) / 불합격 / 보류 네 가지다. "
            "70점은 시스템이 ML 로 예측한 참고 지표이며 합부 판정이 아니다."
        ),
        must_not=("70점 이상이 합격",),
        absent_from_corpus=("품질 점수", "합격선"),
        note=(
            "🔴 가장 중요한 문항. 시스템 화면에는 70점이 '품질' 로 표시되지만 현장 "
            "기준과 다른 것이다. AI 가 화면 값을 근거로 '합격' 이라 답하면 출하 사고가 "
            "된다. CR-STD-001 1번 항목."
        ),
    ),
)


#: 출하 Agent 고유 문항 — **도구를 써야만 답할 수 있는 것들**.
#:
#: 위 10문항은 전부 문서 질문이라 출하 화면에서 돌려도 `route=rag` 가 나온다.
#: 답은 맞지만 출하 도구 6개는 **한 번도 실행되지 않는다.** 문서 검색이 출하
#: 화면에서도 되는지만 확인한 셈이라, 출하 Agent 를 시험한 것이 아니다.
#:
#: 정답은 2026-08-27 DB 실측이다. 시드를 다시 만들면 값이 바뀐다 —
#: `--check` 가 그때 실패해서 알려준다.
SHIPPING_QUESTIONS: tuple[Q, ...] = (
    Q(
        no=21,
        kind="data",
        scope="shipping",
        question="신성마이크로에 최근 30일 동안 얼마나 출하했어?",
        must_hit=(),
        must_call=("shipment_history",),
        must_say=("신성마이크로",),
        answer="27건 · 약 12,893 kg (2026-07-27 ~ 2026-08-26 기준)",
        note="도구 인자(기간·고객사)를 LLM 이 제대로 뽑는지 본다.",
    ),
    Q(
        no=22,
        kind="data",
        scope="shipping",
        question="LOT-2024-011 품질 점수가 몇 점이야?",
        must_hit=(),
        must_call=("lot_quality_summary",),
        must_say=("61.9",),
        answer=(
            "61.94점이다. 시스템 기준선 70점 미만이라 fail 로 분류돼 있다. "
            "다만 이 점수는 ML 예측값이며 LOT 합부 판정이 아니다 — 합부는 "
            "QS-KS-001 §5.1 이 정한다."
        ),
        must_not=("불합격입니다", "합격입니다"),
        note="🔴 점수를 근거로 합부를 단정하면 V6 가 막아야 한다.",
    ),
    Q(
        no=23,
        kind="data",
        scope="shipping",
        question="전체 기간 기준으로 분석중 상태인 클레임이 몇 건이야?",
        must_hit=(),
        must_call=("claim_search",),
        # `27` 만 요구했더니 답변의 날짜 `2026-08-27` 에 걸려 **오답이 통과했다**
        # (실측: 43건인데 14건이라고 답했는데도 pass). 건수 표기로 못박는다.
        must_say=("43건",),
        answer="분석중(analyzing) 43건, 접수(open) 27건이다. 종결은 resolved 113 · rejected 17 건.",
        note=(
            "🔴 이 문항이 조용한 잘림을 잡아냈다. 도구는 43건을 냈는데 "
            "오케스트레이터가 결과를 2,500자에서 자르는 바람에 meta.row_count 가 "
            "사라졌고, LLM 이 보이는 행만 세서 14건이라 답했다.\n"
            "질문에 '전체 기간' 을 넣은 이유: claim_search 는 기간이 필수 인자라 "
            "'지금 처리 중인' 처럼 기간이 없으면 LLM 이 매번 다른 범위를 잡는다 "
            "(전체 43건 / 올해 27건). 답변이 쓴 기간을 밝히므로 둘 다 정직한 답이지만 "
            "회귀 테스트로는 값이 흔들려 쓸 수 없다."
        ),
    ),
    Q(
        no=24,
        kind="data",
        scope="shipping",
        question="LOT-2024-011 이력 전체를 추적해줘",
        must_hit=(),
        must_call=("lot_trace_full",),
        must_say=("SUP_A",),
        answer="공급사 SUP_A. 출하 이력 0건, 클레임 2건이 붙어 있다.",
        note="출하 0건을 '없음' 으로 말해야 한다 — 조회 실패와 구분돼야 한다.",
    ),
    Q(
        no=25,
        kind="negative",
        scope="shipping",
        question="납기 임박한 출하 건 알려줘",
        must_hit=(),
        # `shipment_due_risk` 는 always_unanswerable 이다. 불러도 되고 안 불러도
        # 되지만, **답을 지어내면 안 된다.**
        must_say=("없|확인할 수 없|알 수 없|불가",),
        answer=(
            "답할 수 없다. `shipments` 에 **납기일 컬럼이 없다.** 출하일자만 있고 "
            "약속된 납기가 저장되지 않으므로 임박·지연을 계산할 근거가 없다."
        ),
        # `must_not` 을 두지 않는다. 진짜 실패는 "임박 건이 N건" 처럼 **숫자를
        # 지어내는 것**인데, 부분 문자열로는 그 패턴을 표현할 수 없다. 어구
        # 접두사("납기 임박 건은 ")로 잡으려 했더니 표현이 조금만 달라져도
        # 엉뚱하게 걸려 **맞는 답이 오답으로 채점됐다** (실측 2026-08-27).
        # 게이트는 must_say 가 맡는다 — 없다고 말하지 않으면 미달이다.
        note=(
            "🔴 원천이 없는 질문이다. 숫자를 하나라도 내놓으면 그게 답으로 읽힌다 "
            "(§C-2.3). 없다고 말하는 것이 정답이다. "
            "숫자 조작 여부는 사람이 확인한다 — 부분 문자열 채점의 한계다."
        ),
    ),
)


# ── 검증 ────────────────────────────────────────────────────────────────
def cmd_check() -> int:
    db = SessionLocal()
    try:
        rows = db.execute(
            select(DocSource.title, DocChunk.heading, DocChunk.content)
            .join(DocChunk, DocChunk.source_id == DocSource.id)
        ).all()
        if not rows:
            print("코퍼스가 비어 있다. scripts/ingest_docs.py 를 먼저 실행하라.")
            return 1

        corpus = "\n".join(c for _, _, c in rows)
        failures: list[str] = []

        print(f"{'No':>3} {'유형':<9} 결과")
        print("-" * 70)
        for q in QUESTIONS + SHIPPING_QUESTIONS:
            problems: list[str] = []

            # 1) must_hit 청크가 실재하는가
            hit_texts: list[str] = []
            for doc, heading_part in q.must_hit:
                matched = [
                    c for t, h, c in rows
                    if t == doc and h and heading_part in h
                ]
                if not matched:
                    problems.append(f"청크 없음: {doc} · '{heading_part}'")
                hit_texts.extend(matched)

            # 2) 정답 근거가 그 청크 안에 있는가
            #
            # `must_hit` 이 비어 있으면 **DB 근거 문항**이다 (출하 실적·클레임 건수 등).
            # 정답이 코퍼스가 아니라 테이블에 있으므로 여기서 대조하지 않는다.
            # 그 값들의 정합은 도구 자체의 테스트가 본다.
            if q.must_hit:
                joined = "\n".join(hit_texts)
                for fact in q.must_say:
                    # `a|b` 는 택일 — 하나만 있으면 충족 (run_evalset 채점과 같은 규칙)
                    if not any(alt in joined for alt in fact.split("|")):
                        problems.append(f"근거 없음: '{fact}' 가 지정 청크에 없다")

            # 3) 네거티브 문항 — 코퍼스에 정말 없는가
            for term in q.absent_from_corpus:
                if term in corpus:
                    problems.append(f"네거티브 깨짐: '{term}' 이 코퍼스에 실재한다")

            mark = "✅" if not problems else "❌"
            tag = f"{q.scope[:4]}/{q.kind}" if q.scope != "any" else q.kind
            print(f"{q.no:>3} {tag:<14} {mark} {q.question[:40]}")
            for p in problems:
                print(f"        · {p}")
                failures.append(f"Q{q.no}: {p}")

        print("-" * 70)
        if failures:
            print(f"❌ {len(failures)}건 실패 — 코퍼스에 없는 것을 묻고 있다.")
            return 1
        n_doc = sum(1 for q in QUESTIONS + SHIPPING_QUESTIONS if q.must_hit)
        n_db = len(QUESTIONS) + len(SHIPPING_QUESTIONS) - n_doc
        print(f"✅ {n_doc + n_db}문항 — 문서 근거 {n_doc} · DB 근거 {n_db}")
        print("\n※ 이건 '정답이 코퍼스에 있다' 는 확인이다.")
        print("   검색이 그 청크를 실제로 집어오는지는 임베딩을 붙인 뒤 측정한다 (§3.6).")
        return 0
    finally:
        db.close()


def cmd_print(with_answers: bool) -> int:
    kinds = {
        "lookup": "단일 조회", "table": "표 조회", "compute": "계산",
        "multi": "복수 절 종합", "negative": "함정 — 문서에 없는 개념",
    }
    print("# 현장 문서 2종으로 답할 수 있는 질문 10개\n")
    print("대상: 작업표준서 WS-KS-001 Rev.0 · 품질기준서 QS-KS-001 Rev.0\n")
    for q in QUESTIONS + SHIPPING_QUESTIONS:
        print(f"## {q.no}. {q.question}")
        print(f"\n- 유형: {kinds.get(q.kind, q.kind)}")
        print(f"- 근거: {' + '.join(f'{d.split()[0]} {h}' for d, h in q.must_hit)}")
        if with_answers:
            print(f"\n**정답**\n\n{q.answer}\n")
            if q.must_not:
                print(f"- 이렇게 답하면 오답: {' · '.join(q.must_not)}")
            if q.note:
                print(f"- 채점 메모: {q.note}")
        print()
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="정답이 코퍼스에 있는지 DB 로 검증")
    ap.add_argument("--answers", action="store_true", help="정답·채점 메모까지 출력")
    args = ap.parse_args()
    if args.check:
        return cmd_check()
    return cmd_print(args.answers)


if __name__ == "__main__":
    sys.exit(main())
