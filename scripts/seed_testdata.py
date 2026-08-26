"""기능 테스트용 데이터 보강 — 얇은 테이블을 100행 이상으로 채운다.

`scripts/seed_db.py` 는 화면이 "0행 아님"을 만족하는 최소 시드만 넣었다.
그 결과 목록·페이징·필터·집계를 실제로 시험할 수 없었고, 비율 지표가
표본이 너무 작아 왜곡됐다(예: claims 3 / shipments 4 → 클레임률 75%).

실행:
    .venv/bin/python scripts/seed_testdata.py            # 100행까지 보강
    .venv/bin/python scripts/seed_testdata.py --target 200
    .venv/bin/python scripts/seed_testdata.py --reset    # 보강분만 지우고 다시

── 보강하지 않는 테이블과 그 이유 ──────────────────────────────────────────────
  suppliers          코드가 `SUP_A/B/C` 3개로 고정이다. `types/api.ts` 의
                     `SupplierCode` 와 `/deviation/by-supplier` 응답이 이 3개를
                     전제하므로 `SUP_D` 를 넣으면 프론트 타입이 깨진다
  notification_rules UK 가 `(event_type, channel)` 이고 의미 있는 조합이 6개뿐이다.
                     100개로 부풀리면 화면이 가짜 이벤트 유형으로 뒤덮인다
  ml_models          실제 학습 산출물 4종이다. 지어내면 안 된다
  system_settings    설정 키 15개가 전부다
  lots/components/quality  이미 2,000행이다

멱등하다 — 이미 목표치를 넘으면 아무것도 하지 않는다. 고정 시드(42)를 쓴다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text

from src.db.session import SessionLocal

SEED = 42
#: 데이터의 "오늘". **실제 현재 날짜**를 쓴다.
#:
#: 초판은 SF-TD3 §3.1 기준일(2026-06-27)을 고정으로 박았다. 그러면 실제 날짜가
#: 그보다 앞선 시점에 보강할 때 **신규 행만 과거에 떨어져** 기존 데이터와 어긋난다
#: (200건 보강 시 188건이 두 달 전으로 갔다). 화면의 "최근 7일/30일" 기본 필터도
#: 신규분을 못 잡는다. 기준일이 필요하면 `--anchor` 로 준다.
TODAY = dt.date.today()
TEMP_WARN_C = 255.0  # goal.md 2.3 설비 온도 경고선

CUSTOMERS = ["삼우전자", "한빛반도체", "대성PCB", "코리아전장", "신성마이크로", "동방정밀"]
PRODUCTS = ["SAC305 Bar", "SAC305 Wire", "Sn63Pb37 Bar", "SAC0307 Ball", "Sn96.5Ag3.0 Anode"]
MATERIALS = ["Sn ingot", "Ag ingot", "Cu ingot", "Pb ingot"]
CLAIM_REASONS = [
    "납땜 젖음성 불량", "표면 산화 발생", "치수 규격 이탈", "이물 혼입",
    "포장 파손", "성분 규격 미달", "융점 편차", "외관 변색",
]


def _fetch(db, sql: str, **kw):
    return db.execute(text(sql), kw).fetchall()


def _count(db, table: str) -> int:
    return db.execute(text(f"select count(*) from {table}")).scalar_one()


def seed_receipts(db, rng, target):
    have = _count(db, "receipts")
    if have >= target:
        return 0, have
    sup_ids = [r[0] for r in _fetch(db, "select id from suppliers order by id")]
    made = 0
    for n in range(have + 1, target + 1):
        sid = rng.choice(sup_ids)
        mat = rng.choice(MATERIALS)
        d = TODAY - dt.timedelta(days=rng.randint(0, 540))
        status = rng.choices(["accepted", "inspecting", "rejected"], weights=[80, 15, 5])[0]
        # 주원소만 실측값을 넣는다 — 입고 시점에 전 성분을 재지 않는다
        sn = round(rng.uniform(99.85, 99.98), 3) if mat.startswith("Sn") else None
        db.execute(
            text("""insert into receipts
                    (receipt_no, date, supplier_id, material, quantity, unit, status,
                     sn_pct, analysis_method, created_at)
                    values (:no,:d,:sid,:m,:q,'kg',:st,:sn,:am,:ts)"""),
            dict(no=f"RCV-{n:04d}", d=d, sid=sid, m=mat,
                 q=round(rng.uniform(200, 2000), 1), st=status,
                 sn=sn, am="XRF" if sn is not None else None,
                 ts=dt.datetime.combine(d, dt.time(rng.randint(8, 17), rng.randint(0, 59)))),
        )
        made += 1
    return made, target


def seed_shipments(db, rng, target):
    have = _count(db, "shipments")
    if have >= target:
        return 0, have
    lots = [r[0] for r in _fetch(db, "select id from lots where status='pass' order by id desc limit 800")]
    made = 0
    for _ in range(target - have):
        d = TODAY - dt.timedelta(days=rng.randint(0, 400))
        db.execute(
            text("""insert into shipments (lot_id, customer, product, quantity, unit, shipped_at)
                    values (:lid,:c,:p,:q,'kg',:ts)"""),
            dict(lid=rng.choice(lots), c=rng.choice(CUSTOMERS), p=rng.choice(PRODUCTS),
                 q=round(rng.uniform(50, 800), 1),
                 ts=dt.datetime.combine(d, dt.time(rng.randint(9, 18), rng.randint(0, 59)))),
        )
        made += 1
    return made, target


def seed_claims(db, rng, target):
    """클레임은 **불합격·경고 LOT 에 몰리게** 만든다. 무작위로 뿌리면
    '클레임 원인 분석'(FE-RT-19) 화면이 아무 상관관계도 못 보여준다."""
    have = _count(db, "claims")
    if have >= target:
        return 0, have
    pool = [r[0] for r in _fetch(db, """
        select l.id from lots l where l.status in ('fail','warning')
        order by l.quality_score asc limit 400""")]
    if not pool:
        pool = [r[0] for r in _fetch(db, "select id from lots limit 200")]
    made = 0
    for n in range(have + 1, target + 1):
        d = TODAY - dt.timedelta(days=rng.randint(0, 400))
        status = rng.choices(["resolved", "analyzing", "open", "rejected"], weights=[55, 20, 15, 10])[0]
        done = status in ("resolved", "rejected")
        db.execute(
            text("""insert into claims
                    (claim_no, lot_id, customer, reason, status, resolution, resolved_at, created_at)
                    values (:no,:lid,:c,:r,:st,:res,:rat,:ts)"""),
            dict(no=f"CLM-{n:04d}", lid=rng.choice(pool), c=rng.choice(CUSTOMERS),
                 r=rng.choice(CLAIM_REASONS), st=status,
                 res=("원인 확인 후 재작업 완료" if status == "resolved"
                      else "고객 취급 부주의로 확인 — 반려" if status == "rejected" else None),
                 rat=dt.datetime.combine(min(d + dt.timedelta(days=rng.randint(1, 14)), TODAY), dt.time(14, 0))
                 if done else None,  # 처리 완료 시각이 오늘을 넘지 않게 자른다
                 ts=dt.datetime.combine(d, dt.time(rng.randint(9, 17), rng.randint(0, 59)))),
        )
        made += 1
    return made, target


def seed_alerts(db, rng, target):
    have = _count(db, "alerts")
    if have >= target:
        return 0, have
    lots = [r[0] for r in _fetch(db, "select id from lots order by id desc limit 500")]
    # 문구는 정본 임계값(goal.md 2.3)만 쓴다 — 화면에 박혀 있던 1.5/0.1/0.05 는 오류였다
    tmpl = [
        ("warning", "Sn 편차 ±2.0% 초과", "ml"),
        ("warning", "Ag 편차 ±0.3% 초과", "ml"),
        ("warning", "Cu 편차 ±0.1% 초과", "ml"),
        ("critical", "품질 점수 70점 미만 — 불합격", "ml"),
        ("warning", "용해로 온도 255°C 초과", "equipment"),
        ("info", "일일 배치 집계 완료", "system"),
        ("critical", "설비 이상 정지", "equipment"),
    ]
    made = 0
    for _ in range(target - have):
        lvl, msg, src = rng.choice(tmpl)
        d = TODAY - dt.timedelta(days=rng.randint(0, 180))
        resolved = rng.random() < 0.65
        db.execute(
            text("""insert into alerts (level, message, source, lot_id, resolved, resolved_at, created_at)
                    values (:l,:m,:s,:lid,:rv,:rat,:ts)"""),
            dict(l=lvl, m=msg, s=src, lid=rng.choice(lots) if src == "ml" else None,
                 rv=resolved,
                 rat=dt.datetime.combine(d, dt.time(18, 0)) if resolved else None,
                 ts=dt.datetime.combine(d, dt.time(rng.randint(6, 20), rng.randint(0, 59)))),
        )
        made += 1
    return made, target


def seed_process_conditions(db, rng, target):
    have = _count(db, "process_conditions")
    if have >= target:
        return 0, have
    made = 0
    n = have
    while n < target:
        n += 1
        pc = f"PRD-{n:03d}"
        tmin = round(rng.uniform(230, 250), 1)
        db.execute(
            text("""insert into process_conditions
                    (product_code, temp_min, temp_max, time_min, time_max, speed, version, active, created_at)
                    values (:pc,:tmin,:tmax,:mn,:mx,:sp,1,true,:ts)"""),
            dict(pc=pc, tmin=tmin, tmax=round(tmin + rng.uniform(15, 35), 1),
                 mn=rng.randint(30, 45), mx=rng.randint(50, 75),
                 sp=round(rng.uniform(1.0, 3.5), 2),
                 ts=dt.datetime.combine(TODAY - dt.timedelta(days=rng.randint(30, 400)), dt.time(9, 0))),
        )
        made += 1
    return made, target


def seed_condition_history(db, rng, target):
    have = _count(db, "condition_history")
    if have >= target:
        return 0, have
    conds = [r[0] for r in _fetch(db, "select id from process_conditions")]
    users = [r[0] for r in _fetch(db, "select id from users")]
    if not conds:
        return 0, have
    made = 0
    for _ in range(target - have):
        before = {"temp_max": round(rng.uniform(255, 275), 1)}
        after = {"temp_max": round(before["temp_max"] + rng.uniform(-8, 8), 1)}
        db.execute(
            text("""insert into condition_history (condition_id, changed_by, before, after, created_at)
                    values (:cid,:uid,cast(:b as jsonb),cast(:a as jsonb),:ts)"""),
            dict(cid=rng.choice(conds), uid=rng.choice(users) if users else None,
                 b=json.dumps(before, ensure_ascii=False), a=json.dumps(after, ensure_ascii=False),
                 ts=dt.datetime.combine(TODAY - dt.timedelta(days=rng.randint(0, 300)),
                                        dt.time(rng.randint(8, 18), rng.randint(0, 59)))),
        )
        made += 1
    return made, target


def seed_master_codes(db, rng, target):
    """활성 UK 는 `(group_code, code)` 다 — 같은 코드를 두 번 활성으로 넣으면 안 된다."""
    have = _count(db, "master_codes")
    if have >= target:
        return 0, have
    existing = {(g, c) for g, c in _fetch(db, "select group_code, code from master_codes")}
    groups = [
        ("QUALITY_STD", "품질 기준"),
        ("WORK_STD", "작업 표준"),
        ("COMMON", "공통 코드"),
        ("MATERIAL", "재료 코드"),
        ("CUSTOMER", "고객사 코드"),
    ]
    made, n = 0, 0
    while have + made < target:
        n += 1
        gc, gname = groups[n % len(groups)]
        code = f"{gc[:3]}-{n:03d}"
        if (gc, code) in existing:
            continue
        existing.add((gc, code))
        if gc == "QUALITY_STD":
            val = {"sn": [55.0, 70.0], "ag": [1.0, 5.0], "cu": [0.1, 1.5], "pass_score": 70}
        elif gc == "WORK_STD":
            val = {"revision": rng.randint(1, 5), "steps": rng.randint(4, 12)}
        else:
            val = {"label": f"{gname} {n}"}
        db.execute(
            text("""insert into master_codes
                    (group_code, code, name, value, sort_order, version, active, created_at)
                    values (:g,:c,:nm,cast(:v as jsonb),:so,1,true,:ts)"""),
            dict(g=gc, c=code, nm=f"{gname} {n}", v=json.dumps(val, ensure_ascii=False),
                 so=n, ts=dt.datetime.combine(TODAY - dt.timedelta(days=rng.randint(10, 300)), dt.time(9, 0))),
        )
        made += 1
    return made, have + made


def seed_kpi_targets(db, rng, target):
    """UK 는 `(kpi_key, period)` 다.

    ⚠️ **목표 근거가 없는 지표는 행을 만들지 않는다.**
    `target_value` 는 `NOT NULL` 이고, 계약(`kpi.py: put_kpi_targets`)이
    *"목표를 비우려면 그 행을 아예 보내지 마라"* 고 규정한다.

    초판은 근거 없는 3종(`pass_rate`·`claim_rate`·`production_volume`)에 **`0` 을 넣어**
    49행을 만들었다. 그 결과 생산량·합격률은 실적이 0 을 넘기만 하면 **매달 자동 달성**,
    클레임률은 0% 미만이 불가능해 **매달 달성 불가**로 찍혔다 (QA-C DEF-C-02).
    행이 없어야 화면이 "목표 미설정"으로 읽고 게이지를 숨긴다.

    목표 근거는 SF-AD1 §2.2.3 의 3종뿐이다 — 수율 95% · 불량률 5% · 평균 품질 88점.
    """
    have = _count(db, "kpi_targets")
    if have >= target:
        return 0, have
    existing = {(k, p) for k, p in _fetch(db, "select kpi_key, period from kpi_targets")}
    goals = {"yield_pct": 95.0, "defect_rate": 5.0, "quality_avg": 88.0}
    made = 0
    month = dt.date(2026, 6, 1)
    while have + made < target and month.year >= 2022:
        for key, tv in goals.items():
            if have + made >= target:
                break
            period = month.strftime("%Y-%m")
            if (key, period) in existing:
                continue
            existing.add((key, period))
            db.execute(
                text("""insert into kpi_targets (kpi_key, period, target_value, actual_value, created_at)
                        values (:k,:p,:tv,null,:ts)"""),
                dict(k=key, p=period, tv=tv, ts=dt.datetime.combine(TODAY, dt.time(9, 0))),
            )
            made += 1
        month = (month.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
    return made, have + made


def seed_equipment(db, rng, target):
    have = _count(db, "equipment")
    if have >= target:
        return 0, have
    kinds = [("솔더링 머신", "SLD"), ("용해로", "MLT"), ("배합기", "MIX"),
             ("품질검사기", "QCI"), ("압출기", "EXT"), ("절단기", "CUT")]
    made = 0
    for n in range(have + 1, target + 1):
        name, pre = kinds[n % len(kinds)]
        status = rng.choices(["normal", "warning", "maintenance", "error"], weights=[75, 12, 8, 5])[0]
        # 정지 설비의 온도는 **null** 이다 — 0.0 으로 넣으면 "0도로 측정됨" 으로 읽힌다
        temp = None if status in ("maintenance", "error") else round(rng.uniform(215, 268), 1)
        # ⚠ 상태와 온도를 따로 뽑으면 **서로 모순되는 행**이 생긴다.
        # 초판은 둘을 독립적으로 무작위 배정해 `정상` 배지인데 온도 경고선(255°C)을
        # 넘긴 설비가 14대 나왔다 (QA-A D-04). 서버 `temp_warning` 은 온도로만 판정하므로
        # 화면에 `정상` + `온도 경고` 가 같이 떴다. 경고 온도면 상태도 경고로 맞춘다.
        if status == "normal" and temp is not None and temp > TEMP_WARN_C:
            status = "warning"
        db.execute(
            text("""insert into equipment (eq_id, name, status, temperature, uptime, last_maintenance, updated_at)
                    values (:e,:n,:s,:t,:u,:lm,:ts)"""),
            dict(e=f"EQ-{n:03d}", n=f"{name} #{n}", s=status, t=temp,
                 u=rng.randint(60, 100),
                 lm=TODAY - dt.timedelta(days=rng.randint(5, 200)),
                 ts=dt.datetime.combine(TODAY, dt.time(rng.randint(6, 20), rng.randint(0, 59)))),
        )
        made += 1
    return made, target


def seed_users(db, rng, target):
    """비밀번호 해시는 시드 계정과 동일한 것을 재사용한다 — 새로 만들지 않는다."""
    have = _count(db, "users")
    if have >= target:
        return 0, have
    row = _fetch(db, "select password_hash from users limit 1")
    if not row:
        return 0, have
    pw = row[0][0]
    roles = ["viewer", "quality", "manufacture", "sales"]
    made = 0
    for n in range(have + 1, target + 1):
        role = roles[n % len(roles)]
        db.execute(
            text("""insert into users (username, email, password_hash, role, active, last_login, created_at)
                    values (:u,:e,:p,:r,:a,:ll,:ts)"""),
            dict(u=f"user{n:03d}", e=f"user{n:03d}@koryosolder.local", p=pw, r=role,
                 a=rng.random() < 0.9,
                 ll=dt.datetime.combine(TODAY - dt.timedelta(days=rng.randint(0, 60)), dt.time(9, 0))
                 if rng.random() < 0.7 else None,
                 ts=dt.datetime.combine(TODAY - dt.timedelta(days=rng.randint(30, 500)), dt.time(9, 0))),
        )
        made += 1
    return made, target


SEEDERS = [
    ("receipts", seed_receipts),
    ("shipments", seed_shipments),
    ("claims", seed_claims),
    ("alerts", seed_alerts),
    ("process_conditions", seed_process_conditions),
    ("condition_history", seed_condition_history),
    ("master_codes", seed_master_codes),
    ("kpi_targets", seed_kpi_targets),
    ("equipment", seed_equipment),
    ("users", seed_users),
]

SKIPPED = {
    "suppliers": "코드가 SUP_A/B/C 3개로 고정 — 프론트 타입이 이 3개를 전제한다",
    "notification_rules": "UK (event_type, channel) — 의미 있는 조합이 6개뿐",
    "ml_models": "실제 학습 산출물 4종 — 지어내면 안 된다",
    "system_settings": "설정 키 15개가 전부",
    "lots / components / quality": "이미 2,000행",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=100, help="테이블당 목표 행수 (기본 100)")
    ap.add_argument("--reset", action="store_true", help="보강분을 지우고 다시 넣는다")
    ap.add_argument("--anchor", default=None,
                    help="데이터의 '오늘' (YYYY-MM-DD). 기본은 실제 현재 날짜")
    args = ap.parse_args()

    global TODAY
    if args.anchor:
        TODAY = dt.date.fromisoformat(args.anchor)
    print(f"기준일(오늘): {TODAY}\n")

    rng = random.Random(SEED)
    db = SessionLocal()
    try:
        if args.reset:
            # 최초 시드(seed_db.py)가 만든 것은 남기고 보강분만 지운다
            for tbl, keep in [("receipts", 5), ("shipments", 4), ("claims", 3), ("alerts", 6),
                              ("condition_history", 2), ("master_codes", 12), ("kpi_targets", 18),
                              ("equipment", 6), ("users", 5)]:
                db.execute(text(f"delete from {tbl} where id not in "
                                f"(select id from {tbl} order by id limit {keep})"))
            db.execute(text("delete from process_conditions where id not in "
                            "(select id from process_conditions order by id limit 2)"))
            db.commit()
            print(f"[reset] 보강분 삭제 완료\n")

        print(f"목표: 테이블당 {args.target}행\n")
        print(f"  {'테이블':<20} {'전':>6} {'추가':>6} {'후':>6}")
        print("  " + "-" * 42)
        total_made = 0
        for name, fn in SEEDERS:
            before = _count(db, name)
            made, _ = fn(db, rng, args.target)
            db.commit()
            after = _count(db, name)
            total_made += made
            mark = "" if made else "  (이미 충족)"
            print(f"  {name:<20} {before:>6} {made:>6} {after:>6}{mark}")

        print(f"\n  총 {total_made}행 추가")
        print("\n보강하지 않은 테이블:")
        for k, why in SKIPPED.items():
            print(f"  · {k:<26} {why}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
