"""송출 필드 허용목록 — `agent-architecture.md` §2.8.2.

**허용목록이다. 차단목록이 아니다** (§2.8.1 P2). 여기 없는 컬럼은 나가지 않는다.
새 컬럼이 생겨도 기본이 "차단" 이고, `tests/test_redaction.py` 의
`test_every_exposed_column_is_classified` 가 **분류되지 않은 새 컬럼을 즉시 실패**시킨다.

### 저장 위치가 왜 코드 상수인가 (§2.8.4)
`system_settings` 에 두지 않는다 — 런타임에 바뀌면 **보안 경계가 런타임에 바뀐다.**

### 키 구조
`ALLOWLIST[<envelope-key>] = frozenset(허용 필드)`

`<envelope-key>` 는 실 테이블명(`receipts`·`lots`…) 이거나, 도구가 만든 파생값을
담는 의사 테이블(`meta`) 이다. **봉투에 없는 키는 통째로 버린다.**

### 별칭 처리 (§2.8.1 P3)
`ALIAS_FIELDS[<envelope-key>][<field>] = <별칭 종류>`
식별자는 원문이 나가지 않고 `LOT#1` · `공급사1` · `고객사1` 로 치환된다.
치환은 **가역**이다 — 응답에서 역치환한다 (`redaction.from_wire`).
"""
from __future__ import annotations

# ══════════════════════════════════════════════════════════════════════════
# 별칭 종류 — `redaction.AliasBook` 의 네임스페이스
# ══════════════════════════════════════════════════════════════════════════
ALIAS_LOT = "lot"
ALIAS_SUPPLIER = "supplier"
ALIAS_CUSTOMER = "customer"
ALIAS_RECEIPT = "receipt"
ALIAS_CLAIM = "claim"

ALIAS_KINDS: tuple[str, ...] = (
    ALIAS_LOT, ALIAS_SUPPLIER, ALIAS_CUSTOMER, ALIAS_RECEIPT, ALIAS_CLAIM,
)

#: 별칭 표기 서식. `from_wire()` 의 역치환이 이 서식에 의존한다.
#: 종류마다 **네임스페이스를 분리**한다 — 입고번호와 LOT 이 같은 번호를 쓰면
#: 역치환에서 서로를 덮어쓴다.
ALIAS_FORMATS: dict[str, str] = {
    ALIAS_LOT: "LOT#{n}",
    ALIAS_SUPPLIER: "공급사{n}",
    ALIAS_CUSTOMER: "고객사{n}",
    ALIAS_RECEIPT: "입고#{n}",
    ALIAS_CLAIM: "클레임#{n}",
}


# ══════════════════════════════════════════════════════════════════════════
# §2.8.2 필드 단위 허용목록
# ══════════════════════════════════════════════════════════════════════════
ALLOWLIST: dict[str, frozenset[str]] = {
    # ── 입고 Agent (FE-RT-10) ──────────────────────────────────────────
    # `receipts` — 설계서의 `receipt_date` 는 실 컬럼명이 `date` 다.
    #   컬럼명을 지어내지 않고 실제 이름을 쓴다.
    "receipts": frozenset({
        "receipt_no_alias",     # `receipt_no` 원문 금지 → 별칭
        "date", "quantity", "unit", "material", "status",
        "sn_pct", "ag_pct", "cu_pct", "pb_pct",
        "analysis_method",
        "supplier_alias",
    }),
    "components": frozenset({
        "sn", "ag", "cu", "pb",
        "sn_deviation", "ag_deviation", "cu_deviation",
        "date", "analysis_method",
        "lot_alias",
        # 도구가 만든 판정 파생값 (§3.3.3 `component_deviation` 의 "임계 초과 플래그")
        "sn_exceeds", "ag_exceeds", "cu_exceeds", "any_exceeds",
    }),
    "suppliers": frozenset({
        "primary_material", "active",
        "supplier_alias",
        # §2.8.2 가 명시 허용한 집계 통계
        "lot_count", "avg_quality", "pass_rate",
        "sn_mean", "ag_mean", "cu_mean",
        "sn_std", "ag_std", "cu_std",
        "receipt_count", "received_qty",
    }),
    "lots": frozenset({
        "date", "status", "quality_score", "temperature", "time_min",
        "sn_ratio", "ag_ratio", "cu_ratio", "pb_ratio",
        "lot_alias", "supplier_alias",
        # 파생 판정값
        "temp_exceeds_warn",
    }),
    # ── 출하 Agent (FE-RT-20) ──────────────────────────────────────────
    "shipments": frozenset({
        "shipped_at", "quantity", "unit", "product",
        "lot_alias", "customer_alias",
    }),
    "claims": frozenset({
        # ⚠ `reason` 은 **자유서술 원문**이라 허용하지 않는다 (§2.8.2).
        #    설계서가 허용한 것은 "분류 코드만" 인데 `claims` 에 분류 컬럼이 없다.
        #    없는 컬럼을 지어내지 않고, 원문을 내보내지도 않는다 → 통째로 차단.
        "status", "created_at", "resolved_at", "has_resolution",
        # 고객사는 **별칭으로만** 나간다 (§2.8.1 P3). 원문 `customer` 는 절대 금지.
        "lot_alias", "claim_alias", "customer_alias",
    }),
    "quality": frozenset({
        "score", "passed", "tested_at", "predicted_score", "model_used",
        "lot_alias",
        # 파생 판정 근거
        "pass_score", "margin",
    }),
    # ── 의사 테이블 ────────────────────────────────────────────────────
    #: 도구가 만든 스칼라·질의 조건·룰 임계값. 업무 식별자는 담지 않는다.
    "meta": frozenset({
        "tool", "scope", "days", "limit", "truncated", "row_count",
        "date_from", "date_to", "material", "status",
        "pass_score", "warn_score",
        "sn_target", "ag_target", "cu_target",
        "dev_warn_sn", "dev_warn_ag", "dev_warn_cu", "temp_warn_c",
        "min_score", "min_score_source",
        "supplier_alias", "customer_alias", "lot_alias",
        "note", "notes", "verdict",
        # 배합 도구 (FE-RT-15) 질의 조건. 성분 비율은 식별자가 아니다.
        "temperature", "process_time", "model", "supplier",
        "optimization_success", "sn", "ag", "cu", "pb",
    }),
    #: 배합 추천 결과 (FE-RT-15 `recommend_mix`).
    #: 배합비·예상 점수뿐이고 **업무 식별자가 없다** — 공급사도 별칭으로 온다.
    #: `optimization_success` 를 반드시 함께 내보낸다. 이걸 빼면 수렴 실패한
    #: 추천을 LLM 이 성공한 값으로 읽는다 (§5 오류 계약).
    "recommendation": frozenset({
        "sn", "ag", "cu", "pb",
        "predicted_quality", "optimization_success", "iterations", "message",
    }),
    #: 품질 예측 결과 (FE-RT-15 `predict_quality`).
    "prediction": frozenset({
        "predicted_quality", "model_used", "passed",
        "deviation_sn", "deviation_ag", "deviation_cu",
        "rmse", "r2",
    }),
    #: 배합 실적 조회 (`mixing_history`). `lots` 와 같은 필드 집합을 쓴다.
    "lots_mixing": frozenset({
        "lot_alias", "date", "sn_pct", "ag_pct", "cu_pct", "pb_pct",
        "melt_temp_c", "melt_time_min", "quality_score", "status",
    }),
}

#: 별칭 치환 대상 — `<봉투키>.<필드>` → 별칭 종류.
#: 값이 **원문 식별자**로 들어오고 **별칭 필드명**으로 나간다.
#: 예) `{"supplier_code": "SUP_A"}` → `{"supplier_alias": "공급사1"}`
ALIAS_FIELDS: dict[str, dict[str, str]] = {
    "receipts": {
        "supplier_code": ALIAS_SUPPLIER,
        "receipt_no": ALIAS_RECEIPT,
    },
    "components": {"lot_id": ALIAS_LOT},
    "suppliers": {"code": ALIAS_SUPPLIER},
    "lots": {"lot_id": ALIAS_LOT, "supplier_code": ALIAS_SUPPLIER},
    "shipments": {"lot_id": ALIAS_LOT, "customer": ALIAS_CUSTOMER},
    "claims": {"lot_id": ALIAS_LOT, "customer": ALIAS_CUSTOMER, "claim_no": ALIAS_CLAIM},
    "quality": {"lot_id": ALIAS_LOT},
    "meta": {
        "supplier": ALIAS_SUPPLIER,
        "supplier_code": ALIAS_SUPPLIER,
        "customer": ALIAS_CUSTOMER,
        "lot_id": ALIAS_LOT,
    },
}

#: 별칭 필드가 출력에서 갖는 이름. `ALIAS_FIELDS` 원문 필드 → 출력 필드.
ALIAS_OUTPUT_NAMES: dict[str, str] = {
    "supplier_code": "supplier_alias",
    "supplier": "supplier_alias",
    "code": "supplier_alias",
    "customer": "customer_alias",
    "lot_id": "lot_alias",
    "receipt_no": "receipt_no_alias",
    "claim_no": "claim_alias",
}


# ══════════════════════════════════════════════════════════════════════════
# 🔴 절대 금지 — 허용목록에 실수로 들어와도 여기서 한 번 더 막는다
# ══════════════════════════════════════════════════════════════════════════
#: `<테이블>.<컬럼>` 형식. §2.8.2 "송출 금지" 중 **명시적으로 '절대 금지'** 인 것.
FORBIDDEN_QUALIFIED: frozenset[str] = frozenset({
    "suppliers.name",
    "suppliers.contact",
    "shipments.customer",
    "claims.customer",
    "claims.reason",
    "claims.resolution",
})

#: 어느 봉투에서든 이 이름의 필드는 나가지 않는다 (§2.8.2 "항상 금지").
#: 개인 식별정보 · 내부 PK · 재귀 송출.
FORBIDDEN_FIELD_NAMES: frozenset[str] = frozenset({
    "id", "user_id", "supplier_id", "updated_by", "changed_by",
    "password_hash", "email", "username", "contact", "ip_address",
    "name", "customer", "reason", "resolution",
    "prompt_sent", "response_raw",
    "receipt_no", "claim_no",   # 원문 식별자 — 별칭으로만 나간다
})

#: 어느 역할에도 도구로 노출되지 않는 테이블 (§3.3.1 · §7.7 T-5).
#: 봉투 키로 와도 통째로 버린다.
FORBIDDEN_TABLES: frozenset[str] = frozenset({
    "users", "audit_logs", "system_settings", "ml_models",
    "notification_rules", "condition_history", "kpi_targets",
    "master_codes", "alerts", "equipment", "process_conditions",
})


# ══════════════════════════════════════════════════════════════════════════
# 분류 대장 — "새 컬럼이 조용히 통과"를 막는 장치
# ══════════════════════════════════════════════════════════════════════════
#: 노출 8테이블의 실 컬럼 중 **의도적으로 송출하지 않는 것**.
#: `ALLOWLIST` 도 여기도 아닌 컬럼이 모델에 생기면 테스트가 실패한다.
#: → 새 컬럼을 추가한 사람이 **반드시 분류하도록** 강제한다.
REVIEWED_DENY: dict[str, frozenset[str]] = {
    "receipts": frozenset({"id", "supplier_id", "receipt_no", "created_at"}),
    "components": frozenset({"id", "lot_id", "created_at"}),
    "suppliers": frozenset({"id", "code", "name", "contact", "created_at"}),
    "lots": frozenset({"id", "lot_id", "supplier_id", "created_at", "updated_at"}),
    "shipments": frozenset({"id", "lot_id", "customer"}),
    "claims": frozenset({"id", "lot_id", "claim_no", "customer", "reason", "resolution"}),
    "quality": frozenset({"id", "lot_id"}),
}

#: 도구가 읽을 수 있는 테이블 — §3.3.1 화면별 화이트리스트.
EXPOSED_TABLES: dict[str, tuple[str, ...]] = {
    "receiving": ("receipts", "components", "suppliers", "lots"),
    "shipping": ("shipments", "claims", "quality", "lots"),
    # 배합(FE-RT-15)은 `lots` 만 읽는다. `ml_models` 는 T-5 금지다 —
    # 예측·추천은 테이블이 아니라 **모델 함수**를 부르는 것이라 여기 없다.
    "mixing": ("lots",),
}

#: 위 두 스코프의 합집합 — 분류 대장 테스트의 대상.
ALL_EXPOSED_TABLES: tuple[str, ...] = (
    "receipts", "components", "suppliers", "lots", "shipments", "claims", "quality",
)


__all__ = [
    "ALIAS_CLAIM",
    "ALIAS_CUSTOMER",
    "ALIAS_RECEIPT",
    "ALIAS_FIELDS",
    "ALIAS_FORMATS",
    "ALIAS_KINDS",
    "ALIAS_LOT",
    "ALIAS_OUTPUT_NAMES",
    "ALIAS_SUPPLIER",
    "ALLOWLIST",
    "ALL_EXPOSED_TABLES",
    "EXPOSED_TABLES",
    "FORBIDDEN_FIELD_NAMES",
    "FORBIDDEN_QUALIFIED",
    "FORBIDDEN_TABLES",
    "REVIEWED_DENY",
]
