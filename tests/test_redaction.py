"""마스킹 계층 계약 테스트 — `agent-architecture.md` §2.8 · G-6.

> **G-6 허용목록 밖 컬럼이 외부로 나가지 않는다 (§2.8, 테스트로 강제)**

이 파일이 그 "테스트로 강제" 다. 특히 두 가지를 고정한다.

1. **금지 필드가 새는지** — `suppliers.name` · `shipments.customer` · `claims.customer`
2. **새 컬럼이 조용히 통과하는지** — 노출 8테이블에 컬럼이 추가되면
   `test_every_exposed_column_is_classified` 가 **즉시 실패**한다.
   허용할지 차단할지 사람이 분류하기 전에는 통과하지 못한다.
"""
from __future__ import annotations

import datetime as dt
import decimal
import json

import pytest

from src.agent import allowlist as al
from src.agent.redaction import (
    AliasBook,
    RedactionError,
    WireResult,
    assert_wire_safe,
    from_wire,
    leaked_fields,
    to_wire,
)
from src.db.models import (
    Claim,
    Component,
    Lot,
    Quality,
    Receipt,
    Shipment,
    Supplier,
)

MODELS = {
    "receipts": Receipt,
    "components": Component,
    "suppliers": Supplier,
    "lots": Lot,
    "shipments": Shipment,
    "claims": Claim,
    "quality": Quality,
}


# ══════════════════════════════════════════════════════════════════════════
# 🔴 분류 대장 — 새 컬럼이 조용히 통과하면 안 된다 (§2.8.1 P2)
# ══════════════════════════════════════════════════════════════════════════
class TestClassificationLedger:
    def test_models_cover_every_exposed_table(self):
        assert set(MODELS) == set(al.ALL_EXPOSED_TABLES)

    @pytest.mark.parametrize("table", al.ALL_EXPOSED_TABLES)
    def test_every_exposed_column_is_classified(self, table):
        """모든 실 컬럼은 **허용**되거나 **명시적으로 차단**돼 있어야 한다.

        둘 다 아니면 새로 생긴 컬럼이다 → 실패시켜서 분류를 강제한다.
        이 테스트가 없으면 컬럼 추가가 곧 조용한 송출 확대가 된다.
        """
        columns = {c.key for c in MODELS[table].__table__.columns}
        allowed = al.ALLOWLIST[table]
        denied = al.REVIEWED_DENY.get(table, frozenset())
        unclassified = columns - allowed - denied
        assert not unclassified, (
            f"{table} 에 분류되지 않은 컬럼이 있습니다: {sorted(unclassified)}\n"
            f"  → 송출한다면 src/agent/allowlist.py 의 ALLOWLIST['{table}'] 에,\n"
            f"    송출하지 않는다면 REVIEWED_DENY['{table}'] 에 추가하세요."
        )

    @pytest.mark.parametrize("table", al.ALL_EXPOSED_TABLES)
    def test_allowlist_and_denylist_do_not_overlap(self, table):
        overlap = al.ALLOWLIST[table] & al.REVIEWED_DENY.get(table, frozenset())
        assert not overlap, f"{table}: 허용과 차단에 동시에 있는 컬럼 {sorted(overlap)}"

    def test_forbidden_qualified_are_never_allowlisted(self):
        """'절대 금지' 필드가 허용목록에 들어오는 실수를 막는다."""
        for qualified in al.FORBIDDEN_QUALIFIED:
            table, field = qualified.split(".", 1)
            assert field not in al.ALLOWLIST.get(table, frozenset()), (
                f"{qualified} 는 절대 금지인데 허용목록에 있습니다"
            )


# ══════════════════════════════════════════════════════════════════════════
# 금지 필드 누출 — 이 테스트가 실패하면 외부로 실명이 나간다
# ══════════════════════════════════════════════════════════════════════════
def _full_row(table: str) -> dict:
    """실 모델의 **모든 컬럼**을 채운 행. 새 컬럼도 자동으로 포함된다."""
    sample = {
        "id": 7, "lot_id": "LOT-2026-001", "supplier_id": 3,
        "receipt_no": "RCV-00001", "claim_no": "CLM-0058",
        "code": "SUP_A", "name": "공급사 A", "contact": "010-0000-0000",
        "customer": "삼우전자", "reason": "외관 변색 — 고객 담당자 김철수 010-1234-5678",
        "resolution": "재작업 후 재출하", "product": "Sn62 솔더",
        "material": "Sn ingot", "unit": "kg", "status": "accepted",
        "analysis_method": "XRF", "model_used": "gradient_boosting",
        "primary_material": "Sn ingot", "active": True, "passed": True,
        "date": dt.date(2026, 8, 25),
        "created_at": dt.datetime(2026, 8, 25, 10, 0),
        "updated_at": dt.datetime(2026, 8, 25, 10, 0),
        "resolved_at": None,
        "tested_at": dt.datetime(2026, 8, 25, 14, 0),
        "shipped_at": dt.datetime(2026, 8, 26, 10, 0),
    }
    row = {}
    for column in MODELS[table].__table__.columns:
        key = column.key
        row[key] = sample.get(key, decimal.Decimal("62.001"))
    return row


FORBIDDEN_VALUES = ("공급사 A", "010-0000-0000", "삼우전자", "외관 변색", "김철수",
                    "재작업 후 재출하", "RCV-00001", "CLM-0058", "LOT-2026-001", "SUP_A")


@pytest.mark.parametrize("table", al.ALL_EXPOSED_TABLES)
def test_no_forbidden_value_reaches_the_wire(table):
    """실 컬럼을 전부 채운 행을 흘려보내고 **금지 값이 한 글자도 안 나오는지** 본다."""
    book = AliasBook()
    wire = to_wire({table: _full_row(table)}, book)
    dumped = json.dumps(wire.fields, ensure_ascii=False, default=str)
    for value in FORBIDDEN_VALUES:
        assert value not in dumped, f"{table} 에서 금지 값 {value!r} 이 송출됐습니다"
    assert leaked_fields(wire) == []


def test_supplier_name_and_contact_are_dropped():
    book = AliasBook()
    wire = to_wire({"suppliers": {
        "code": "SUP_A", "name": "공급사 A", "contact": "gil@example.com",
        "primary_material": "Sn ingot", "active": True,
    }}, book)
    row = wire.fields["suppliers"]
    assert "name" not in row and "contact" not in row
    assert row["supplier_alias"] == "공급사1"
    assert set(wire.dropped) == {"suppliers.name", "suppliers.contact"}


def test_shipment_customer_is_aliased_not_emitted():
    book = AliasBook()
    wire = to_wire({"shipments": {
        "lot_id": "LOT-2026-001", "customer": "한빛반도체",
        "product": "Sn62 솔더", "quantity": 200, "unit": "kg",
        "shipped_at": dt.datetime(2026, 8, 26, 10, 0),
    }}, book)
    row = wire.fields["shipments"]
    assert "customer" not in row
    assert row["customer_alias"] == "고객사1"
    assert book.real("고객사1") == "한빛반도체"


def test_claim_free_text_reason_is_blocked():
    """§2.8.2 는 `reason` 을 '분류 코드만' 허용했는데 분류 컬럼이 없다.

    없는 컬럼을 지어내지도, 자유서술 원문을 내보내지도 않는다 → 통째로 차단.
    """
    book = AliasBook()
    wire = to_wire({"claims": {
        "lot_id": "LOT-2026-001", "claim_no": "CLM-1", "customer": "삼우전자",
        "reason": "고객 담당자 연락처 010-1234-5678 로 재연락 요청",
        "status": "open", "created_at": dt.datetime(2026, 8, 25, 14, 54),
        "resolved_at": None, "has_resolution": False,
    }}, book)
    assert "reason" not in wire.fields["claims"]
    assert "claims.reason" in wire.dropped


# ══════════════════════════════════════════════════════════════════════════
# 화이트리스트 — 모르는 것은 기본 차단 (§2.8.1 P2)
# ══════════════════════════════════════════════════════════════════════════
class TestDefaultDeny:
    def test_unknown_field_is_dropped(self):
        wire = to_wire({"lots": {"status": "pass", "operator_name": "김철수"}}, AliasBook())
        assert wire.fields["lots"] == {"status": "pass"}
        assert "lots.operator_name" in wire.dropped

    def test_unknown_envelope_key_is_dropped_whole(self):
        wire = to_wire({"users": [{"username": "admin"}], "lots": {"status": "pass"}},
                       AliasBook())
        assert "users" not in wire.fields
        assert "users.*" in wire.dropped

    @pytest.mark.parametrize("table", sorted(al.FORBIDDEN_TABLES))
    def test_forbidden_table_never_passes(self, table):
        """§7.7 T-5 — `users`·`audit_logs`·`system_settings`·`ml_models` 등."""
        wire = to_wire({table: {"anything": 1}}, AliasBook())
        assert table not in wire.fields

    def test_safety_net_catches_allowlisted_secret(self, monkeypatch):
        """허용목록이 **실수로** 비밀값을 허용해도 이름 기반 안전망이 잡는다 (§2.8.3)."""
        monkeypatch.setitem(al.ALLOWLIST, "lots",
                            al.ALLOWLIST["lots"] | {"session_token", "api_key"})
        wire = to_wire({"lots": {"status": "pass", "session_token": "abc",
                                 "api_key": "sk-live-1"}}, AliasBook())
        assert wire.fields["lots"] == {"status": "pass"}
        assert set(wire.dropped) == {"lots.session_token", "lots.api_key"}

    def test_unsupported_type_is_dropped_but_null_survives(self):
        wire = to_wire({"lots": {
            "status": "pass",
            "quality_score": None,                 # 정당한 null — 살아남는다
            "temperature": object(),               # 알 수 없는 타입 — 버린다
        }}, AliasBook())
        assert wire.fields["lots"] == {"status": "pass", "quality_score": None}
        assert "lots.temperature" in wire.dropped

    def test_nan_becomes_null_not_a_number(self):
        wire = to_wire({"suppliers": {"code": "SUP_A", "sn_std": float("nan")}}, AliasBook())
        assert wire.fields["suppliers"]["sn_std"] is None


# ══════════════════════════════════════════════════════════════════════════
# 별칭 왕복 — 가역이어야 한다 (§2.8.1 P3)
# ══════════════════════════════════════════════════════════════════════════
class TestAliasRoundTrip:
    def test_alias_is_stable_and_reversible(self):
        book = AliasBook()
        a1 = book.alias(al.ALIAS_LOT, "LOT-2026-001")
        a2 = book.alias(al.ALIAS_LOT, "LOT-2026-001")
        assert a1 == a2 == "LOT#1"
        assert book.real(a1) == "LOT-2026-001"

    def test_namespaces_do_not_collide(self):
        """`LOT#1` 과 `입고#1` 은 다른 값이다 — 번호를 공유하면 역치환이 깨진다."""
        book = AliasBook()
        lot = book.alias(al.ALIAS_LOT, "LOT-2026-001")
        rcv = book.alias(al.ALIAS_RECEIPT, "RCV-00001")
        assert lot != rcv
        assert book.real(lot) == "LOT-2026-001"
        assert book.real(rcv) == "RCV-00001"

    def test_round_trip_is_lossless_for_many_ids(self):
        book = AliasBook()
        reals = [f"LOT-2026-{i:04d}" for i in range(1, 61)]
        aliases = [book.alias(al.ALIAS_LOT, r) for r in reals]
        answer = " / ".join(aliases)
        assert from_wire(answer, book) == " / ".join(reals)

    def test_longer_alias_wins_over_prefix(self):
        """`LOT#1` 이 `LOT#12` 의 앞부분을 먹으면 안 된다."""
        book = AliasBook()
        for i in range(1, 21):
            book.alias(al.ALIAS_LOT, f"LOT-2026-{i:03d}")
        assert from_wire("LOT#12 를 보라", book) == "LOT-2026-012 를 보라"

    def test_mask_is_the_inverse_of_restore(self):
        """근거 문장(label·detail)에 섞인 원문 식별자도 가릴 수 있어야 한다."""
        book = AliasBook()
        book.alias(al.ALIAS_SUPPLIER, "SUP_A")
        book.alias(al.ALIAS_LOT, "LOT-2026-001")
        masked = book.mask("LOT-2026-001 은 SUP_A 납품분입니다")
        assert masked == "LOT#1 은 공급사1 납품분입니다"
        assert from_wire(masked, book) == "LOT-2026-001 은 SUP_A 납품분입니다"

    def test_none_stays_none(self):
        """없는 것을 지어내지 않는다 — `None` 에 별칭을 붙이지 않는다."""
        assert AliasBook().alias(al.ALIAS_LOT, None) is None

    def test_unknown_alias_kind_raises(self):
        with pytest.raises(RedactionError):
            AliasBook().alias("operator", "홍길동")

    def test_restore_without_aliases_is_identity(self):
        assert from_wire("아무 별칭도 없습니다", AliasBook()) == "아무 별칭도 없습니다"


# ══════════════════════════════════════════════════════════════════════════
# 단일 출구 (§2.8.4)
# ══════════════════════════════════════════════════════════════════════════
class TestSingleExit:
    def test_raw_dict_is_rejected_by_the_adapter_gate(self):
        with pytest.raises(RedactionError):
            assert_wire_safe({"lots": {"status": "pass"}})

    def test_wire_result_passes(self):
        wire = to_wire({"lots": {"status": "pass"}}, AliasBook())
        assert isinstance(wire, WireResult)
        assert assert_wire_safe(wire) is wire

    def test_non_mapping_envelope_raises(self):
        with pytest.raises(RedactionError):
            to_wire([{"status": "pass"}], AliasBook())  # type: ignore[arg-type]


# ══════════════════════════════════════════════════════════════════════════
# 기존 미들웨어와의 관계 (§2.8.3) — **합치지 않았음**을 고정한다
# ══════════════════════════════════════════════════════════════════════════
def test_middleware_redactor_is_reused_not_copied():
    from src.agent import redaction
    from src.api.middleware import _REDACT_KEY_FRAGMENTS

    assert redaction._REDACT_KEY_FRAGMENTS is _REDACT_KEY_FRAGMENTS


def test_middleware_redactor_is_still_blocklist_and_irreversible():
    """미들웨어 계층은 **차단목록·비가역**이다. 이 계층은 허용목록·가역이다.

    두 계층이 같은 성격이 되면 §2.8.3 의 분리 근거가 사라진다.
    """
    from src.api.middleware import _redact

    out = _redact({"password": "x", "note": "y"})
    assert out == {"password": "***", "note": "y"}      # 차단목록: 모르는 키는 통과
    assert AliasBook().real("***") is None              # 비가역: 되돌릴 수 없다
