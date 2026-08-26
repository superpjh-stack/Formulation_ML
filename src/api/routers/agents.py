"""AI Agent 8종 — **전부 `501 Not Implemented`** (`api-contract.md` §8.10).

> 선택 요구사항 11건 중 8건이 여기 있다. goal.md 2.1: 선택 항목은 **UI 동작까지만**이
> 게이트다. LLM 을 실제로 붙일 필요가 없다. 저장 테이블도 없다
> (CR-DB-001 범위에서 의도적으로 제외).
> → **501 을 반환**하고 화면은 "준비 중" 상태를 명시적으로 렌더링한다.
> `POST /agents/*` 를 **가짜 문자열로 채워 "동작하는 것처럼" 보이게 만들지 마라.**

| 경로 | 메서드 | 화면 | 그룹 |
|---|---|---|---|
| `/agents/receiving` | POST | FE-RT-10 | G2 입고관리 |
| `/agents/mixing` | POST | FE-RT-15 | G3 배합비율 최적화AI |
| `/agents/shipping` | POST | FE-RT-20 | G4 포장출하관리 |
| `/agents/query` | POST | FE-RT-38 | G9 |
| `/agents/analysis` | POST | FE-RT-39 | G9 |
| `/agents/decision` | POST | FE-RT-40 | G9 |
| `/agents/recommendations` | GET | FE-RT-41 | G9 |
| `/agents/logs` | GET | FE-RT-42 | G9 |

이 파일에 **로직을 채우지 마라.** LLM 연동은 v1 범위 밖이며, 빈 배열·고정 문자열을
돌려주면 goal.md 3절의 "조용한 실패 금지"를 정면으로 위반한다. 501 은 프론트가
"준비 중"을 렌더링할 수 있게 하는 **정직한 신호**다.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from src.api.deps import get_current_user
from src.api.errors import NOT_IMPLEMENTED_DETAIL
from src.db.models import User

router = APIRouter(prefix="/agents", tags=["G9 AI Agent 관리 (501)"],
                   dependencies=[Depends(get_current_user)])


def _not_implemented():
    raise HTTPException(status_code=501, detail=NOT_IMPLEMENTED_DETAIL)


#: (경로, 메서드, 화면) — 8종. 한 곳에서 선언해 누락·중복을 막는다.
_AGENT_ENDPOINTS: tuple[tuple[str, str, str, str], ...] = (
    ("/receiving", "POST", "FE-RT-10", "입고 AI Agent"),
    ("/mixing", "POST", "FE-RT-15", "배합 AI Agent"),
    ("/shipping", "POST", "FE-RT-20", "출하 AI Agent"),
    ("/query", "POST", "FE-RT-38", "자연어 질의"),
    ("/analysis", "POST", "FE-RT-39", "자동 분석 리포트"),
    ("/decision", "POST", "FE-RT-40", "의사결정 지원"),
    ("/recommendations", "GET", "FE-RT-41", "추천 이력"),
    ("/logs", "GET", "FE-RT-42", "Agent 실행 로그"),
)

for _path, _method, _screen, _name in _AGENT_ENDPOINTS:
    router.add_api_route(
        _path,
        _not_implemented,
        methods=[_method],
        status_code=501,
        summary=f"{_screen} {_name} (미구현 — 501)",
        description=(
            f"**501 Not Implemented.** {_screen} 은 SF-AD2 상 **선택** 요구사항이고 "
            "LLM 연동·저장 테이블이 v1 범위 밖이다 (api-contract.md §8.10).\n\n"
            "프론트는 501 을 받아 \"준비 중\" 상태를 렌더링한다. "
            "가짜 응답으로 채우지 마라."
        ),
    )

del _path, _method, _screen, _name


__all__ = ["router"]
