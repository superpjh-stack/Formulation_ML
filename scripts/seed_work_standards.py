"""확정된 기준값을 작업 표준 문서로 등록한다 (RAG 코퍼스 초기 적재).

`master_codes.group_code='WORK_STD'` 39행 중 실제 본문(`content`)이 있는 것은
**1행뿐**이었다. AI Agent 가 "SAC305 배합 온도가 몇 도야?" 같은 질문에 답하려면
본문이 있어야 한다.

── 무엇을 넣고 무엇을 넣지 않는가 ────────────────────────────────────────────

**넣는 것**: 이미 **계약으로 확정되어 시스템이 강제하고 있는 값**만 넣는다.
전부 `system_settings` · `app.py:API_BOUNDS` · `goal.md` 2.3 에서 실측한 것이고,
아래 `_verify()` 가 등록 직전에 DB 와 대조한다. **지어내는 것이 아니라
여러 곳에 흩어진 정본을 사람이 읽을 문서로 모으는 일이다.**

**넣지 않는 것**:
  · 프로젝트 산출물(`docs/산출물/` 16종) — 요구사항정의서·설계서는 **현장 지식이 아니다.**
    "자재 입고 기준이 뭐야" 에 설계서 문장을 근거로 답하면 그럴듯하지만 틀린 답이 된다
    (`agent-architecture.md` §3.4 D1)
  · 승인요청서·안내문 등 관리 문서 — 같은 이유
  · **실제 현장 운전 방식** — 이건 제조팀만 안다. 이 스크립트가 지어내면 안 된다.
    아래 문서들은 "시스템이 강제하는 기준" 이지 "현장이 실제로 하는 방법" 이 아니며,
    각 본문 말미에 그 사실을 명시한다

── v2 개정 (2026-08-27) ──────────────────────────────────────────────────────

현장 문서 **WS-KS-001 작업표준서 · QS-KS-001 품질기준서**가 들어오면서(`scripts/
ingest_docs.py`) v1 본문이 **오답을 유발할 수 있음**이 드러났다. 세 군데다.

  1. v1 은 "품질 합격선은 70점" 이라 적었다. QS-KS-001 §5.1 의 LOT 합부 판정에는
     **점수 개념이 아예 없다** — 규격 이내 + 치명결함 0 이다. 70점은 ML 이 예측한
     시스템 내부 점수일 뿐인데 v1 은 그걸 합격 판정처럼 말했다.
  2. v1 은 "성분 목표값 Sn 62.0 / Ag 3.0 / Cu 0.5" 를 제품 규격처럼 적었다.
     QS-KS-001 [표 3-3] 의 SAC305 는 Sn 잔부 / Ag 2.8~3.2 / Cu 0.4~0.6 이고
     [표 3-2] 의 Sn63Pb37 은 Sn 62.5~63.5 / Pb 잔부다. **어느 쪽과도 다르다.**
     62.0/3.0/0.5 는 편차 계산 기준선이지 생산 가능한 합금이 아니다.
  3. 온도 경고 255°C 가 WS-02 의 용해로 조업 온도(유연 340±20 / 무연 400±20)와
     **맞지 않는다.** 그대로 두면 정상 조업 중인 용해로가 계속 경고로 뜬다.
     이건 코드로 고칠 문제가 아니라 생산팀·품질보증팀이 정할 문제라서,
     값을 바꾸지 않고 **미해결이라고 본문에 적었다.**

그래서 v2 는 모든 수치에 **"이건 시스템 설정값이고 정본은 저 문서다"** 를 붙인다.

실행:
    .venv/bin/python scripts/seed_work_standards.py            # 등록
    .venv/bin/python scripts/seed_work_standards.py --dry-run  # 확인만

멱등하다 — 같은 `code` 가 이미 있으면 본문이 달라졌을 때만 버전을 올린다.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from src.db.session import SessionLocal

AUTHOR = "시스템 (확정 기준값 자동 정리)"

#: 등록 전 DB 와 대조할 값. 어긋나면 등록을 중단한다.
EXPECTED = {
    "ml.sn_target": "62.0",
    "ml.ag_target": "3.0",
    "ml.cu_target": "0.5",
    "quality.pass_score": "70",
    "quality.warn_score": "80",
    "equipment.temp_warn_c": "255.0",
    "deviation.warn_sn": "2.0",
    "deviation.warn_ag": "0.3",
    "deviation.warn_cu": "0.1",
}

DISCLAIMER = (
    "\n\n※ 이 문서는 **시스템이 강제하는 설정값**을 정리한 것이다. 제품 규격과 판정 "
    "기준의 정본은 품질기준서 QS-KS-001, 작업 순서와 조업 조건의 정본은 작업표준서 "
    "WS-KS-001 이다. 두 문서와 이 문서가 다르면 **두 문서가 옳다.**"
)

STANDARDS: list[dict] = [
    {
        "code": "STD-COMP-001",
        "name": "시스템 성분 기준값 및 편차 계산 기준",
        "content": (
            "1. 시스템의 성분 기준값은 Sn 62.0% / Ag 3.0% / Cu 0.5% 다.\n"
            "2. 이 값은 **편차를 계산하기 위한 기준선이지 제품 성분 규격이 아니다.**\n"
            "   제품 성분 규격은 QS-KS-001 [표 3-2](유연)·[표 3-3](무연)이 정한다.\n"
            "   예를 들어 SAC305 는 Sn 잔부 / Ag 2.8~3.2 / Cu 0.4~0.6 이고,\n"
            "   Sn63Pb37 은 Sn 62.5~63.5 / Pb 잔부다. 위 기준값과 다르다.\n"
            "3. Pb 는 입력하지 않는다. 100 − Sn − Ag − Cu 로 자동 계산된다.\n"
            "4. 성분 편차는 XRF 측정값을 등록하는 순간 기준값 대비로 자동 계산된다.\n"
            "5. 편차 경고 임계는 Sn ±2.0% / Ag ±0.3% / Cu ±0.1% 다.\n"
            "6. 편차는 상대 비율(%)이 아니라 기준값과의 절대 차이다.\n"
            "7. 배합 공정의 편차는 이것과 다른 값이다. WS-KS-001 부속서 B 는 배합 편차를\n"
            "   「실측 평균값 − 배합 이론값」으로 정의하고, 관리 한계를 규격 폭의 50% 로 둔다."
        ),
    },
    {
        "code": "STD-QUAL-001",
        "name": "시스템 품질 점수 기준",
        "content": (
            "1. 시스템의 품질 점수 기준선은 70점이다. 70점 이상을 pass 로 본다.\n"
            "2. 이 점수는 **ML 모델이 예측한 값이며, LOT 합부 판정이 아니다.**\n"
            "   LOT 의 실제 합부는 QS-KS-001 §5.1 이 정한다. 그 기준은 점수가 아니라\n"
            "   성분·치수·외관·중량 전 항목이 규격 이내이고 치명결함이 0개일 것이다.\n"
            "   불합격은 치명결함 1개 이상, 성분 3점 중 1점 이상 규격 이탈,\n"
            "   불순물 상한 초과, 샘플링 Re 수 이상 부적합 중 하나에 해당할 때다.\n"
            "3. QS-KS-001 의 판정 구분은 합격 / 조건부 합격(특채) / 불합격 / 보류 네 가지다.\n"
            "   시스템의 pass / warning / fail 세 가지와 1:1 대응하지 않는다.\n"
            "4. 시스템 화면의 점수만 보고 출하 가부를 판단하지 않는다. 검사성적서를 따른다.\n"
            "5. 점수 구간은 80점 이상 pass, 70점 이상 80점 미만 warning, 70점 미만 fail 이다.\n"
            "6. 69.9점과 70.0점은 다르게 판정된다. 반올림하지 않는다.\n"
            "7. 기준선은 시스템 설정에서 바꿀 수 있으며, 바꿔도 과거 판정은 다시 계산되지 않는다."
        ),
    },
    {
        "code": "STD-MIX-001",
        "name": "배합비율 입력 및 최적화 탐색 범위",
        "content": (
            "1. 배합 성분 합계는 정확히 100.0% 여야 한다. 합계가 맞지 않으면 예측이 실행되지 않는다.\n"
            "2. 최적화 탐색 범위는 Sn 55~70% / Ag 1~5% / Cu 0.1~1.5% / Pb 25~45% 다.\n"
            "3. 이 범위는 **최적화 알고리즘이 탐색하는 구간이지 생산 가능한 합금 규격이 아니다.**\n"
            "   생산 합금과 그 성분 규격은 QS-KS-001 [표 3-2]·[표 3-3]을 따른다.\n"
            "   특히 QS-KS-001 §3.3 은 유연 라인과 무연 라인의 설비·기구 분리 운용을\n"
            "   의무화하고 교차 사용을 금지한다. 무연 제품의 사내 Pb 상한은 0.07% 다.\n"
            "4. 범위를 벗어난 배합은 품질 예측과 최적화 요청을 모두 거부한다.\n"
            "5. 최적화 모델 선택 목록에 Ridge 는 없다. 선형 모델은 최적점이 항상\n"
            "   탐색 범위의 끝으로 몰려 추천이 무의미해지기 때문이다.\n"
            "6. 실제 보정 투입량은 WS-KS-001 부속서 B.3 계산식으로 구한다.\n"
            "   보정 후에는 반드시 XRF 재측정으로 확인한다. 계산만으로 합격 판정은 금지다."
        ),
    },
    {
        "code": "STD-EQUIP-001",
        "name": "설비 온도 감시 기준",
        "content": (
            "1. 시스템의 설비 온도 경고선은 255°C 다. 초과 시 온도 경고로 표시된다.\n"
            "2. ⚠ **이 값은 WS-KS-001 의 조업 온도와 맞지 않는다. 미해결 사항이다.**\n"
            "   WS-KS-001 WS-02 의 용해로 설정 온도는 유연 340±20°C, 무연 400±20°C 이고\n"
            "   WS-05 의 주탕 온도는 유연 280±15°C, 무연 330±15°C 다.\n"
            "   255°C 를 그대로 두면 정상 조업 중인 용해로가 계속 경고로 표시된다.\n"
            "   설비 계열별 경고선 분리가 필요하며, 생산팀·품질보증팀 확정 대상이다.\n"
            "3. WS-KS-001 의 위 온도값에는 [현장확정] 표시가 붙어 있다. 3개월 실측 후\n"
            "   Rev.1 에서 확정되는 잠정치다. 다만 잠정치도 준수 대상이다.\n"
            "4. 온도 경고 판정은 서버가 수행한다. 화면에서 임의로 다시 계산하지 않는다.\n"
            "5. 정지 상태(점검·이상) 설비의 온도는 측정값 없음으로 표시된다.\n"
            "   0.0°C 로 표시되면 잘못된 것이다. 0도로 측정되었다는 뜻이 되기 때문이다.\n"
            "6. 실시간 모니터는 10초 간격으로 갱신한다.\n"
            "7. 서버 연결이 3회 연속 끊기면 갱신을 멈추고 마지막 확인 시각을 표시한다.\n"
            "   이때 화면의 숫자는 과거 값이며 현재 상태가 아니다."
        ),
    },
    {
        "code": "STD-RECV-001",
        "name": "원재료 입고 성분 등록 기준",
        "content": (
            "1. 입고 원재료의 성분은 당사 XRF 분석 결과를 등록한다.\n"
            "2. 공급사 성적서 값을 그대로 입력하지 않는다. WS-KS-001 부속서 B.1 과\n"
            "   QS-KS-001 §2.3 이 성적서 수치의 무조건 인용을 금지한다.\n"
            "   성적서 값을 쓰면 배합 이론값 자체가 틀어져 편차 분석이 무의미해진다.\n"
            "3. 등록 항목은 Sn / Ag / Cu 이며 Pb 는 자동 계산된다.\n"
            "4. 측정하지 않은 성분은 비워 둔다. 0 으로 채우면 측정 결과 0% 라는 뜻이 된다.\n"
            "5. 시스템의 입고 상태는 수락 / 검사중 / 거부 세 가지다.\n"
            "   QS-KS-001 의 수입검사 판정 구분과 대응 관계는 별도 확인이 필요하다.\n"
            "6. 공급사별 성분 안정성은 표준편차로 비교한다. 값이 작을수록 안정적이다.\n"
            "7. 불순물 허용 한도는 QS-KS-001 §3.4 를 따른다. 이 시스템은 불순물을 관리하지 않는다."
        ),
    },
]


def _verify(db) -> list[str]:
    """등록 전 DB 대조 — 문서에 적을 값이 실제 설정과 같은지 확인한다."""
    rows = dict(
        db.execute(text("select key, value from system_settings")).fetchall()
    )
    problems = []
    for key, want in EXPECTED.items():
        got = rows.get(key)
        if got is None:
            problems.append(f"{key}: 설정 없음 (기대 {want})")
        elif str(got).strip() != want:
            problems.append(f"{key}: DB={got} ≠ 문서={want}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        print("=== 등록 전 정본 대조 ===")
        problems = _verify(db)
        if problems:
            print("  ❌ 문서의 값이 시스템 설정과 다르다. 등록을 중단한다:")
            for p in problems:
                print(f"     {p}")
            return 1
        print(f"  ✅ 기준값 {len(EXPECTED)}건 일치\n")

        print(f"{'코드':<16} {'상태':<10} 제목")
        print("-" * 62)
        added = updated = skipped = 0

        for std in STANDARDS:
            body = std["content"] + DISCLAIMER
            row = db.execute(
                text(
                    "select id, version, value->>'content' from master_codes "
                    "where group_code='WORK_STD' and code=:c and active"
                ),
                {"c": std["code"]},
            ).first()

            if row and row[2] == body:
                print(f"{std['code']:<16} {'변경없음':<10} {std['name']}")
                skipped += 1
                continue

            value = json.dumps({"content": body, "author": AUTHOR}, ensure_ascii=False)

            if args.dry_run:
                print(f"{std['code']:<16} {'[dry-run]':<10} {std['name']}")
                continue

            if row:
                # 개정 — 기존 행을 내리고 version+1 로 새로 넣는다 (§8.8.1 개정 모델)
                db.execute(
                    text("update master_codes set active=false where id=:i"), {"i": row[0]}
                )
                db.execute(
                    text(
                        "insert into master_codes "
                        "(group_code, code, name, value, sort_order, version, active, created_at) "
                        "values ('WORK_STD',:c,:n,cast(:v as jsonb),:s,:ver,true,now())"
                    ),
                    {"c": std["code"], "n": std["name"], "v": value,
                     "s": STANDARDS.index(std) + 1, "ver": row[1] + 1},
                )
                print(f"{std['code']:<16} {'개정 v' + str(row[1] + 1):<10} {std['name']}")
                updated += 1
            else:
                db.execute(
                    text(
                        "insert into master_codes "
                        "(group_code, code, name, value, sort_order, version, active, created_at) "
                        "values ('WORK_STD',:c,:n,cast(:v as jsonb),:s,1,true,now())"
                    ),
                    {"c": std["code"], "n": std["name"], "v": value,
                     "s": STANDARDS.index(std) + 1},
                )
                print(f"{std['code']:<16} {'신규':<10} {std['name']}")
                added += 1

        if args.dry_run:
            db.rollback()
            print("\n[dry-run] 변경 없음")
        else:
            db.commit()
            total = db.execute(
                text(
                    "select count(*) from master_codes "
                    "where group_code='WORK_STD' and active and value ? 'content'"
                )
            ).scalar_one()
            print(f"\n신규 {added} · 개정 {updated} · 변경없음 {skipped}")
            print(f"본문 있는 작업 표준: **{total}건**")
            print(
                "\n현장 문서(WS-KS-001·QS-KS-001)는 master_codes 가 아니라 doc_chunks 에 있다."
                "\n적재: .venv/bin/python scripts/ingest_docs.py"
            )
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
