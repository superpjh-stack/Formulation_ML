"""AI Agent 계층 — `agent-architecture.md`.

| 모듈 | 무엇 | 외부 호출 |
|---|---|---|
| `tools/` | 쿼리 카탈로그 (§3.3) — 우리 DB 를 읽는 SQLAlchemy 순수 함수 11개 | 없음 |
| `allowlist.py` | 필드 단위 송출 허용목록 (§2.8.2) — 코드 상수 | 없음 |
| `redaction.py` | 마스킹 계층 (§2.8.3) — 허용목록 + 가역 별칭 | 없음 |
| `ingest/` | 현장 문서 → 청크 적재 (§3.6) | 없음 |
| `rules.py` | `RuleSnapshot` — 답변 시점의 룰 정본 (§4.3) | 없음 |
| `validate.py` | 출력 검증기 V1~V9 (§4.5) | 없음 |
| `retrieval.py` | pgvector 코사인 검색 (§3.6) | 없음 |
| `config.py` | 제공자·모델·파라미터 (§2.5) | 없음 |
| `embed.py` | 임베딩 포트 + **대외비 전송 게이트** | 어댑터 경유 |
| **`providers.py`** | **외부로 나가는 유일한 문** (§2.5 포트 1·2) | 🔴 있음 |
| `orchestrator.py` | 흐름 (§3·§4) | `providers` 경유 |

**외부 호출을 `providers.py` 밖에 만들지 마라.** 한 곳이어야 §2.8 송출 통제를
한 번만 검증하면 된다. 붙는 지점은 `redaction.assert_wire_safe()` 와
`embed.assert_transfer_allowed()` 두 개다.
"""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

# `.env` 를 **패키지 최초 import 시점에** 읽는다.
#
# 초판은 이 호출이 `config.py` 에만 있었다. 그런데 `embed.py` 는 `config` 를
# import 하지 않고 `os.getenv` 만 쓴다. 그래서 `config` 를 거치지 않는 경로
# (`scripts/embed_chunks.py --status` 등)에서는 `.env` 가 아예 로드되지 않았고,
# **승인 플래그를 1 로 설정해 뒀는데도 화면에 False 로 찍혔다.**
#
# 설정을 켰는데 시스템이 안 켜졌다고 말하는 것은 그 자체로 조용한 실패다.
# 그래서 개별 모듈이 아니라 패키지 진입점에서 한 번 읽는다.
#
# `override=False` — 셸에서 명시적으로 준 값이 파일보다 우선한다.
load_dotenv(Path(__file__).resolve().parents[2] / ".env", override=False)

__all__ = [
    "allowlist",
    "config",
    "embed",
    "ingest",
    "orchestrator",
    "providers",
    "redaction",
    "retrieval",
    "rules",
    "tools",
    "validate",
]
