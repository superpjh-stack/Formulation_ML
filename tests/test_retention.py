"""로그 보존 정책 — `agent-architecture.md` §6.6.

    `agent_runs` 행 전체              → 1년 후 삭제
    `prompt_sent` · `raw_answer`      → **90일 후 NULL**

두 정책이 다른 것이 핵심이다. **통계는 1년, 원문은 90일.** 지연·토큰·룰위반
지표는 1년치가 있어야 추세를 보지만, 외부로 나갔던 프롬프트 전문까지 1년을
들고 있을 이유는 없다.

이 테스트는 **실제 DB 에 오래된 행을 넣고** 확인한다. 현재 데이터가 전부
최근이라 스크립트를 돌려도 0건이 나오고, 그러면 "동작한다" 는 확인이 안 된다.
"""
from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import select

from src.agent import retention

pytestmark = pytest.mark.usefixtures("_db_available")

MARK = "__retention_test__"


@pytest.fixture(scope="module")
def _db_available():
    from src.db.session import SessionLocal

    try:
        db = SessionLocal()
        db.execute(select(1))
        db.close()
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"DB 접속 불가: {exc}")


@pytest.fixture
def db():
    from src.db.session import SessionLocal

    session = SessionLocal()
    try:
        yield session
    finally:
        # 이 테스트가 만든 행만 지운다. 실데이터를 건드리면 안 된다.
        from src.db.models import AgentRun

        session.rollback()
        session.query(AgentRun).filter(AgentRun.rule_hash == MARK).delete()
        session.commit()
        session.close()


def make_run(db, *, age_days: int, with_prompt: bool = True):
    """`age_days` 일 전에 실행된 것처럼 보이는 `agent_runs` 행 하나."""
    from src.db.models import AgentRun

    row = AgentRun(
        scope="receiving",
        route="rag",
        answer_status="ok",
        rule_hash=MARK,
        latency_ms={"total": 1234},
        total_ms=1234,
        input_tokens=100,
        output_tokens=20,
        prompt_sent="대외비 문서 본문이 여기 들어간다" if with_prompt else None,
        raw_answer="버려진 답변 원본" if with_prompt else None,
        created_at=dt.datetime.now() - dt.timedelta(days=age_days),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def reload(db, row):
    db.expire_all()
    from src.db.models import AgentRun

    return db.get(AgentRun, row.id)


# ── 90일 — 원문 비우기 ──────────────────────────────────────────────────
def test_expired_prompt_is_nulled(db):
    row = make_run(db, age_days=retention.PROMPT_RETENTION_DAYS + 1)
    assert retention.mask_expired_prompts(db) >= 1
    after = reload(db, row)
    assert after.prompt_sent is None
    assert after.raw_answer is None


def test_the_row_survives_masking(db):
    """🔴 행을 지우는 것이 아니다. 지연·토큰·룰위반 지표는 1년까지 남아야 한다."""
    row = make_run(db, age_days=retention.PROMPT_RETENTION_DAYS + 1)
    retention.mask_expired_prompts(db)
    after = reload(db, row)
    assert after is not None
    assert after.total_ms == 1234
    assert after.input_tokens == 100
    assert after.answer_status == "ok"


def test_fresh_prompt_is_untouched(db):
    """경계 — 89일 된 원문은 아직 지울 때가 아니다."""
    row = make_run(db, age_days=retention.PROMPT_RETENTION_DAYS - 1)
    retention.mask_expired_prompts(db)
    assert reload(db, row).prompt_sent is not None


def test_masking_is_idempotent(db):
    """두 번째 실행은 0건이어야 한다.

    조건 없이 전체를 UPDATE 하면 매번 "N건 처리" 라고 보고하면서 실제로는
    아무 일도 안 한 실행과 구분이 안 된다.
    """
    make_run(db, age_days=retention.PROMPT_RETENTION_DAYS + 1)
    first = retention.mask_expired_prompts(db)
    second = retention.mask_expired_prompts(db)
    assert first >= 1
    assert second == 0


def test_already_empty_rows_are_not_counted(db):
    """원문이 없는 오래된 행은 대상이 아니다."""
    make_run(db, age_days=retention.PROMPT_RETENTION_DAYS + 1, with_prompt=False)
    assert retention.count_maskable(db) == 0


# ── 1년 — 행 삭제 ───────────────────────────────────────────────────────
def test_year_old_run_is_deleted(db):
    row = make_run(db, age_days=retention.RUN_RETENTION_DAYS + 1)
    assert retention.purge_expired_runs(db) >= 1
    assert reload(db, row) is None


def test_run_under_a_year_survives(db):
    """경계 — 364일 된 행은 남는다. 원문만 이미 비워져 있다."""
    row = make_run(db, age_days=retention.RUN_RETENTION_DAYS - 1)
    retention.mask_expired_prompts(db)
    retention.purge_expired_runs(db)
    after = reload(db, row)
    assert after is not None, "1년이 안 됐는데 지웠다"
    assert after.prompt_sent is None, "90일이 지났는데 원문이 남았다"


# ── 정책 상수 ───────────────────────────────────────────────────────────
def test_policy_matches_the_contract():
    """§6.6 표의 값이다. 바꾸려면 계약을 먼저 고쳐야 한다."""
    assert retention.PROMPT_RETENTION_DAYS == 90
    assert retention.RUN_RETENTION_DAYS == 365


def test_prompt_retention_is_shorter_than_row_retention():
    """원문이 행보다 오래 남으면 정책 자체가 성립하지 않는다."""
    assert retention.PROMPT_RETENTION_DAYS < retention.RUN_RETENTION_DAYS


def test_run_all_reports_what_it_did(db):
    make_run(db, age_days=retention.PROMPT_RETENTION_DAYS + 1)
    stats = retention.run_all(db)
    assert set(stats) == {"masked", "purged"}
    assert stats["masked"] >= 1


# ══════════════════════════════════════════════════════════════════════════
# FE-RT-40 의사결정 지원 — 소견은 **데이터에서** 나온다
# ══════════════════════════════════════════════════════════════════════════
class TestDecisionAnalysis:
    """🔴 `root_causes` 를 LLM 이 만들면 안 된다.

    목록 형태로 나오면 사람은 그것을 확인된 사실로 읽는다. 서술문이면
    "~로 보입니다" 로 넘길 수 있지만 불릿에는 그런 여지가 없다.
    그래서 `decision.analyze()` 는 결정적 코드이고 LLM 을 부르지 않는다.
    """

    TH = {
        "dev_warn_sn": 2.0, "dev_warn_ag": 0.3, "dev_warn_cu": 0.1,
        "temp_warn_c": 255.0, "quality_pass_score": 70.0,
    }

    def _trace(self, **over):
        base = {
            "lots": {"lot_id": "LOT-X", "quality_score": 85.0, "temperature": 240.0},
            "components": [{"sn_deviation": 0.1, "ag_deviation": 0.05, "cu_deviation": 0.01}],
            "claims": [],
        }
        base.update(over)
        return base

    def test_clean_lot_has_no_findings(self):
        from src.agent import decision

        r = decision.analyze(self._trace(), self.TH)
        assert r.root_causes == []
        assert r.recommendations == []

    def test_deviation_over_threshold_is_reported(self):
        from src.agent import decision

        r = decision.analyze(
            self._trace(components=[{"sn_deviation": -2.851}]), self.TH
        )
        assert any("Sn" in c and "2.851" in c for c in r.root_causes)

    def test_deviation_exactly_at_threshold_is_not_reported(self):
        """경계 — 임계 '초과' 다. 같으면 아직 경고가 아니다."""
        from src.agent import decision

        r = decision.analyze(self._trace(components=[{"sn_deviation": 2.0}]), self.TH)
        assert r.root_causes == []

    def test_quality_finding_says_it_is_not_a_verdict(self):
        """🔴 ML 점수를 합부 판정으로 읽히게 두면 안 된다 (CR-STD-001)."""
        from src.agent import decision

        r = decision.analyze(self._trace(lots={"lot_id": "L", "quality_score": 61.9}), self.TH)
        assert any("합부 판정 아님" in c for c in r.root_causes)

    def test_recommendations_are_deduplicated_per_kind(self):
        """편차 3개가 나도 배합 조치는 한 번만 나온다."""
        from src.agent import decision

        r = decision.analyze(
            self._trace(components=[{"sn_deviation": -3.0, "ag_deviation": -0.5,
                                     "cu_deviation": 0.4}]),
            self.TH,
        )
        assert len(r.root_causes) == 3
        assert len(r.recommendations) == 1

    def test_recommendations_cite_the_standard(self):
        """조치 문장은 문서에서 온다. 지어낸 것이 아님을 근거로 보인다."""
        from src.agent import decision

        r = decision.analyze(self._trace(components=[{"sn_deviation": -3.0}]), self.TH)
        assert all("근거:" in x and "KS-001" in x for x in r.recommendations)

    def test_temperature_finding_surfaces_the_known_conflict(self):
        """255°C 는 작업표준서 조업 온도와 맞지 않는 미해결 사항이다."""
        from src.agent import decision

        r = decision.analyze(self._trace(lots={"lot_id": "L", "temperature": 259.4}), self.TH)
        assert any("CR-STD-001" in x for x in r.recommendations)

    def test_missing_values_are_skipped_not_guessed(self):
        """값이 없으면 판정하지 않는다. 0 으로 보지 않는다."""
        from src.agent import decision

        r = decision.analyze(
            {"lots": {"lot_id": "L", "quality_score": None, "temperature": None},
             "components": [{"sn_deviation": None}], "claims": []},
            self.TH,
        )
        assert r.root_causes == []
