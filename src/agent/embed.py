"""임베딩 포트 — `agent-architecture.md` §2.5 포트 2 · §3.6.

**모델과 차원은 코드에 박지 않는다.** `AGENT_EMBED_MODEL` 환경변수로 정하고,
청크마다 `embed_model`·`embed_dim` 을 함께 저장한다. 모델이 바뀌면 전량 재색인이
필요하다는 사실을 스키마가 기억하게 하려는 것이다 (§2.11·§3.7).

── 차원을 1024 로 고정한 이유 ────────────────────────────────────────────────

`vector(N)` 의 N 은 DDL 에 박히므로, 나중에 제공자를 바꾸면 **컬럼 타입 변경**
까지 필요해진다. 1024 는 주요 외부 제공자가 공통으로 내는 차원이다:

    OpenAI  text-embedding-3-large   3072 → `dimensions=1024` 로 축소 지원
    OpenAI  text-embedding-3-small   1536 → `dimensions=1024` 로 축소 지원
    Voyage  voyage-3                 1024 (기본)
    Cohere  embed-multilingual-v3    1024 (기본)

1024 로 두면 제공자를 바꿔도 **재임베딩만** 하면 되고 마이그레이션은 불필요하다.
재임베딩은 어차피 모델이 바뀌면 피할 수 없다.

── 외부 전송 차단 ────────────────────────────────────────────────────────────

🔴 대상 문서 WS-KS-001 · QS-KS-001 은 표지에 **"사내 표준 (대외비 · 무단 복제 및
반출 금지)"** 이 찍혀 있다. 임베딩은 이 문서 **전문을 외부 API 로 보내는 행위**다.

사업계획서 p.60 §9.2 는 "RAG 기반 AI Agent 는 내부 데이터만 접근 가능한 폐쇄형
구조" 를 요구하고, 외부 API 사용은 **`CR-ARCH-001` 승인 대기** 상태다(§2.7).

그래서 `embed_chunks()` 는 승인 플래그가 없으면 **호출 즉시 거부한다.** 키가
있는지, 네트워크가 되는지는 그 다음 문제다. 승인 없이 문서가 나가는 경로를
"키가 없어서 어차피 안 될 것" 에 맡기지 않는다.
"""
from __future__ import annotations

import os
from typing import Protocol, Sequence

#: `doc_chunks.embedding vector(N)` 의 N. 마이그레이션과 반드시 같아야 한다.
EMBED_DIM = 1024

#: 제공자·모델. 코드에 박지 않는다 (§3.6).
DEFAULT_MODEL = "text-embedding-3-large"

#: 🔴 외부 전송 승인 플래그. `CR-ARCH-001` 승인 후에만 1 로 둔다.
APPROVAL_ENV = "AGENT_EXTERNAL_EMBED_APPROVED"


class ExternalTransferBlocked(RuntimeError):
    """승인 없이 대외비 문서를 외부로 보내려 했다."""


class EmbeddingProvider(Protocol):
    """§2.5 포트 2. 구현체는 승인 후에 붙인다."""

    @property
    def model_id(self) -> str: ...

    @property
    def dimension(self) -> int: ...

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]: ...


def model_id() -> str:
    return os.getenv("AGENT_EMBED_MODEL", DEFAULT_MODEL)


def text_for(source_title: str, heading: str | None, content: str) -> str:
    """임베딩에 넣을 문자열 — **제목 경로를 본문 앞에 붙인다.**

    붙이지 않으면 표 청크가 자연어 질문에 걸리지 않는다. 이 문서는 내용의
    대부분이 표인데, 파이프로 눕힌 표(`5 | 설정 온도까지 승온한다 | ...`)는
    "용해할 때 몇 분이나 유지해야 해?" 같은 문장과 의미가 잘 붙지 않는다.
    제목("4.2 WS-02 용해 > 다. 작업 순서 및 관리 기준")이 그 다리를 놓는다.

    평가셋 10문항 실측 (2026-08-27, text-embedding-3-large/1024):

        문항                              본문만    제목포함
        용해 유지 시간                       12위      8위
        배합 편차 50% 초과 조치                6위      2위
        XRF 기록 보존기간                     2위      3위
        품질 점수 70점 합격 여부                3위      4위

    상위권 문항이 한 계단씩 밀리는 대신 **하위권이 크게 올라온다.** 이미 1~3위인
    문항은 어차피 k 안에 들어오므로 손해가 없고, k 밖으로 나가 있던 것이 들어온다.

    ⚠ `doc_chunks.content` 는 그대로 둔다 — 인용 원문을 바꾸지 않는다.
      바꾸는 것은 **임베딩에 넣는 문자열**뿐이다.
    """
    prefix = f"{source_title} · {heading}" if heading else source_title
    return f"{prefix}\n{content}"


def external_transfer_approved() -> bool:
    return os.getenv(APPROVAL_ENV, "").strip() in {"1", "true", "yes"}


def assert_transfer_allowed(chunk_count: int) -> None:
    """외부 임베딩 호출 **직전 첫 줄**에서 부른다.

    `redaction.assert_wire_safe()` 가 조회 결과의 금지 필드를 막는 것과 같은
    자리다. 다만 여기서 막는 것은 필드가 아니라 **문서 전문**이다.
    """
    if not external_transfer_approved():
        raise ExternalTransferBlocked(
            f"대외비 문서 {chunk_count}청크를 외부 임베딩 API 로 보내려 했으나 "
            f"승인 플래그({APPROVAL_ENV})가 없다.\n"
            "  WS-KS-001·QS-KS-001 은 표지에 '대외비 · 무단 복제 및 반출 금지' 가 찍혀 있고,\n"
            "  사업계획서 p.60 §9.2 는 폐쇄형 구조를 요구한다.\n"
            "  CR-ARCH-001 승인 후 CISO 확인을 받고 플래그를 설정하라."
        )


def get_provider() -> EmbeddingProvider:
    """실제 어댑터를 돌려준다.

    더미를 돌려주지 않는다. 더미면 **차원만 맞는 무의미한 벡터**로 색인이 채워지고
    `index_ready:true` 가 되어 AI 가 엉뚱한 청크를 근거로 답한다. 키가 없으면
    어댑터 생성 단계에서 `ProviderUnavailable` 이 난다 — 조용히 넘어가지 않는다.
    """
    from src.agent.providers import get_embeddings

    return get_embeddings()
