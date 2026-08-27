"""외부 임베딩 전송 차단 — `src/agent/embed.py`.

WS-KS-001·QS-KS-001 은 표지에 **"사내 표준 (대외비 · 무단 복제 및 반출 금지)"**
가 찍혀 있다. 임베딩은 그 전문을 외부 API 로 보내는 행위이고, 사업계획서 p.60
§9.2 는 폐쇄형 구조를 요구한다. 승인 없이 나가는 경로가 없어야 한다.
"""
from __future__ import annotations

import pytest

from src.agent import embed


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv(embed.APPROVAL_ENV, raising=False)
    monkeypatch.delenv("AGENT_EMBED_MODEL", raising=False)


def test_transfer_blocked_by_default():
    with pytest.raises(embed.ExternalTransferBlocked):
        embed.assert_transfer_allowed(122)


def test_block_message_names_the_flag_and_the_reason():
    """막기만 하고 이유를 안 알려주면 담당자가 우회할 방법을 찾는다."""
    with pytest.raises(embed.ExternalTransferBlocked) as exc:
        embed.assert_transfer_allowed(122)
    msg = str(exc.value)
    assert embed.APPROVAL_ENV in msg
    assert "대외비" in msg
    assert "CR-ARCH-001" in msg


@pytest.mark.parametrize("value", ["1", "true", "yes"])
def test_approval_flag_opens_the_gate(monkeypatch, value):
    monkeypatch.setenv(embed.APPROVAL_ENV, value)
    embed.assert_transfer_allowed(1)   # 예외가 없어야 한다


@pytest.mark.parametrize("value", ["", "0", "false", "no", "TRUE_ISH", " "])
def test_ambiguous_values_do_not_open_the_gate(monkeypatch, value):
    """오타나 애매한 값이 승인으로 해석되면 안 된다."""
    monkeypatch.setenv(embed.APPROVAL_ENV, value)
    with pytest.raises(embed.ExternalTransferBlocked):
        embed.assert_transfer_allowed(1)


def test_provider_is_not_silently_stubbed(monkeypatch):
    """더미 제공자를 돌려주면 차원만 맞는 무의미한 벡터로 색인이 채워지고
    `index_ready:true` 가 되어 AI 가 엉뚱한 청크를 근거로 답한다.

    키가 없으면 **어댑터 생성 단계에서 멈춘다.** 빈 벡터를 만들지 않는다.
    """
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        embed.get_provider()


def test_model_id_comes_from_env_not_hardcoded(monkeypatch):
    monkeypatch.setenv("AGENT_EMBED_MODEL", "voyage-3")
    assert embed.model_id() == "voyage-3"


def test_model_id_falls_back_to_a_named_default():
    assert embed.model_id() == embed.DEFAULT_MODEL


def test_dim_matches_the_migration():
    """`vector(N)` 의 N 은 DDL 에 박힌다. 코드와 어긋나면 삽입이 런타임에 터진다."""
    from src.db.models import DocChunk

    assert DocChunk.__table__.c.embedding.type.dim == embed.EMBED_DIM


def test_dim_is_a_shared_provider_dimension():
    """1024 를 고른 이유는 OpenAI(축소)·Voyage·Cohere 가 공통으로 내는 차원이라
    제공자를 바꿔도 마이그레이션 없이 재임베딩만 하면 되기 때문이다."""
    assert embed.EMBED_DIM == 1024
