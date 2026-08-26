"""AI Agent 계층 — `agent-architecture.md`.

⚠ **외부 LLM API 사용은 `CR-ARCH-001` 로 CISO·주관기관 승인 대기 중이다.**
승인 전까지 `/agents/*` 는 **501 을 유지**한다 (`src/api/routers/agents.py`).

이 패키지에 지금 있는 것은 **외부 호출을 하나도 하지 않는 두 계층**뿐이다.

| 모듈 | 무엇 | 외부 호출 |
|---|---|---|
| `tools/` | 쿼리 카탈로그 (§3.3) — 우리 DB 를 읽는 SQLAlchemy 순수 함수 11개 | 없음 |
| `allowlist.py` | 필드 단위 송출 허용목록 (§2.8.2) — 코드 상수 | 없음 |
| `redaction.py` | 마스킹 계층 (§2.8.3) — 허용목록 + 가역 별칭 | 없음 |

**여기에 LLM 호출·프롬프트·`LLMProvider` 를 만들지 마라.** 승인 후 붙는다.
붙는 지점은 `redaction.assert_wire_safe()` 다 — 마스킹을 통과하지 않은 데이터는
어댑터가 거부한다 (§2.8.4 단일 출구).
"""
from __future__ import annotations

__all__ = ["allowlist", "redaction", "tools"]
