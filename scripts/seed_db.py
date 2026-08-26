"""18개 테이블 시드 로더 — 고려솔더 AI 스마트공장.

실행:
    .venv/bin/python scripts/seed_db.py            # 시드 적재
    .venv/bin/python scripts/seed_db.py --counts   # 행 수만 출력

계약 근거
    contracts/db-schema.md §4.1 (시드 → 테이블 적재 규칙)
    contracts/api-contract.md §2.4 (계약값이 유일한 정본)
    goal.md 2.3 (하드 비즈니스 룰)

원칙
  1. **멱등하다.** 두 번 돌려도 중복이 생기지 않는다.
     - `suppliers` · `users` · `system_settings` · `equipment` 는 **자연키 upsert**
       (FK 참조와 사용자 ID 를 보존한다 — `audit_logs.user_id` 가 날아가면 안 된다)
     - 나머지는 **DELETE 후 재삽입**
     - `audit_logs` 는 **건드리지 않는다** (런타임 생성물, 보관 1년)
  2. **고정 시드.** `lots_seed.csv` 는 seed=42 로 생성된 고정 파일이고,
     이 스크립트의 파생값(출하 LOT 매칭·알림 문구)은 전부 결정론적이다.
     비밀번호 해시도 고정 salt 를 써서 재실행 시 동일하다.
  3. **지어내지 않는다.** 값의 출처를 각 블록 주석에 적었다.
     출처가 없는 값은 NULL 로 둔다.

⚠ 계약과 다르게 처리한 것 — 숨기지 않고 적는다
  * `db-schema.md` §4.1 은 `claims`/`condition_history` 를 "시드 없음"으로 적었으나,
    **웨이브 C 라운드1 지시가 18개 테이블 전부 비어 있지 않을 것을 요구**한다
    (감사로그 제외). 두 테이블에 최소 시드를 넣고 출처를 아래에 적었다.
  * `alerts` 6행은 §4.1 이 "mock-data.ts ALERTS 그대로"라고 적었지만,
    mock 문구 3건이 **계약값과 어긋난다** — 편차 임계를 `1.5%` 로 쓰고(정본 2.0),
    존재하지 않는 LOT 점수(`LOT-2026-008 60.2`)를 인용하고, 수율 목표를 93 으로
    적었다(정본 95). `api-contract.md` §2.4 가 "화면의 기존 숫자를 근거로 삼지 마라"
    라고 규정하므로 **해당 3건은 실제 시드 데이터에서 재생성**했다.
    설비 알림 2건(EQ-002 258°C / EQ-006 오류)은 시드 `equipment` 행과 일치하므로 그대로 쓴다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from decimal import Decimal
from pathlib import Path

import pandas as pd
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.db.models import (  # noqa: E402
    Alert,
    AuditLog,
    Claim,
    Component,
    ConditionHistory,
    Equipment,
    KpiTarget,
    Lot,
    MasterCode,
    MlModel,
    NotificationRule,
    ProcessCondition,
    Quality,
    Receipt,
    Shipment,
    Supplier,
    SystemSetting,
    User,
)
from src.db.session import SessionLocal  # noqa: E402
from src.features.engineering import AG_TARGET, CU_TARGET, SN_TARGET  # noqa: E402

# ══════════════════════════════════════════════════════════════════════════
# 하드 비즈니스 룰 (goal.md 2.3) — **화면에 박힌 1.5/0.1/0.05 는 오류다**
# ══════════════════════════════════════════════════════════════════════════
QUALITY_PASS_SCORE = 70      # 품질 합격선
QUALITY_WARN_SCORE = 80      # lots.status pass/warning 경계 (db-schema.md §3.1)
TEMP_WARN_C = 255            # 설비 온도 경고 (초과)
DEVIATION_WARN = {"sn": 2.0, "ag": 0.3, "cu": 0.1}

SEED_CSV = ROOT / "data" / "raw" / "lots_seed.csv"
ARTIFACTS = ROOT / "models" / "artifacts"

#: 서빙 모델 — `api-contract.md` §7.2 (유일하게 `ml_models.active = true`)
SERVING_MODEL = "gradient_boosting"

#: 모델 학습 표본 수 — `api-contract.md` §7.1 "2,000건, test_size=0.2" → 1,600
TRAIN_SAMPLES = 1600

#: `api-contract.md` §7.3 모델 등급
MODEL_TIER = {
    "gradient_boosting": "serving",
    "xgboost": "candidate",
    "random_forest": "candidate",
    "ridge": "baseline",
}

#: 시드 계정 공통 비밀번호. **개발 환경 전용** — 운영 전환 시 전부 교체할 것.
#: 8자 이상 (`api-contract.md` §8.7.1 "복잡도·만료 정책은 만들지 마라").
SEED_PASSWORD = "koryo1234!"
#: 고정 salt — 재실행 시 해시가 동일해야 "재현 가능"이 성립한다.
_FIXED_SALT = b"$2b$12$KoryoSolderSeedSalt00u"


def hash_password(password: str) -> str:
    """bcrypt 해시 (`$2b$` 포맷, 60자).

    ⚠ `passlib 1.7.4` + `bcrypt 5.0.0` 조합은 백엔드 로드 단계에서 깨진다
    (72바이트 초과 프로브 → `ValueError`). `src/api/deps.py` 도 같은 이유로
    `bcrypt` 를 직접 쓴다. 해시 포맷이 동일하므로 검증은 어느 쪽으로도 된다.
    """
    import bcrypt

    return bcrypt.hashpw(password.encode("utf-8")[:72], _FIXED_SALT).decode()


# ══════════════════════════════════════════════════════════════════════════
# 1. suppliers — SUP_A/B/C
#    code/편차 특성: data/raw/generate_sample.py SUPPLIERS (SF-TD3 §3.4 근거)
#    primary_material: mock-data.ts RECEIVING_HISTORY 의 공급사별 원재료
#    name: 산출물 어디에도 실제 회사명이 없다 → 코드 기반 표기만 쓴다
#    contact: 출처 없음 → NULL (지어내지 않는다)
# ══════════════════════════════════════════════════════════════════════════
SUPPLIERS = [
    {"code": "SUP_A", "name": "공급사 A", "contact": None,
     "primary_material": "Sn ingot", "active": True},
    {"code": "SUP_B", "name": "공급사 B", "contact": None,
     "primary_material": "Ag powder", "active": True},
    {"code": "SUP_C", "name": "공급사 C", "contact": None,
     "primary_material": "Cu wire", "active": True},
]

# ══════════════════════════════════════════════════════════════════════════
# 2. users — RBAC 5역할 각 1계정 (goal.md 2.3 · api-contract.md §3.2)
# ══════════════════════════════════════════════════════════════════════════
USERS = [
    {"username": "admin", "email": "admin@koryosolder.local", "role": "admin"},
    {"username": "mfg01", "email": "mfg01@koryosolder.local", "role": "manufacture"},
    {"username": "qc01", "email": "qc01@koryosolder.local", "role": "quality"},
    {"username": "sales01", "email": "sales01@koryosolder.local", "role": "sales"},
    {"username": "viewer01", "email": "viewer01@koryosolder.local", "role": "viewer"},
]

# ══════════════════════════════════════════════════════════════════════════
# 3. equipment — mock-data.ts EQUIPMENT_STATUS 6행 그대로 (db-schema.md §4.1)
# ══════════════════════════════════════════════════════════════════════════
EQUIPMENT = [
    ("EQ-001", "솔더링 머신 #1", "normal", 248.0, 1420, "2026-06-01"),
    ("EQ-002", "솔더링 머신 #2", "warning", 258.0, 980, "2026-05-15"),
    ("EQ-003", "용해로 #1", "normal", 251.0, 2100, "2026-06-10"),
    ("EQ-004", "용해로 #2", "maintenance", 0.0, 0, "2026-06-27"),
    ("EQ-005", "품질검사기 #1", "normal", 25.0, 3600, "2026-04-20"),
    ("EQ-006", "배합기 #1", "error", 0.0, 0, "2026-05-30"),
]

# ══════════════════════════════════════════════════════════════════════════
# 4. receipts — mock-data.ts RECEIVING_HISTORY 5행
#    receipt_no 는 mock 의 'RCV-001' 이 아니라 **계약 포맷** 'RCV-00001'
#    (ts-types.md §9.1 — 5자리 0패딩, 서버 채번)
#    성분 5컬럼(CR-DB-003)은 mock 에 없다. 원재료는 **단일 원소 순도**이고
#    api-contract.md §8.3.1 이 "Sn ingot 의 sn_pct 는 99% 대"라고 규정하므로
#    주원소 순도만 채우고 나머지는 NULL 로 둔다.
#    ⚠ 순도 실측값은 산출물에 없다 — 아래 값은 **시드 가정치**다 (보고서에 명시).
#    검사 전(status='inspecting') 구간이 없어 5행 모두 측정 완료 상태다.
# ══════════════════════════════════════════════════════════════════════════
RECEIPTS = [
    # (no, date, supplier, material, qty, unit, status, 주원소, 순도)
    ("RCV-00001", "2026-06-25", "SUP_A", "Sn ingot", 500, "kg", "accepted", "sn_pct", 99.920),
    ("RCV-00002", "2026-06-24", "SUP_B", "Ag powder", 25, "kg", "accepted", "ag_pct", 99.950),
    ("RCV-00003", "2026-06-23", "SUP_C", "Cu wire", 10, "kg", "rejected", "cu_pct", 99.100),
    ("RCV-00004", "2026-06-22", "SUP_A", "Pb ingot", 300, "kg", "accepted", "pb_pct", 99.970),
    ("RCV-00005", "2026-06-20", "SUP_B", "Sn ingot", 450, "kg", "accepted", "sn_pct", 99.880),
]

# ══════════════════════════════════════════════════════════════════════════
# 5. shipments — mock-data.ts SHIPPING_HISTORY 4행
#    `lot_id` 는 품질점수로 lots 역매칭 (db-schema.md §4.1).
#    mock 의 87.2/84.1/72.3/65.8 중 실제 lots 에 정확히 존재하는 값은 1건뿐이라
#    **출하일 이전 LOT 중 점수 차가 최소인 것**을 결정론적으로 고른다
#    (동점이면 lot_id 사전순). 이미 고른 LOT 은 재사용하지 않는다.
# ══════════════════════════════════════════════════════════════════════════
SHIPMENTS = [
    ("2026-06-27", "CUST-A", "Sn62 솔더", 200, "kg", 87.2),
    ("2026-06-26", "CUST-B", "Sn63 솔더", 150, "kg", 84.1),
    ("2026-06-25", "CUST-A", "Sn62 솔더", 300, "kg", 72.3),
    ("2026-06-24", "CUST-C", "Sn60 솔더", 100, "kg", 65.8),
]

# ══════════════════════════════════════════════════════════════════════════
# 6. process_conditions — FE-RT-23
#    SF-TD5 §3.13 은 컬럼만 정의하고 표준값을 주지 않는다.
#    온도 상한 255 = goal.md 2.3 설비 온도 경고 임계.
#    온도 하한 235 / 시간 40~50 = generate_sample.py 의 공정 목표
#    (TEMP_TARGET 250 · TIME_TARGET 45) 를 중심으로 상한과 대칭이 되게 잡았다.
#    speed 는 단위·근거가 없어 NULL 이다.
#    product_code: SAC305 = api-contract.md §8.6.1 응답 예시,
#                  SN62   = mock SHIPPING_HISTORY 의 'Sn62 솔더'
# ══════════════════════════════════════════════════════════════════════════
PROCESS_CONDITIONS = [
    {"product_code": "SAC305", "temp_min": 235.0, "temp_max": 255.0,
     "time_min": 40, "time_max": 50, "speed": None, "version": 1, "active": True},
    {"product_code": "SN62", "temp_min": 235.0, "temp_max": 255.0,
     "time_min": 40, "time_max": 50, "speed": None, "version": 1, "active": True},
]

# ══════════════════════════════════════════════════════════════════════════
# 7. master_codes — db-schema.md §4.1 (SUPPLIER 3 + STATUS 4 + QUALITY_STD 1)
#    + PRODUCT 3 (mock SHIPPING_HISTORY 제품명) + WORK_STD 1 (FE-RT-31 이 빈 화면이
#      되지 않도록 최소 1행). value JSONB 스키마는 ts-types.md §9.7.
#    QUALITY_STD 의 pb 범위는 sn/ag/cu 범위에서 역산했다
#      pb_min = 100 - 64 - 3.5 - 0.7 = 31.8 · pb_max = 100 - 60 - 2.5 - 0.3 = 37.2
# ══════════════════════════════════════════════════════════════════════════
MASTER_CODES = [
    ("SUPPLIER", "SUP_A", "공급사 A", None, 1),
    ("SUPPLIER", "SUP_B", "공급사 B", None, 2),
    ("SUPPLIER", "SUP_C", "공급사 C", None, 3),
    ("STATUS", "pass", "합격", None, 1),
    ("STATUS", "warning", "경고", None, 2),
    ("STATUS", "fail", "불합격", None, 3),
    ("STATUS", "pending", "대기", None, 4),
    ("PRODUCT", "SN60", "Sn60 솔더", None, 1),
    ("PRODUCT", "SN62", "Sn62 솔더", None, 2),
    ("PRODUCT", "SN63", "Sn63 솔더", None, 3),
    ("QUALITY_STD", "SAC305", "SAC305 품질 기준", {
        "sn_min": 60.0, "sn_max": 64.0,
        "ag_min": 2.5, "ag_max": 3.5,
        "cu_min": 0.3, "cu_max": 0.7,
        "pb_min": 31.8, "pb_max": 37.2,
        "pass_score": QUALITY_PASS_SCORE,
    }, 1),
    ("WORK_STD", "SAC305", "SAC305 표준 작업지침", {
        "content": (
            "1. 용해로 예열 후 표준 온도 235~255°C 를 유지한다.\n"
            "2. 배합 시간은 40~50분으로 한다.\n"
            f"3. 성분 목표값은 Sn {SN_TARGET} / Ag {AG_TARGET} / Cu {CU_TARGET} (%) 다.\n"
            f"4. 품질 점수 {QUALITY_PASS_SCORE}점 이상을 합격으로 판정한다."
        ),
        "author": "제조팀",
    }, 1),
]

# ══════════════════════════════════════════════════════════════════════════
# 8. notification_rules — 이벤트 3종 × 채널 2종 = **6행 고정**
#    (api-contract.md §4.2·§8.7 — PUT 은 6행 전체 교체)
#    event_type 3종은 SF-AD2 FR-SY-03 문장 그대로 (db-schema.md §6.7).
#    threshold 는 v1 미사용 → NULL.
#    enabled: 시스템 채널만 on. SF-AD2 는 채널별 기본 on/off 를 정하지 않았고,
#            db-schema.md §4.1 초안이 "3종 × system 채널"만 시드하려 했으므로
#            그 의도를 6행 구조에서 재현한다 (email 은 발송 설정이 없다).
# ══════════════════════════════════════════════════════════════════════════
NOTIFICATION_EVENTS = ("quality_fail", "deviation_exceed", "equipment_warning")

# ══════════════════════════════════════════════════════════════════════════
# 9. system_settings — goal.md 2.3 하드 룰이 정본이다
#    키 이름은 `src/api/settings_store.py` (개발2) 와 **반드시 일치**해야 한다.
# ══════════════════════════════════════════════════════════════════════════
SETTINGS = [
    ("ml.sn_target", SN_TARGET, "number", "Sn 목표 (읽기 전용 — 모델 재학습 필요)"),
    ("ml.ag_target", AG_TARGET, "number", "Ag 목표 (읽기 전용 — 모델 재학습 필요)"),
    ("ml.cu_target", CU_TARGET, "number", "Cu 목표 (읽기 전용 — 모델 재학습 필요)"),
    ("quality.pass_score", QUALITY_PASS_SCORE, "number", "품질 합격 기준점"),
    ("quality.warn_score", QUALITY_WARN_SCORE, "number", "LOT 상태 pass/warning 경계"),
    ("equipment.temp_warn_c", TEMP_WARN_C, "number", "설비 온도 경고 (°C 초과)"),
    ("deviation.warn_sn", DEVIATION_WARN["sn"], "number", "Sn 편차 경고 임계 (±)"),
    ("deviation.warn_ag", DEVIATION_WARN["ag"], "number", "Ag 편차 경고 임계 (±)"),
    ("deviation.warn_cu", DEVIATION_WARN["cu"], "number", "Cu 편차 경고 임계 (±)"),
    # 연동 설정 6종 — api-contract.md §8.9.1 (자격증명은 절대 저장하지 않는다)
    ("integration.erp.enabled", "false", "boolean", "ERP 연동 사용 여부"),
    ("integration.erp.endpoint", "", "string", "ERP 연동 엔드포인트"),
    ("integration.erp.type", "REST", "string", "ERP 연동 방식"),
    ("integration.xrf.enabled", "false", "boolean", "XRF 연동 사용 여부"),
    ("integration.xrf.endpoint", "", "string", "XRF 연동 엔드포인트"),
    ("integration.xrf.type", "REST", "string", "XRF 연동 방식"),
]

# ══════════════════════════════════════════════════════════════════════════
# 10. kpi_targets — db-schema.md §4.1 (2026-01~06 × 3지표)
#     목표값 3건은 SF-AD1 업무 KPI (api-contract.md §8.11.1):
#       yield_pct 95 · defect_rate 5 · quality_avg 88
#     pass_rate·claim_rate·production_volume 은 **행을 만들지 않는다** (target null).
#     actual_value 는 월 마감 스냅샷 전용이고 화면 실적값은 실시간 집계이므로
#     시드에서는 NULL (= 미마감) 로 둔다 (api-contract.md §8.11.1).
# ══════════════════════════════════════════════════════════════════════════
KPI_PERIODS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]
KPI_TARGET_VALUES = {"yield_pct": 95.0, "defect_rate": 5.0, "quality_avg": 88.0}


# ══════════════════════════════════════════════════════════════════════════
# 유틸
# ══════════════════════════════════════════════════════════════════════════
def _d(value, digits: int) -> Decimal:
    return Decimal(f"{float(value):.{digits}f}")


def _at(day: dt.date, hour: int, minute: int = 0) -> dt.datetime:
    return dt.datetime(day.year, day.month, day.day, hour, minute)


def _iso(day: str) -> dt.date:
    return dt.date.fromisoformat(day)


# ══════════════════════════════════════════════════════════════════════════
# 적재
# ══════════════════════════════════════════════════════════════════════════
def seed(db) -> dict[str, int]:
    if not SEED_CSV.exists():
        raise SystemExit(
            f"시드 CSV 가 없다: {SEED_CSV}\n"
            "  .venv/bin/python data/raw/generate_sample.py 를 먼저 실행하라."
        )
    df = pd.read_csv(SEED_CSV)

    # ── 0. 자식 → 부모 순서로 비운다 (audit_logs 는 건드리지 않는다) ────────
    for model in (ConditionHistory, Claim, Shipment, Alert, Quality, Component,
                  Receipt, ProcessCondition, MasterCode, NotificationRule,
                  KpiTarget, MlModel, Lot):
        db.execute(delete(model))
    db.flush()

    # ── 1. suppliers (upsert) ───────────────────────────────────────────
    for row in SUPPLIERS:
        stmt = pg_insert(Supplier).values(**row)
        db.execute(stmt.on_conflict_do_update(
            index_elements=[Supplier.code],
            set_={"name": stmt.excluded.name,
                  "contact": stmt.excluded.contact,
                  "primary_material": stmt.excluded.primary_material,
                  "active": stmt.excluded.active},
        ))
    db.flush()
    sup_id = {c: i for i, c in db.execute(select(Supplier.id, Supplier.code)).all()}

    # ── 2. users (upsert — id 를 보존해 audit_logs 참조를 유지한다) ───────
    pw_hash = hash_password(SEED_PASSWORD)
    for row in USERS:
        stmt = pg_insert(User).values(password_hash=pw_hash, active=True, **row)
        db.execute(stmt.on_conflict_do_update(
            index_elements=[User.username],
            set_={"email": stmt.excluded.email,
                  "role": stmt.excluded.role,
                  "password_hash": stmt.excluded.password_hash,
                  "active": stmt.excluded.active},
        ))
    db.flush()
    user_id = {u: i for i, u in db.execute(select(User.id, User.username)).all()}
    admin_id = user_id["admin"]

    # ── 3. system_settings (upsert) ─────────────────────────────────────
    for key, value, value_type, desc in SETTINGS:
        raw = "true" if value is True else ("false" if value is False else str(value))
        stmt = pg_insert(SystemSetting).values(
            key=key, value=raw, value_type=value_type,
            description=desc, updated_by=admin_id,
        )
        db.execute(stmt.on_conflict_do_update(
            index_elements=[SystemSetting.key],
            set_={"value": stmt.excluded.value,
                  "value_type": stmt.excluded.value_type,
                  "description": stmt.excluded.description,
                  "updated_by": stmt.excluded.updated_by},
        ))

    # ── 4. equipment (upsert — eq_id UK) ────────────────────────────────
    for eq_id, name, status, temp, uptime, last_maint in EQUIPMENT:
        stmt = pg_insert(Equipment).values(
            eq_id=eq_id, name=name, status=status,
            temperature=_d(temp, 1), uptime=uptime,
            last_maintenance=_iso(last_maint),
        )
        db.execute(stmt.on_conflict_do_update(
            index_elements=[Equipment.eq_id],
            set_={"name": stmt.excluded.name,
                  "status": stmt.excluded.status,
                  "temperature": stmt.excluded.temperature,
                  "uptime": stmt.excluded.uptime,
                  "last_maintenance": stmt.excluded.last_maintenance},
        ))

    # ── 5. ml_models — models/artifacts/*_meta.json 의 **실측값** ────────
    #      active=true 는 gradient_boosting 하나뿐이다 (api-contract.md §7.2)
    ml_rows = []
    for name, tier in MODEL_TIER.items():
        meta_path = ARTIFACTS / f"{name}_meta.json"
        if not meta_path.exists():
            print(f"  ⚠ {meta_path.name} 없음 — ml_models 에서 건너뜀")
            continue
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        m = meta.get("metrics", {})
        trained = meta.get("trained_at")
        trained_at = (
            dt.datetime.fromisoformat(trained).replace(tzinfo=None)
            if trained else dt.datetime.now()
        )
        ml_rows.append({
            "name": name,
            # SF-TD5 §3.6 model_type — 등급(tier)을 담을 컬럼이 없어 여기 기록한다.
            # `GET /models` 는 이 값이 아니라 api-contract.md §7.3 표를 쓴다.
            "model_type": tier,
            "rmse": _d(m["rmse"], 4) if m.get("rmse") is not None else None,
            "r2": _d(m["r2"], 4) if m.get("r2") is not None else None,
            "mape": _d(m["mape"], 4) if m.get("mape") is not None else None,
            "train_samples": TRAIN_SAMPLES,
            "artifact_path": f"models/artifacts/{name}.joblib",
            "active": name == SERVING_MODEL,
            "trained_at": trained_at,
        })
    if ml_rows:
        db.execute(MlModel.__table__.insert(), ml_rows)

    # ── 6. lots (2,000행) ───────────────────────────────────────────────
    lot_rows = []
    for r in df.itertuples(index=False):
        day = _iso(r.lot_date)
        lot_rows.append({
            "lot_id": r.lot_id,
            "date": day,
            "supplier_id": sup_id[r.supplier_id],
            "sn_ratio": _d(r.sn_pct, 3),
            "ag_ratio": _d(r.ag_pct, 3),
            "cu_ratio": _d(r.cu_pct, 3),
            "pb_ratio": _d(r.pb_pct, 3),
            "temperature": _d(r.melt_temp_c, 1),
            "time_min": int(round(float(r.melt_time_min))),   # DECIMAL → INTEGER 반올림
            "quality_score": _d(r.quality_score, 2),
            "status": r.status,
            # 생산 시각을 날짜에 맞춘다 — 대시보드/KPI 가 기간 집계를 할 때
            # 전 행이 "시드 실행 시각"으로 몰리면 안 된다.
            "created_at": _at(day, 8),
            "updated_at": _at(day, 8),
        })
    db.execute(Lot.__table__.insert(), lot_rows)
    db.flush()
    lot_pk = {code: pk for pk, code in db.execute(select(Lot.id, Lot.lot_id)).all()}

    # ── 7. components (2,000행) — 편차는 CSV 의 저장값 그대로 ────────────
    comp_rows = [{
        "lot_id": lot_pk[r.lot_id],
        "date": _iso(r.lot_date),
        "sn": _d(r.sn_pct, 3), "ag": _d(r.ag_pct, 3),
        "cu": _d(r.cu_pct, 3), "pb": _d(r.pb_pct, 3),
        "sn_deviation": _d(r.sn_deviation, 3),
        "ag_deviation": _d(r.ag_deviation, 3),
        "cu_deviation": _d(r.cu_deviation, 3),
        "analysis_method": "XRF",
        "created_at": _at(_iso(r.lot_date), 9),
    } for r in df.itertuples(index=False)]
    db.execute(Component.__table__.insert(), comp_rows)

    # ── 8. quality (2,000행) — passed 는 score >= 70 (SF-TD5 §3.4) ──────
    q_rows = [{
        "lot_id": lot_pk[r.lot_id],
        "score": _d(r.quality_score, 2),
        "passed": bool(float(r.quality_score) >= QUALITY_PASS_SCORE),
        "model_used": SERVING_MODEL,
        "predicted_score": None,     # 저장된 예측값이 없다 → 지어내지 않는다
        "tested_at": _at(_iso(r.lot_date), 14),
    } for r in df.itertuples(index=False)]
    db.execute(Quality.__table__.insert(), q_rows)

    # ── 9. receipts (5행) ───────────────────────────────────────────────
    rcv_rows = []
    for no, day, sup, material, qty, unit, status, elem, purity in RECEIPTS:
        row = {
            "receipt_no": no, "date": _iso(day), "supplier_id": sup_id[sup],
            "material": material, "quantity": _d(qty, 2), "unit": unit,
            "status": status,
            "sn_pct": None, "ag_pct": None, "cu_pct": None, "pb_pct": None,
            "analysis_method": "XRF",
            "created_at": _at(_iso(day), 10),
        }
        row[elem] = _d(purity, 3)
        rcv_rows.append(row)
    db.execute(Receipt.__table__.insert(), rcv_rows)

    # ── 10. shipments (4행) — 출하일 직전 LOT 중 점수 차 최소 ────────────
    lots_by_date = df[["lot_id", "lot_date", "quality_score"]].copy()
    ship_rows, used_lots = [], set()
    for day, customer, product, qty, unit, score in SHIPMENTS:
        # 출하 LOT 은 최근 생산분이다. 14일 창 안에서 먼저 찾고, 비면 전 구간으로 넓힌다.
        # (점수만 보고 고르면 1년 전 LOT 이 뽑혀 FE-RT-16·17 에서 부자연스럽다)
        floor = (_iso(day) - dt.timedelta(days=14)).isoformat()
        base = lots_by_date[(lots_by_date["lot_date"] <= day)
                            & (~lots_by_date["lot_id"].isin(used_lots))]
        pool = base[base["lot_date"] >= floor].copy()
        if pool.empty:
            pool = base.copy()
        pool["diff"] = (pool["quality_score"] - score).abs()
        pool = pool.sort_values(["diff", "lot_id"], kind="mergesort")
        picked = pool.iloc[0]["lot_id"]
        used_lots.add(picked)
        ship_rows.append({
            "lot_id": lot_pk[picked], "customer": customer, "product": product,
            "quantity": _d(qty, 2), "unit": unit, "shipped_at": _at(_iso(day), 10),
        })
    db.execute(Shipment.__table__.insert(), ship_rows)
    shipped = list(used_lots)

    # ── 11. claims (3행) ────────────────────────────────────────────────
    #  db-schema.md §4.1 은 "시드 없음"이지만 라운드1 지시(18테이블 비어있지 않음)에
    #  따라 최소 시드를 넣는다. 대상 LOT 은 **실제로 출하된 LOT** 중 점수가 낮은
    #  순서다 — 클레임은 출하된 것에만 발생한다 (api-contract.md §8.11.1 claim_rate 정의).
    ship_meta = {r["lot_id"]: r for r in ship_rows}
    scored = sorted(
        ((lot_pk[c], float(lots_by_date.loc[lots_by_date.lot_id == c, "quality_score"].iloc[0]))
         for c in shipped),
        key=lambda t: t[1],
    )
    claim_rows = []
    claim_specs = [
        ("resolved", "고객 접합 불량 신고 — 출하 LOT 품질 점수 확인 요청",
         "성분 편차 재분석 후 재작업분 대체 출하 완료", 1),
        ("analyzing", "냉납 발생 보고 — 용해 온도 조건 확인 요청", None, 2),
        ("open", "외관 검사 불합격 통보 — 표면 산화 의심", None, 3),
    ]
    for idx, (status, reason, resolution, offset) in enumerate(claim_specs, start=1):
        lot_pk_id, score = scored[idx - 1]
        ship = ship_meta[lot_pk_id]
        created = ship["shipped_at"] + dt.timedelta(days=offset)
        claim_rows.append({
            "claim_no": f"CLM-{idx:05d}",
            "lot_id": lot_pk_id,
            "customer": ship["customer"],
            "reason": f"{reason} (출하 시점 품질 점수 {score:.1f})",
            "status": status,
            "resolution": resolution,
            "resolved_at": created + dt.timedelta(days=3) if resolution else None,
            "created_at": created,
        })
    db.execute(Claim.__table__.insert(), claim_rows)

    # ── 12. alerts (6행) ────────────────────────────────────────────────
    #  설비 알림 2건은 mock 그대로(시드 equipment 와 값이 일치한다).
    #  품질·편차·수율 3건은 **시드 데이터에서 재생성**한다 — mock 문구가
    #  계약값(편차 2.0 / 수율 목표 95)과 어긋나기 때문이다 (모듈 docstring 참조).
    alert_rows = [
        {"level": "warning",
         "message": f"EQ-002 솔더링 머신 #2 온도 258°C 초과 (기준: {TEMP_WARN_C}°C)",
         "source": "equipment", "lot_id": None, "resolved": False,
         "resolved_at": None, "created_at": dt.datetime(2026, 6, 27, 8, 30)},
        {"level": "critical",
         "message": "EQ-006 배합기 #1 오류 발생 — 즉시 점검 필요",
         "source": "equipment", "lot_id": None, "resolved": False,
         "resolved_at": None, "created_at": dt.datetime(2026, 6, 27, 7, 0)},
    ]

    # 품질 불합격 — 가장 최근 fail LOT
    fails = df[df["status"] == "fail"].sort_values(["lot_date", "lot_id"])
    if len(fails):
        f = fails.iloc[-1]
        day = _iso(f.lot_date)
        alert_rows.append({
            "level": "critical",
            "message": (f"{f.lot_id} 품질 점수 {f.quality_score:.1f} — "
                        f"불합격 기준({QUALITY_PASS_SCORE}) 미달"),
            "source": "ml", "lot_id": lot_pk[f.lot_id], "resolved": False,
            "resolved_at": None, "created_at": _at(day, 15),
        })

    # 성분 편차 초과 — |sn_deviation| > 2.0 인 최근 2건 (정본 임계 2.0)
    dev = df[df["sn_deviation"].abs() > DEVIATION_WARN["sn"]].sort_values(["lot_date", "lot_id"])
    for row in dev.tail(2).itertuples(index=False):
        day = _iso(row.lot_date)
        alert_rows.append({
            "level": "warning",
            "message": (f"{row.lot_id} ({row.supplier_id}) Sn 편차 {row.sn_deviation:+.2f}%p — "
                        f"경고 임계(±{DEVIATION_WARN['sn']}%p) 초과"),
            "source": "ml", "lot_id": lot_pk[row.lot_id], "resolved": True,
            "resolved_at": _at(day, 18), "created_at": _at(day, 11, 45),
        })

    # 수율 — 2026-06 실적을 목표 95 와 비교 (mock 의 "목표 93" 은 계약과 다르다)
    june = df[df["lot_date"].str.startswith("2026-06")]
    if len(june):
        rate = (june["status"] == "pass").mean() * 100
        target = KPI_TARGET_VALUES["yield_pct"]
        achieved = rate >= target
        alert_rows.append({
            "level": "info" if achieved else "warning",
            "message": (f"2026-06 수율 {rate:.1f}% — 목표({target:.1f}%) "
                        f"{'달성' if achieved else '미달'}"),
            "source": "system", "lot_id": None, "resolved": False,
            "resolved_at": None, "created_at": dt.datetime(2026, 6, 27, 6, 0),
        })
    db.execute(Alert.__table__.insert(), alert_rows)

    # ── 13. master_codes ────────────────────────────────────────────────
    mc_rows = [{
        "group_code": g, "code": c, "name": n, "value": v,
        "sort_order": s, "version": 1, "active": True,
    } for g, c, n, v, s in MASTER_CODES]
    db.execute(MasterCode.__table__.insert(), mc_rows)

    # ── 14. notification_rules (6행 고정) ───────────────────────────────
    nr_rows = [{
        "event_type": event, "threshold": None, "channel": channel,
        "enabled": channel == "system",
    } for event in NOTIFICATION_EVENTS for channel in ("system", "email")]
    db.execute(NotificationRule.__table__.insert(), nr_rows)

    # ── 15. kpi_targets (3지표 × 6개월 = 18행) ──────────────────────────
    kpi_rows = [{
        "kpi_key": key, "period": period,
        "target_value": _d(value, 3),
        "actual_value": None, "actual_updated_at": None,
    } for period in KPI_PERIODS for key, value in KPI_TARGET_VALUES.items()]
    db.execute(KpiTarget.__table__.insert(), kpi_rows)

    # ── 16. process_conditions + condition_history ──────────────────────
    pc_rows = [{
        **row,
        "temp_min": _d(row["temp_min"], 1), "temp_max": _d(row["temp_max"], 1),
        "created_at": dt.datetime(2026, 1, 2, 9, 0),
    } for row in PROCESS_CONDITIONS]
    db.execute(ProcessCondition.__table__.insert(), pc_rows)
    db.flush()

    #  최초 등록 이력 — API 의 `POST /process/conditions` 가 만드는 행과 같은 형태다
    #  (before=null = 신규 등록, ts-types.md §9.4).
    ch_rows = []
    for cond in db.execute(select(ProcessCondition)).scalars().all():
        ch_rows.append({
            "condition_id": cond.id,
            "changed_by": admin_id,
            "before": None,
            "after": {
                "product_code": cond.product_code,
                "temp_min": float(cond.temp_min), "temp_max": float(cond.temp_max),
                "time_min": cond.time_min, "time_max": cond.time_max,
                "speed": float(cond.speed) if cond.speed is not None else None,
                "version": cond.version, "active": cond.active,
            },
            "created_at": cond.created_at,
        })
    db.execute(ConditionHistory.__table__.insert(), ch_rows)

    db.commit()
    return counts(db)


TABLES = [
    Supplier, Lot, Component, Quality, Equipment, MlModel, Alert, User,
    AuditLog, Shipment, Receipt, Claim, ProcessCondition, ConditionHistory,
    NotificationRule, SystemSetting, MasterCode, KpiTarget,
]


def counts(db) -> dict[str, int]:
    return {
        m.__tablename__: int(db.execute(select(func.count()).select_from(m)).scalar_one())
        for m in TABLES
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="고려솔더 18개 테이블 시드 로더")
    parser.add_argument("--counts", action="store_true", help="적재하지 않고 행 수만 출력")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        result = counts(db) if args.counts else seed(db)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    width = max(len(t) for t in result)
    print()
    for table, n in sorted(result.items()):
        flag = "" if n or table == "audit_logs" else "   ← 비어 있다"
        print(f"  {table:<{width}}  {n:>6,}{flag}")
    empty = [t for t, n in result.items() if not n and t != "audit_logs"]
    print()
    print(f"  18개 테이블 중 비어 있는 것: {len(empty)}{' ' + str(empty) if empty else ' (감사로그 제외)'}")
    if not args.counts:
        print(f"  시드 계정 비밀번호: {SEED_PASSWORD}  (개발 전용)")


if __name__ == "__main__":
    main()
