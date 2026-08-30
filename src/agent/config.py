"""AI Agent 런타임 설정 — 전부 환경변수에서 온다.

`agent-architecture.md` §2.5·§3.6 이 "모델 ID 를 코드에 박지 않는다" 를 반복해서
요구한다. 박으면 모델을 바꿀 때 코드를 고쳐야 하고, 어느 모델로 답했는지는
`agent_runs.model_id` 에만 남아야 한다.

§2.9 — **키 값·앞자리·길이를 절대 밖으로 내보내지 않는다.** `health()` 가 돌려주는
것은 "설정됐는가" 뿐이다.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# 이 모듈의 상수들이 **import 시점에** `os.getenv` 를 읽으므로, `.env` 를 그 전에
# 불러야 한다. CLI 스크립트가 `app.py` 를 거치지 않고 들어와도 값이 채워진다.
# `override=False` — 셸에서 명시적으로 준 값이 파일보다 우선한다.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

#: `agent_runs.provider` 값 집합 (§6.6). 새 값을 발명하지 않는다.
PROVIDERS = ("anthropic", "openai")

# ── LLM ─────────────────────────────────────────────────────────────────
ENV_PROVIDER = "AGENT_LLM_PROVIDER"
ENV_MODEL = "AGENT_LLM_MODEL"

#: 제공자별 기본 모델. **코드가 고르는 것이 아니라 못 정했을 때의 마지막 값**이다.
DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-5",
    "openai": "gpt-4.1",
}

#: 제공자별 키 환경변수
KEY_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
}

# ── 생성 파라미터 ────────────────────────────────────────────────────────
#: §2.10.3 컨텍스트 예산. 근거를 넘기고도 답할 자리가 남아야 한다.
MAX_OUTPUT_TOKENS = int(os.getenv("AGENT_MAX_OUTPUT_TOKENS", "1200"))
#: §7.10 — 전역 10초 타임아웃은 Agent 를 전부 실패로 그린다. 별도 예산을 쓴다.
LLM_TIMEOUT_S = float(os.getenv("AGENT_LLM_TIMEOUT_S", "55"))
#: 사실 응답이다. 온도를 올릴 이유가 없다.
TEMPERATURE = float(os.getenv("AGENT_TEMPERATURE", "0"))

# ── 검색 ────────────────────────────────────────────────────────────────
#: 검색 결과 개수. **화면에 근거 카드로 그대로 뜬다.**
#:
#: 8 → 3 으로 줄였다 (2026-08-30, 사용자 요청). 근거 8개는 읽히지 않는다 —
#: 사용자가 확인할 수 있는 양을 넘으면 인용이 장식이 된다.
#:
#: ⚠ 대가가 있다. k=8 일 때 평가셋 재현율이 10/10 이었고, 정답 청크가 8위였던
#:   문항(「용해할 때 몇 분이나 유지해야 해?」)이 있다. k=3 이면 그 문항은
#:   근거를 못 찾는다. `scripts/run_evalset.py` 로 실측해 두었다.
RETRIEVE_K = int(os.getenv("AGENT_RETRIEVE_K", "3"))

#: 🔴 유사도 하한 컷오프 — §3.6 이 "환각 방지의 1차 방어선" 이라 부른 값이다.
#:
#: 설계서는 같은 줄에서 **"임계값은 코퍼스 확보 후 실측으로 정한다 — 지금 숫자를
#: 지어내지 않는다"** 고 못박았다. 그래서 기본값을 상수로 박지 않고 **미설정**으로
#: 둔다. 미설정이면 `retrieval` 이 컷오프를 적용하지 않고, 그 사실을
#: `agent_runs.retrieval.cutoff = null` 로 기록한다 — 방어선이 없었다는 것이
#: 로그에 남아야 한다.
#:
#: 실측 절차: `scripts/measure_cutoff.py` 가 `scripts/evalset.py` 의 10문항으로
#: 정답 청크 유사도와 오답 청크 유사도의 분포를 뽑는다. 그 결과로 이 값을 정한다.
_cutoff_raw = os.getenv("AGENT_SIMILARITY_CUTOFF", "").strip()
SIMILARITY_CUTOFF: float | None = float(_cutoff_raw) if _cutoff_raw else None


@dataclass(frozen=True)
class LlmConfig:
    provider: str | None
    model_id: str | None
    configured: bool
    reason: str | None


def llm_config() -> LlmConfig:
    """제공자·모델·키가 다 있는지 판정한다. **키 값은 읽되 절대 반환하지 않는다.**"""
    provider = os.getenv(ENV_PROVIDER, "").strip().lower() or None

    if provider is None:
        return LlmConfig(None, None, False, f"{ENV_PROVIDER} 가 설정되지 않았습니다.")
    if provider not in PROVIDERS:
        return LlmConfig(
            provider, None, False,
            f"{ENV_PROVIDER}={provider} 는 지원하지 않습니다. 가능: {', '.join(PROVIDERS)}",
        )

    key_env = KEY_ENV[provider]
    if not os.getenv(key_env, "").strip():
        model = os.getenv(ENV_MODEL, "").strip() or DEFAULT_MODELS[provider]
        return LlmConfig(provider, model, False, f"{key_env} 가 설정되지 않았습니다.")

    model = os.getenv(ENV_MODEL, "").strip() or DEFAULT_MODELS[provider]
    return LlmConfig(provider, model, True, None)


def api_key(provider: str) -> str:
    """키를 읽는다. **로그·응답·예외 메시지에 값을 싣지 마라.**"""
    env = KEY_ENV.get(provider)
    if env is None:
        raise ValueError(f"모르는 제공자: {provider}")
    value = os.getenv(env, "").strip()
    if not value:
        raise RuntimeError(f"{env} 가 설정되지 않았습니다.")
    return value
