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
    "\n\n※ 이 문서는 시스템이 강제하는 **확정 기준값**을 정리한 것이다. "
    "현장의 실제 운전 방법·순서·주의사항은 제조팀이 작성한 작업표준서를 따른다."
)

STANDARDS: list[dict] = [
    {
        "code": "STD-COMP-001",
        "name": "성분 목표값 및 편차 관리 기준",
        "content": (
            "1. 성분 목표값은 Sn 62.0% / Ag 3.0% / Cu 0.5% 다.\n"
            "2. Pb 는 입력하지 않는다. 100 − Sn − Ag − Cu 로 자동 계산된다.\n"
            "3. 성분 편차는 XRF 측정값을 등록하는 순간 목표값 대비로 자동 계산된다.\n"
            "4. 편차 경고 임계는 Sn ±2.0% / Ag ±0.3% / Cu ±0.1% 다.\n"
            "5. 임계를 넘으면 해당 항목이 경고로 표시되고 알림이 발송된다.\n"
            "6. 편차는 상대 비율(%)이 아니라 목표값과의 절대 차이다."
        ),
    },
    {
        "code": "STD-QUAL-001",
        "name": "품질 판정 기준",
        "content": (
            "1. 품질 합격선은 70점이다. 70점 이상이 합격, 미만은 불합격이다.\n"
            "2. 69.9점은 불합격이고 70.0점은 합격이다. 반올림하여 판단하지 않는다.\n"
            "3. LOT 상태는 80점 이상 정상, 70점 이상 80점 미만 경고, 70점 미만 불합격이다.\n"
            "4. 합격 여부와 품질 등급은 서로 다른 기준이다. 합격 판정은 70점 하나로만 한다.\n"
            "5. 합격선은 시스템 설정에서 변경할 수 있으며, 변경 시 과거 판정은 다시 계산되지 않는다."
        ),
    },
    {
        "code": "STD-MIX-001",
        "name": "배합비율 입력 및 최적화 범위 기준",
        "content": (
            "1. 배합 성분 합계는 정확히 100.0% 여야 한다. 합계가 맞지 않으면 예측이 실행되지 않는다.\n"
            "2. 최적화 탐색 범위는 Sn 55~70% / Ag 1~5% / Cu 0.1~1.5% / Pb 25~45% 다.\n"
            "3. 이 범위를 벗어난 배합은 품질 예측이 거부한다. 최적화 요청도 거부된다.\n"
            "4. 배합 최적화의 모델 선택 목록에 Ridge 는 포함되지 않는다.\n"
            "   선형 모델은 최적점이 항상 탐색 범위의 끝으로 몰려 추천이 무의미해지기 때문이다.\n"
            "5. 품질 예측 화면에서는 네 가지 모델을 모두 선택할 수 있다."
        ),
    },
    {
        "code": "STD-EQUIP-001",
        "name": "설비 온도 감시 기준",
        "content": (
            "1. 설비 온도 경고선은 255°C 다. 초과 시 온도 경고로 표시된다.\n"
            "2. 온도 경고 판정은 시스템이 수행한다. 화면에서 임의로 다시 계산하지 않는다.\n"
            "3. 정지 상태(점검·이상) 설비의 온도는 측정값 없음으로 표시된다.\n"
            "   0.0°C 로 표시되면 잘못된 것이다. 0도로 측정되었다는 뜻이 되기 때문이다.\n"
            "4. 실시간 모니터는 10초 간격으로 갱신한다.\n"
            "5. 서버와 연결이 3회 연속 끊기면 갱신을 멈추고 마지막 확인 시각을 표시한다.\n"
            "   이때 화면의 숫자는 과거 값이며 현재 상태가 아니다."
        ),
    },
    {
        "code": "STD-RECV-001",
        "name": "원재료 입고 성분 등록 기준",
        "content": (
            "1. 입고 원재료의 성분은 XRF 분석 결과를 그대로 등록한다.\n"
            "2. 등록 항목은 Sn / Ag / Cu 이며 Pb 는 자동 계산된다.\n"
            "3. 입고 시점에는 주원소만 측정하며, 측정하지 않은 성분은 비워 둔다.\n"
            "   비워 둔 값을 0 으로 채우면 측정 결과 0% 라는 뜻이 되므로 넣지 않는다.\n"
            "4. 입고 상태는 수락 / 검사중 / 거부 세 가지다.\n"
            "5. 공급사별 성분 안정성은 표준편차로 비교한다. 값이 작을수록 안정적이다."
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
            print("\n현장의 실제 운전 방법은 제조팀 작업표준서로 별도 등록해야 한다.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
