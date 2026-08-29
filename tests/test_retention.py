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
