"""쿼리 카탈로그 계약 테스트 — `agent-architecture.md` §3.3 · §7.7 · §7.11.

**실 DB(시드 2,000 LOT)로 실제 값을 검증한다.** 기대값을 상수로 박지 않고
같은 질문을 **원시 SQL 로 다시 물어 교차 확인**한다 — 도구가 조인을 틀리면
두 숫자가 갈린다. 그게 §3.3.2 가 자유 Text-to-SQL 을 버린 이유다.

DB 접속이 안 되면 전체를 `skip` 한다 (기존 `test_api_contract.py` 와 같은 규약).
"""
from __future__ import annotations

import datetime as dt
import json
import re

import pytest
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from src.agent import tools
from src.agent.redaction import AliasBook, leaked_fields, to_wire
from src.agent.tools import (
    ToolArgumentError,
    ToolPermissionError,
    ToolScopeError,
)
from src.agent.tools._base import MAX_ROWS
from src.api import settings_store as ss


# ══════════════════════════════════════════════════════════════════════════
# 픽스처
# ══════════════════════════════════════════════════════════════════════════
@pytest.fixture(scope="module")
def db():
    from src.db.session import SessionLocal

    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
    except OperationalError:
        session.close()
        pytest.skip("PostgreSQL 미기동 — DB 테스트를 건너뜁니다")
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(scope="module")
def any_lot(db) -> str:
    """성분·품질·출하가 모두 달린 LOT 하나."""
    row = db.execute(text("""
        SELECT l.lot_id FROM lots l
        JOIN components c ON c.lot_id = l.id
        JOIN quality    q ON q.lot_id = l.id
        JOIN shipments  s ON s.lot_id = l.id
        LIMIT 1
    """)).first()
    if row is None:
        pytest.skip("시드 데이터에 전 구간이 연결된 LOT 이 없습니다")
    return row[0]


# ══════════════════════════════════════════════════════════════════════════
# 카탈로그 구성 — §3.3.3 이 정한 도구 수
# ══════════════════════════════════════════════════════════════════════════
class TestCatalogShape:
    def test_receiving_has_exactly_five_tools(self):
        assert len(tools.SCOPE_TOOLS["receiving"]) == 5

    def test_shipping_has_exactly_six_tools(self):
        assert len(tools.SCOPE_TOOLS["shipping"]) == 6

    def test_tool_names_match_the_design(self):
        assert set(tools.SCOPE_TOOLS["receiving"]) == {
            "receipt_history", "supplier_deviation_stats", "material_stock",
            "lot_trace_upstream", "component_deviation",
        }
        assert set(tools.SCOPE_TOOLS["shipping"]) == {
            "shipment_history", "lot_quality_summary", "lot_trace_full",
            "claim_search", "lot_match_for_customer", "shipment_due_risk",
        }

    def test_every_spec_scope_matches_its_bucket(self):
        for scope, names in tools.SCOPE_TOOLS.items():
            for name in names:
                assert tools.CATALOG[name].scope == scope

    def test_required_args_are_declared_in_args(self):
        for spec in tools.CATALOG.values():
            assert set(spec.required) <= set(spec.args), spec.name

    def test_tools_layer_does_not_import_llm_machinery(self):
        """도구는 **LLM 을 모른다.** 프롬프트·프로바이더를 import 하면 실패한다."""
        import src.agent.tools.receiving as r
        import src.agent.tools.shipping as s

        banned = ("openai", "anthropic", "llm", "prompt", "provider", "httpx", "requests")
        for module in (r, s, tools):
            names = {n.lower() for n in vars(module)}
            assert not (names & set(banned)), module.__name__


# ══════════════════════════════════════════════════════════════════════════
# 🔴 §7.7 권한 — Agent 가 RBAC 우회 통로가 되면 안 된다
# ══════════════════════════════════════════════════════════════════════════
class TestScopeAndRole:
    def test_sales_cannot_reach_manufacturing_data(self, db):
        """§7.7 이 지목한 **최대 보안 위험** 그 자체.

        `sales` 사용자가 *"공급사별 성분 편차 알려줘"* 로 입고 도구에 도달하면 안 된다.
        """
        with pytest.raises(ToolPermissionError):
            tools.run(db, "supplier_deviation_stats", scope="receiving", role="sales")

    def test_sales_gets_no_receiving_tools_at_all(self):
        assert tools.tools_for("receiving", "sales") == ()

    def test_manufacture_cannot_reach_shipping_data(self, db):
        with pytest.raises(ToolPermissionError):
            tools.run(db, "claim_search", scope="shipping", role="manufacture",
                      date_from="2026-08-01", date_to="2026-08-26")

    def test_cross_scope_call_is_blocked_even_for_admin(self, db):
        """T-1 화면 스코프 — 출하 화면에서 입고 도구를 부를 수 없다. 역할과 무관하다."""
        with pytest.raises(ToolScopeError):
            tools.run(db, "supplier_deviation_stats", scope="shipping", role="admin")

    def test_unknown_tool_is_scope_error_not_attribute_error(self, db):
        with pytest.raises(ToolScopeError):
            tools.run(db, "drop_table", scope="receiving", role="admin")

    def test_unknown_role_is_rejected(self, db):
        with pytest.raises(ToolPermissionError):
            tools.run(db, "material_stock", scope="receiving", role="root")

    def test_unknown_scope_is_rejected(self, db):
        with pytest.raises(ToolScopeError):
            tools.run(db, "material_stock", scope="mixing", role="admin")

    def test_permission_error_is_distinct_from_unanswerable(self, db):
        """§C-4 — 권한 없음은 '답할 수 없음'과 다르다. 타입으로 구분된다."""
        with pytest.raises(ToolPermissionError):
            tools.run(db, "component_deviation", scope="receiving", role="sales",
                      lot_id="LOT-2026-001")

    def test_role_scopes_cover_all_five_roles(self):
        from src.api.deps import USER_ROLES

        assert set(tools.ROLE_SCOPES) == set(USER_ROLES)


# ══════════════════════════════════════════════════════════════════════════
# 인자 — 조용히 기본값으로 채우지 않는다 (§C-5)
# ══════════════════════════════════════════════════════════════════════════
class TestArguments:
    def test_missing_date_range_raises_instead_of_defaulting(self, db):
        with pytest.raises(ToolArgumentError):
            tools.run(db, "receipt_history", scope="receiving", role="admin",
                      supplier="SUP_A")

    def test_missing_customer_raises(self, db):
        with pytest.raises(ToolArgumentError):
            tools.run(db, "lot_match_for_customer", scope="shipping", role="sales")

    def test_unknown_argument_is_rejected(self, db):
        with pytest.raises(ToolArgumentError):
            tools.run(db, "supplier_deviation_stats", scope="receiving", role="admin",
                      sql="DROP TABLE lots")

    def test_reversed_date_range_raises(self, db):
        with pytest.raises(ToolArgumentError):
            tools.run(db, "receipt_history", scope="receiving", role="admin",
                      date_from="2026-08-26", date_to="2026-08-01")

    def test_bad_date_format_raises(self, db):
        with pytest.raises(ToolArgumentError):
            tools.run(db, "receipt_history", scope="receiving", role="admin",
                      date_from="2026/08/01", date_to="2026-08-26")

    def test_bad_claim_status_raises(self, db):
        with pytest.raises(ToolArgumentError):
            tools.run(db, "claim_search", scope="shipping", role="sales",
                      date_from="2026-08-01", date_to="2026-08-26", status="닫힘")

    def test_statement_timeout_is_actually_applied(self, db):
        """§3.3.3 실행 타임아웃 3초 — **정말 걸렸는지** 확인한다.

        회귀 방지: `SET LOCAL ... = :ms` 는 PostgreSQL 문법 오류다(`SET` 은 바인드
        파라미터를 받지 않는다). 예외를 롤백으로 삼키는 바람에 타임아웃이
        **한 번도 적용되지 않은 채** 조용히 통과하던 버그가 있었다.
        """
        from src.agent.tools._base import STATEMENT_TIMEOUT_MS, apply_statement_timeout

        db.rollback()
        apply_statement_timeout(db)
        assert db.execute(text("SHOW statement_timeout")).scalar_one() == "3s"
        assert STATEMENT_TIMEOUT_MS == 3000
        db.rollback()

    def test_timeout_survives_a_savepoint_boundary(self, db):
        """타임아웃 적용이 호출자의 세이브포인트를 깨뜨리면 안 된다."""
        savepoint = db.begin_nested()
        tools.run(db, "supplier_deviation_stats", scope="receiving", role="admin", days=30)
        savepoint.rollback()   # 여기서 ResourceClosedError 가 나면 회귀다

    def test_limit_is_capped_at_fifty(self, db):
        r = tools.run(db, "receipt_history", scope="receiving", role="admin",
                      date_from="2024-01-01", date_to="2030-01-01", limit=9999)
        assert r.args["limit"] == MAX_ROWS
        assert len(r.result["receipts"]) <= MAX_ROWS
        assert r.result["meta"]["truncated"] is True
        assert any("상위" in n for n in r.notes)


# ══════════════════════════════════════════════════════════════════════════
# 입고 도구 — 실 DB 교차 확인
# ══════════════════════════════════════════════════════════════════════════
class TestReceivingTools:
    def test_receipt_history_matches_raw_sql(self, db):
        r = tools.run(db, "receipt_history", scope="receiving", role="manufacture",
                      date_from="2026-01-01", date_to="2026-08-24", supplier="SUP_A")
        expected = db.execute(text("""
            SELECT count(*) FROM receipts r JOIN suppliers s ON r.supplier_id = s.id
            WHERE s.code = 'SUP_A' AND r.date BETWEEN :a AND :b
        """), {"a": dt.date(2026, 1, 1), "b": dt.date(2026, 8, 24)}).scalar_one()
        returned = len(r.result["receipts"])
        assert returned == min(expected, MAX_ROWS)
        assert r.citation.count == returned
        assert all(row["supplier_code"] == "SUP_A" for row in r.result["receipts"])

    def test_receipt_history_respects_material_filter(self, db):
        r = tools.run(db, "receipt_history", scope="receiving", role="admin",
                      date_from="2025-01-01", date_to="2026-08-24", material="Sn ingot")
        assert r.result["receipts"], "시드에 Sn ingot 입고가 있어야 한다"
        assert {row["material"] for row in r.result["receipts"]} == {"Sn ingot"}

    def test_supplier_deviation_stats_matches_raw_sql(self, db):
        """공급사별 편차 — **psql 로 교차 확인한 것과 같은 SQL** 로 다시 센다."""
        r = tools.run(db, "supplier_deviation_stats", scope="receiving",
                      role="quality", days=90)
        pass_score = ss.get(db, ss.K_PASS_SCORE)

        expected_lots = {
            row[0]: (row[1], row[2], row[3])
            for row in db.execute(text("""
                SELECT s.code, count(l.id),
                       round(avg(l.quality_score), 2),
                       round(count(l.id) FILTER (WHERE l.quality_score >= :p)::numeric
                             / nullif(count(l.quality_score), 0) * 100, 2)
                FROM suppliers s JOIN lots l ON l.supplier_id = s.id
                WHERE l.date >= current_date - :d AND l.date <= current_date
                GROUP BY s.code
            """), {"p": pass_score, "d": 90}).all()
        }
        expected_comp = {
            row[0]: (row[1], row[2])
            for row in db.execute(text("""
                SELECT s.code, round(avg(c.sn)::numeric, 3),
                       round(stddev_samp(c.sn)::numeric, 4)
                FROM components c
                JOIN lots l ON c.lot_id = l.id
                JOIN suppliers s ON l.supplier_id = s.id
                WHERE l.date >= current_date - :d AND l.date <= current_date
                GROUP BY s.code
            """), {"d": 90}).all()
        }

        assert expected_lots, "최근 90일 LOT 이 있어야 의미 있는 검증이다"
        for row in r.result["suppliers"]:
            code = row["code"]
            if code not in expected_lots:
                continue
            lot_count, avg_q, pass_rate = expected_lots[code]
            assert row["lot_count"] == lot_count
            assert row["avg_quality"] == pytest.approx(float(avg_q), abs=0.01)
            assert row["pass_rate"] == pytest.approx(float(pass_rate), abs=0.01)
            sn_mean, sn_std = expected_comp[code]
            assert row["sn_mean"] == pytest.approx(float(sn_mean), abs=0.001)
            assert row["sn_std"] == pytest.approx(float(sn_std), abs=0.0001)

    def test_supplier_stats_reports_null_not_zero_when_no_sample(self, db):
        """표본이 없으면 `pass_rate` 는 **`null`** 이다. `0%` 와 구분된다 (§C-7)."""
        r = tools.run(db, "supplier_deviation_stats", scope="receiving",
                      role="admin", days=1)
        for row in r.result["suppliers"]:
            if row["lot_count"] == 0:
                assert row["pass_rate"] is None
                assert row["avg_quality"] is None

    def test_component_deviation_flags_match_settings_thresholds(self, db, any_lot):
        r = tools.run(db, "component_deviation", scope="receiving", role="quality",
                      lot_id=any_lot)
        meta = r.result["meta"]
        assert meta["dev_warn_sn"] == ss.get(db, ss.K_DEV_SN)
        assert meta["dev_warn_ag"] == ss.get(db, ss.K_DEV_AG)
        assert meta["dev_warn_cu"] == ss.get(db, ss.K_DEV_CU)
        for row in r.result["components"]:
            assert row["sn_exceeds"] == (abs(row["sn_deviation"]) > meta["dev_warn_sn"])
            assert row["ag_exceeds"] == (abs(row["ag_deviation"]) > meta["dev_warn_ag"])
            assert row["cu_exceeds"] == (abs(row["cu_deviation"]) > meta["dev_warn_cu"])
            assert row["any_exceeds"] == (
                row["sn_exceeds"] or row["ag_exceeds"] or row["cu_exceeds"]
            )

    def test_component_deviation_uses_stored_deviation_not_recomputed(self, db, any_lot):
        """화면과 Agent 가 다른 숫자를 말하지 않도록 저장된 컬럼을 그대로 쓴다."""
        r = tools.run(db, "component_deviation", scope="receiving", role="admin",
                      lot_id=any_lot)
        stored = db.execute(text("""
            SELECT c.sn_deviation FROM components c JOIN lots l ON c.lot_id = l.id
            WHERE l.lot_id = :k ORDER BY c.date DESC, c.id DESC LIMIT 1
        """), {"k": any_lot}).scalar_one()
        assert r.result["components"][0]["sn_deviation"] == pytest.approx(float(stored))

    def test_lot_trace_upstream_returns_supplier_and_components(self, db, any_lot):
        r = tools.run(db, "lot_trace_upstream", scope="receiving", role="admin",
                      lot_id=any_lot)
        expected_code = db.execute(text("""
            SELECT s.code FROM lots l JOIN suppliers s ON l.supplier_id = s.id
            WHERE l.lot_id = :k
        """), {"k": any_lot}).scalar_one()
        assert r.result["suppliers"]["code"] == expected_code
        assert r.result["lots"]["lot_id"] == any_lot
        assert r.result["components"]

    def test_lot_trace_upstream_states_what_it_cannot_do(self, db, any_lot):
        """`receipts` ↔ `lots` FK 가 없다는 사실을 표준 문구로 밝힌다 (§C-2.3)."""
        from src.agent.tools.receiving import UPSTREAM_LIMIT_NOTE

        r = tools.run(db, "lot_trace_upstream", scope="receiving", role="admin",
                      lot_id=any_lot)
        assert UPSTREAM_LIMIT_NOTE in r.notes
        assert "receipts" not in r.result


# ══════════════════════════════════════════════════════════════════════════
# 출하 도구 — 실 DB 교차 확인
# ══════════════════════════════════════════════════════════════════════════
class TestShippingTools:
    def test_shipment_history_matches_raw_sql(self, db):
        r = tools.run(db, "shipment_history", scope="shipping", role="sales",
                      date_from="2026-08-01", date_to="2026-08-26")
        expected = db.execute(text("""
            SELECT count(*) FROM shipments
            WHERE shipped_at >= :a AND shipped_at <= :b
        """), {"a": dt.datetime(2026, 8, 1), "b": dt.datetime(2026, 8, 26, 23, 59, 59)}
        ).scalar_one()
        assert len(r.result["shipments"]) == min(expected, MAX_ROWS)

    def test_shipment_history_has_no_status_argument(self):
        """`shipments` 에 상태 컬럼이 없다. 없는 인자를 있는 척 노출하지 않는다."""
        assert "status" not in tools.CATALOG["shipment_history"].args

    def test_lot_quality_summary_uses_settings_pass_score(self, db, any_lot):
        r = tools.run(db, "lot_quality_summary", scope="shipping", role="sales",
                      lot_id=any_lot)
        pass_score = float(ss.get(db, ss.K_PASS_SCORE))
        assert r.result["meta"]["pass_score"] == pass_score
        for row in r.result["quality"]:
            assert row["margin"] == pytest.approx(row["score"] - pass_score, abs=0.01)
            assert row["passed"] == (row["score"] >= pass_score)
        assert "합격선" in r.result["meta"]["verdict"]

    def test_pass_score_is_not_hardcoded(self, db, any_lot):
        """🔴 하드코딩 방지 — `system_settings` 를 바꾸면 판정 근거가 따라 바뀐다.

        **커밋하지 않고 롤백**한다. 실 데이터를 건드리지 않는다.
        """
        original = ss.get(db, ss.K_PASS_SCORE)
        savepoint = db.begin_nested()
        try:
            ss.upsert(db, ss.K_PASS_SCORE, 88.0)
            db.flush()
            r = tools.run(db, "lot_quality_summary", scope="shipping", role="admin",
                          lot_id=any_lot)
            assert r.result["meta"]["pass_score"] == 88.0
            row = r.result["quality"][0]
            assert row["margin"] == pytest.approx(row["score"] - 88.0, abs=0.01)
        finally:
            savepoint.rollback()
        assert ss.get(db, ss.K_PASS_SCORE) == original

    def test_lot_trace_full_covers_every_stage_that_exists(self, db, any_lot):
        r = tools.run(db, "lot_trace_full", scope="shipping", role="quality",
                      lot_id=any_lot)
        assert set(r.result) >= {"suppliers", "lots", "components", "quality",
                                 "shipments", "claims", "meta"}
        expected_ships = db.execute(text("""
            SELECT count(*) FROM shipments s JOIN lots l ON s.lot_id = l.id
            WHERE l.lot_id = :k
        """), {"k": any_lot}).scalar_one()
        assert len(r.result["shipments"]) == expected_ships
        assert r.citation.count == (
            1 + len(r.result["components"]) + len(r.result["quality"])
            + len(r.result["shipments"]) + len(r.result["claims"])
        )

    def test_claim_search_matches_raw_sql(self, db):
        r = tools.run(db, "claim_search", scope="shipping", role="sales",
                      date_from="2025-01-01", date_to="2026-12-31", status="open")
        expected = db.execute(text("""
            SELECT count(*) FROM claims
            WHERE status = 'open' AND created_at >= :a AND created_at <= :b
        """), {"a": dt.datetime(2025, 1, 1), "b": dt.datetime(2026, 12, 31, 23, 59, 59)}
        ).scalar_one()
        assert len(r.result["claims"]) == min(expected, MAX_ROWS)
        assert {c["status"] for c in r.result["claims"]} <= {"open"}

    def test_lot_match_respects_min_score_and_excludes_shipped(self, db):
        r = tools.run(db, "lot_match_for_customer", scope="shipping", role="sales",
                      customer="CUST-A", min_score=95.0, limit=10)
        assert r.result["meta"]["min_score_source"] == "caller"
        shipped = {row[0] for row in db.execute(text("""
            SELECT l.lot_id FROM shipments s JOIN lots l ON s.lot_id = l.id
        """)).all()}
        for row in r.result["lots"]:
            assert row["quality_score"] >= 95.0
            assert row["lot_id"] not in shipped

    def test_lot_match_default_floor_is_the_pass_score_and_says_so(self, db):
        """기본값을 **조용히** 쓰지 않는다 — 출처를 함께 낸다 (§C-5)."""
        r = tools.run(db, "lot_match_for_customer", scope="shipping", role="admin",
                      customer="CUST-A", limit=5)
        assert r.result["meta"]["min_score"] == float(ss.get(db, ss.K_PASS_SCORE))
        assert r.result["meta"]["min_score_source"] == "quality.pass_score"

    def test_unknown_customer_says_so_instead_of_pretending(self, db):
        r = tools.run(db, "lot_match_for_customer", scope="shipping", role="sales",
                      customer="존재하지않는고객사", limit=5)
        assert any("과거 출하 이력이 없어" in n for n in r.notes)


# ══════════════════════════════════════════════════════════════════════════
# 근거 계약 — §7.11.3 "건수 없는 데이터 근거는 근거로 세지 않는다"
# ══════════════════════════════════════════════════════════════════════════
class TestCitations:
    ANSWERABLE = [
        ("receiving", "receipt_history",
         dict(date_from="2026-08-01", date_to="2026-08-24")),
        ("receiving", "supplier_deviation_stats", dict(days=90)),
        ("shipping", "shipment_history",
         dict(date_from="2026-08-01", date_to="2026-08-26")),
        ("shipping", "claim_search",
         dict(date_from="2026-08-01", date_to="2026-08-26")),
        ("shipping", "lot_match_for_customer", dict(customer="CUST-A", limit=5)),
    ]

    @pytest.mark.parametrize("scope,name,kwargs", ANSWERABLE)
    def test_every_answerable_tool_returns_qualifying_evidence(self, db, scope, name, kwargs):
        r = tools.run(db, name, scope=scope, role="admin", **kwargs)
        assert r.citation is not None
        assert r.citation.kind == "data"
        assert r.citation.count is not None, "count 가 null 이면 근거가 아니다 (§7.11.3)"
        assert r.citation.qualifies
        assert r.has_evidence
        assert r.citation.label and r.citation.link

    @pytest.mark.parametrize("scope,name,kwargs", ANSWERABLE)
    def test_citation_kind_vocabulary_is_user_facing(self, db, scope, name, kwargs):
        """§7.12 — `kind` 는 `data`/`doc`/`model`. `sql` 같은 구현 용어를 쓰지 않는다."""
        r = tools.run(db, name, scope=scope, role="admin", **kwargs)
        assert r.citation.kind in ("data", "doc", "model")

    def test_zero_rows_is_evidence_not_an_error(self, db):
        """🔴 **`count: 0` 은 유효한 결과다.** '해당 기간 클레임 0건' 은 사실이다 (§C-2.4)."""
        r = tools.run(db, "claim_search", scope="shipping", role="sales",
                      date_from="1999-01-01", date_to="1999-12-31")
        assert r.result["claims"] == []
        assert r.citation is not None
        assert r.citation.count == 0
        assert r.citation.qualifies is True
        assert r.has_evidence is True
        assert r.unanswerable is None

    def test_missing_lot_is_zero_rows_not_unanswerable(self, db):
        r = tools.run(db, "lot_quality_summary", scope="shipping", role="admin",
                      lot_id="LOT-9999-999")
        assert r.citation.count == 0
        assert r.unanswerable is None

    def test_unanswerable_has_no_citation(self, db):
        """근거가 아닌 것은 `count` 가 `null` 인 경우다 — 그때 근거를 만들지 않는다."""
        for scope, name in (("receiving", "material_stock"),
                            ("shipping", "shipment_due_risk")):
            r = tools.run(db, name, scope=scope, role="admin")
            assert r.citation is None
            assert r.has_evidence is False
            assert r.unanswerable is not None
            assert r.result == {}


# ══════════════════════════════════════════════════════════════════════════
# [X] 답할 수 없음 — §C-2.3 "숫자를 하나도 넣지 않는다"
# ══════════════════════════════════════════════════════════════════════════
class TestUnanswerable:
    def test_material_stock_says_it_cannot_answer(self, db):
        r = tools.run(db, "material_stock", scope="receiving", role="manufacture",
                      material="Sn ingot")
        assert r.unanswerable["topic"] == "inventory_balance"
        assert r.unanswerable["message"].startswith("원재료 재고 잔량은 답할 수 없습니다")

    def test_due_risk_says_it_cannot_answer(self, db):
        r = tools.run(db, "shipment_due_risk", scope="shipping", role="sales", days=14)
        assert r.unanswerable["topic"] == "due_date_risk"
        assert "납기 및 지연 위험은 답할 수 없습니다" in r.unanswerable["message"]

    @pytest.mark.parametrize("scope,name", [("receiving", "material_stock"),
                                            ("shipping", "shipment_due_risk")])
    def test_message_contains_no_digits(self, db, scope, name):
        """숫자가 들어가는 순간 그것이 답으로 읽힌다 (§C-2.3)."""
        r = tools.run(db, name, scope=scope, role="admin")
        assert not re.search(r"\d", r.unanswerable["message"])

    @pytest.mark.parametrize("scope,name", [("receiving", "material_stock"),
                                            ("shipping", "shipment_due_risk")])
    def test_message_offers_an_alternative_screen(self, db, scope, name):
        """'대신 무엇이 가능한지'를 반드시 붙인다 — 실재하는 라우트로만."""
        r = tools.run(db, name, scope=scope, role="admin")
        assert "/receiving/history" in r.unanswerable["message"] or \
               "/shipping/list" in r.unanswerable["message"]

    def test_always_unanswerable_tools_are_flagged_in_the_catalog(self):
        flagged = {n for n, s in tools.CATALOG.items() if s.always_unanswerable}
        assert flagged == {"material_stock", "shipment_due_risk"}


# ══════════════════════════════════════════════════════════════════════════
# 도구 → 마스킹 통합 — 실 데이터가 실제로 안 새는지
# ══════════════════════════════════════════════════════════════════════════
class TestToolOutputSurvivesRedaction:
    CASES = [
        ("receiving", "receipt_history",
         dict(date_from="2026-01-01", date_to="2026-08-24")),
        ("receiving", "supplier_deviation_stats", dict(days=90)),
        ("shipping", "shipment_history",
         dict(date_from="2026-08-01", date_to="2026-08-26")),
        ("shipping", "claim_search",
         dict(date_from="2025-01-01", date_to="2026-12-31")),
        ("shipping", "lot_match_for_customer", dict(customer="CUST-A", limit=10)),
        # 🔴 배합 도구가 이 목록에 없어서 `mixing_history` 가 `Lot.sn_pct` 라는
        #    없는 컬럼을 읽고 있는 것을 아무도 못 잡았다 (AttributeError → 500).
        #    도구를 추가하면 여기에도 추가한다 — 실행과 마스킹을 함께 본다.
        ("mixing", "mixing_history",
         dict(date_from="2024-01-01", date_to="2026-12-31", limit=10)),
    ]

    @pytest.fixture(scope="module")
    @staticmethod
    def secrets(db):
        """DB 에 실재하는 **절대 금지 값**들 — 이게 송출문에 있으면 실패다."""
        names = [r[0] for r in db.execute(text("SELECT name FROM suppliers")).all()]
        customers = [r[0] for r in db.execute(
            text("SELECT DISTINCT customer FROM shipments")).all()]
        reasons = [r[0] for r in db.execute(
            text("SELECT DISTINCT reason FROM claims LIMIT 20")).all()]
        return [v for v in (*names, *customers, *reasons) if v]

    @pytest.mark.parametrize("scope,name,kwargs", CASES)
    def test_no_forbidden_value_survives_to_wire(self, db, secrets, scope, name, kwargs):
        r = tools.run(db, name, scope=scope, role="admin", **kwargs)
        wire = to_wire(r.result, AliasBook())
        dumped = json.dumps(wire.fields, ensure_ascii=False, default=str)
        for value in secrets:
            assert value not in dumped, f"{name}: 금지 값 {value!r} 이 송출됐습니다"
        assert leaked_fields(wire) == []

    @pytest.mark.parametrize("scope,name,kwargs", CASES)
    def test_real_identifiers_are_replaced_by_aliases(self, db, scope, name, kwargs):
        r = tools.run(db, name, scope=scope, role="admin", **kwargs)
        wire = to_wire(r.result, AliasBook())
        dumped = json.dumps(wire.fields, ensure_ascii=False, default=str)
        assert "LOT-20" not in dumped
        assert "SUP_" not in dumped
        assert "RCV-" not in dumped
        assert "CLM-" not in dumped

    def test_answer_aliases_restore_to_real_identifiers(self, db, any_lot):
        """왕복 — 별칭으로 물어보고, 답에 실명을 되돌린다."""
        from src.agent.redaction import from_wire

        book = AliasBook()
        r = tools.run(db, "lot_trace_full", scope="shipping", role="admin", lot_id=any_lot)
        wire = to_wire(r.result, book)
        alias = wire.fields["lots"]["lot_alias"]
        assert alias.startswith("LOT#")
        assert from_wire(f"{alias} 은 정상입니다", book) == f"{any_lot} 은 정상입니다"

    def test_citation_text_can_be_masked_before_it_leaves(self, db):
        """근거 문장에 섞인 식별자도 가릴 수 있어야 한다."""
        book = AliasBook()
        r = tools.run(db, "supplier_deviation_stats", scope="receiving",
                      role="admin", days=90)
        to_wire(r.result, book)
        masked = book.mask(r.citation.detail)
        assert "SUP_" not in masked
        assert "공급사1" in masked


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-41 추천 이력 적재 — `agent_recommendations` (§6.9 · CR-DB-008)
#
# 오케스트레이터는 `recommend_mix` 의 **도구 출력 원본**에서 배합비를 꺼내
# 이력에 적재한다. 답변 텍스트를 파싱하지 않는다 — 그러면 LLM 표현이 바뀌는
# 날 이력이 조용히 비어버린다. 그 계약을 여기서 못박는다.
# ══════════════════════════════════════════════════════════════════════════
class TestRecommendationHistoryWiring:
    #: `orchestrator._run` 과 `agents._ask` 가 실제로 읽는 키들
    REQUIRED_KEYS = {"sn", "ag", "cu", "pb", "predicted_quality", "optimization_success"}

    def test_recommend_mix_exposes_the_keys_the_history_reads(self, db):
        try:
            r = tools.run(db, "recommend_mix", scope="mixing", role="admin",
                          temperature=250, process_time=45, supplier="SUP_A")
        except Exception as exc:  # noqa: BLE001 — 아티팩트가 없는 환경
            pytest.skip(f"배합 모델을 부를 수 없다: {exc}")

        rec = r.result["recommendation"]
        assert self.REQUIRED_KEYS <= set(rec)
        # 도구 인자도 이력의 입력 조건 컬럼으로 간다
        assert {"temperature", "process_time", "supplier", "model"} <= set(r.args)

    def test_record_writes_a_row(self, db):
        from src.api import recommendation_log
        from src.db.models import AgentRecommendation

        row = recommendation_log.record(
            db, source=recommendation_log.SOURCE_AGENT,
            ratios={"sn": 62.0, "ag": 3.0, "cu": 0.5, "pb": 34.5},
            predicted_quality=94.94, optimization_success=True,
            model_name="gradient_boosting", temperature=250, process_time=45,
            supplier="SUP_A",
        )
        assert row is not None
        try:
            saved = db.get(AgentRecommendation, row.id)
            assert float(saved.rec_sn) == 62.0
            assert saved.applied_lot_id is None
        finally:
            db.delete(row)
            db.commit()

    def test_incomplete_ratios_are_not_recorded(self, db):
        """🔴 빈 값을 0 으로 채우면 "Pb 0% 배합" 이라는 없던 추천이 이력에 생긴다."""
        from src.api import recommendation_log

        assert recommendation_log.record(
            db, source=recommendation_log.SOURCE_AGENT,
            ratios={"sn": 62.0, "ag": 3.0, "cu": 0.5},
            predicted_quality=None, optimization_success=False,
        ) is None

    def test_failed_optimization_is_still_recorded(self, db):
        """수렴 실패를 기록에서 빼면 "AI 추천은 늘 수렴한다" 로 읽힌다 (§5)."""
        from src.api import recommendation_log

        row = recommendation_log.record(
            db, source=recommendation_log.SOURCE_API,
            ratios={"sn": 62.0, "ag": 3.0, "cu": 0.5, "pb": 34.5},
            predicted_quality=None, optimization_success=False,
        )
        assert row is not None
        try:
            assert row.optimization_success is False
        finally:
            db.delete(row)
            db.commit()


# ══════════════════════════════════════════════════════════════════════════
# `lots` 봉투의 키 이름 — 도구가 달라도 같아야 한다
# ══════════════════════════════════════════════════════════════════════════
class TestLotsEnvelopeKeys:
    """`mixing_history` 가 `sn_pct`·`melt_temp_c` 를 쓰다가 두 번 틀렸다.

    1) `Lot` 에 없는 속성이라 도구가 `AttributeError` 로 터졌다.
    2) 설령 읽혔더라도 `ALLOWLIST["lots"]` 에 없는 키라 마스킹이 통째로 버렸다 —
       **도구는 성공하고 LLM 은 배합비를 못 보는** 조용한 실패가 됐을 것이다.

    같은 테이블은 어느 도구를 거치든 같은 이름으로 나가야 한다.
    """

    def test_mixing_history_uses_allowlisted_lot_columns(self, db):
        from src.agent.allowlist import ALLOWLIST

        r = tools.run(db, "mixing_history", scope="mixing", role="admin",
                      date_from="2024-01-01", date_to="2026-12-31", limit=5)
        lots = r.result["lots"]
        if not lots:
            pytest.skip("기간 내 LOT 이 없다")

        allowed = ALLOWLIST["lots"]
        for key in lots[0]:
            # `lot_id` 는 별칭으로 치환돼 나가는 필드다 (`ALIAS_FIELDS`)
            assert key == "lot_id" or key in allowed, f"{key} 는 허용목록 밖이다"

    def test_component_values_reach_the_wire(self, db):
        """배합 실적 질문의 알맹이는 성분비다 — 마스킹 뒤에 남아 있어야 한다."""
        r = tools.run(db, "mixing_history", scope="mixing", role="admin",
                      date_from="2024-01-01", date_to="2026-12-31", limit=5)
        if not r.result["lots"]:
            pytest.skip("기간 내 LOT 이 없다")

        wire = to_wire(r.result, AliasBook())
        row = wire.fields["lots"][0]
        assert {"sn_ratio", "ag_ratio", "cu_ratio", "pb_ratio",
                "quality_score", "temperature", "time_min"} <= set(row)
        assert row["lot_alias"].startswith("LOT#")
