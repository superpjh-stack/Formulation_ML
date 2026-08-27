"""외부 제공자 어댑터 — `agent-architecture.md` §2.5 포트 1·2.

**여기가 외부로 나가는 유일한 문이다.** 다른 모듈은 이 파일을 통하지 않고
네트워크를 부르지 않는다. 그래야 §2.8 송출 통제를 한 곳에서 검증할 수 있다.

각 호출의 첫 줄이 차단 검사다:
    임베딩  `embed.assert_transfer_allowed()`  — 대외비 문서 전문이 나간다
    생성    `redaction.assert_wire_safe()`     — 조회 결과의 금지 필드가 나간다

키가 없으면 여기서 `ProviderUnavailable` 을 던지고, 라우터가 **501**(제공자 미설정)
또는 **503**(장애)으로 옮긴다 (§7.6). 조용히 빈 답을 만들지 않는다.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Sequence

from src.agent import config, embed


class ProviderUnavailable(RuntimeError):
    """제공자를 부를 수 없다. `configured=False` 이거나 호출이 실패했다."""

    def __init__(self, message: str, *, code: str = "provider_unavailable") -> None:
        super().__init__(message)
        #: `agent_runs.error_code` (§6.6) 값 집합
        self.code = code


# ══════════════════════════════════════════════════════════════════════════
# 포트 2 — 임베딩
# ══════════════════════════════════════════════════════════════════════════
class OpenAIEmbeddings:
    """`text-embedding-3-*` — `dimensions` 파라미터로 1024 로 맞춘다.

    Matryoshka 축소를 쓰는 이유는 `embed.py` 에 적어 뒀다: 1024 는 Voyage·Cohere 와
    같은 차원이라 제공자를 바꿔도 마이그레이션이 필요 없다.
    """

    def __init__(self) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=config.api_key("openai"))
        self._model = embed.model_id()

    @property
    def model_id(self) -> str:
        return self._model

    @property
    def dimension(self) -> int:
        return embed.EMBED_DIM

    def embed_documents(self, texts: Sequence[str]) -> list[list[float]]:
        # 🔴 첫 줄이 차단 검사다. 키가 있는지는 그 다음 문제다.
        embed.assert_transfer_allowed(len(texts))
        try:
            resp = self._client.embeddings.create(
                model=self._model, input=list(texts), dimensions=embed.EMBED_DIM
            )
        except Exception as exc:  # noqa: BLE001 — SDK 예외 계층이 제공자마다 다르다
            raise ProviderUnavailable(f"임베딩 호출 실패: {type(exc).__name__}") from exc

        vectors = [d.embedding for d in resp.data]
        for v in vectors:
            if len(v) != embed.EMBED_DIM:
                raise ProviderUnavailable(
                    f"임베딩 차원 {len(v)} 이 컬럼 정의 {embed.EMBED_DIM} 와 다르다"
                )
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


def get_embeddings() -> OpenAIEmbeddings:
    """`embed.get_provider()` 의 실제 구현. 임베딩은 OpenAI 만 지원한다.

    Voyage·Cohere 도 1024 차원이라 붙이는 데 마이그레이션은 필요 없지만, 지금
    쓸 키가 없는 제공자의 어댑터를 미리 만들어 두면 **동작을 검증할 수 없는 코드**가
    남는다. 필요할 때 추가한다.
    """
    return OpenAIEmbeddings()


# ══════════════════════════════════════════════════════════════════════════
# 포트 1 — 생성
# ══════════════════════════════════════════════════════════════════════════
@dataclass
class LlmResult:
    text: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_input_tokens: int | None = None
    #: LLM 이 고른 도구 호출. §3.3 "LLM 은 어느 쿼리 + 어떤 파라미터만 고른다"
    tool_calls: list[dict[str, Any]] = field(default_factory=list)
    stop_reason: str | None = None


class AnthropicLlm:
    def __init__(self, model: str) -> None:
        import anthropic

        self._sdk = anthropic
        self._client = anthropic.Anthropic(
            api_key=config.api_key("anthropic"), timeout=config.LLM_TIMEOUT_S
        )
        self._model = model

    @property
    def provider(self) -> str:
        return "anthropic"

    @property
    def model_id(self) -> str:
        return self._model

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LlmResult:
        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": config.MAX_OUTPUT_TOKENS,
            "temperature": config.TEMPERATURE,
            "system": system,
            "messages": messages,
        }
        if tools:
            kwargs["tools"] = tools
        try:
            resp = self._client.messages.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            raise ProviderUnavailable(
                f"생성 호출 실패: {type(exc).__name__}", code=_error_code(exc)
            ) from exc

        text_parts, calls = [], []
        for block in resp.content:
            if getattr(block, "type", None) == "text":
                text_parts.append(block.text)
            elif getattr(block, "type", None) == "tool_use":
                calls.append({"id": block.id, "name": block.name, "args": block.input})

        usage = getattr(resp, "usage", None)
        return LlmResult(
            text="".join(text_parts),
            input_tokens=getattr(usage, "input_tokens", None),
            output_tokens=getattr(usage, "output_tokens", None),
            cached_input_tokens=getattr(usage, "cache_read_input_tokens", None),
            tool_calls=calls,
            stop_reason=getattr(resp, "stop_reason", None),
        )


class OpenAiLlm:
    def __init__(self, model: str) -> None:
        from openai import OpenAI

        self._client = OpenAI(api_key=config.api_key("openai"), timeout=config.LLM_TIMEOUT_S)
        self._model = model

    @property
    def provider(self) -> str:
        return "openai"

    @property
    def model_id(self) -> str:
        return self._model

    def complete(
        self,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LlmResult:
        payload = [{"role": "system", "content": system}, *_to_openai(messages)]
        kwargs: dict[str, Any] = {
            "model": self._model,
            "max_tokens": config.MAX_OUTPUT_TOKENS,
            "temperature": config.TEMPERATURE,
            "messages": payload,
        }
        if tools:
            kwargs["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t.get("description", ""),
                        "parameters": t["input_schema"],
                    },
                }
                for t in tools
            ]
        try:
            resp = self._client.chat.completions.create(**kwargs)
        except Exception as exc:  # noqa: BLE001
            raise ProviderUnavailable(
                f"생성 호출 실패: {type(exc).__name__}", code=_error_code(exc)
            ) from exc

        choice = resp.choices[0]
        calls = []
        for tc in choice.message.tool_calls or []:
            import json

            calls.append(
                {"id": tc.id, "name": tc.function.name, "args": json.loads(tc.function.arguments)}
            )
        usage = getattr(resp, "usage", None)
        cached = None
        details = getattr(usage, "prompt_tokens_details", None)
        if details is not None:
            cached = getattr(details, "cached_tokens", None)
        return LlmResult(
            text=choice.message.content or "",
            input_tokens=getattr(usage, "prompt_tokens", None),
            output_tokens=getattr(usage, "completion_tokens", None),
            cached_input_tokens=cached,
            tool_calls=calls,
            stop_reason=choice.finish_reason,
        )


def _to_openai(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Anthropic 형식(블록 배열)을 OpenAI 형식(문자열)으로 눕힌다."""
    out: list[dict[str, Any]] = []
    for m in messages:
        content = m["content"]
        if isinstance(content, str):
            out.append({"role": m["role"], "content": content})
            continue
        text = "\n".join(
            b.get("text", "") if isinstance(b, dict) else str(b)
            for b in content
            if not isinstance(b, dict) or b.get("type") == "text"
        )
        out.append({"role": m["role"], "content": text})
    return out


def _error_code(exc: Exception) -> str:
    """§6.6 `error_code` 값 집합으로 옮긴다. 새 값을 발명하지 않는다."""
    name = type(exc).__name__.lower()
    if "ratelimit" in name:
        return "rate_limited"
    if "timeout" in name or "apitimeout" in name:
        return "timeout"
    return "provider_unavailable"


def get_llm() -> AnthropicLlm | OpenAiLlm:
    cfg = config.llm_config()
    if not cfg.configured:
        raise ProviderUnavailable(cfg.reason or "제공자가 설정되지 않았습니다.", code="not_configured")
    if cfg.provider == "anthropic":
        return AnthropicLlm(cfg.model_id or "")
    return OpenAiLlm(cfg.model_id or "")


def timed(fn, *args, **kwargs) -> tuple[Any, int]:
    """(결과, 경과 ms). `agent_runs.latency_ms` 는 구간별로 재야 한다 (§6.6)."""
    start = time.perf_counter()
    result = fn(*args, **kwargs)
    return result, int((time.perf_counter() - start) * 1000)
