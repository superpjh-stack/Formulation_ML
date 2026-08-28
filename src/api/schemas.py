"""공통 규약 — 페이징 봉투(§4.2) · 공통 쿼리 파라미터(§4.3).

목록을 내보내는 **모든** GET 은 `{items, total, page, page_size}` 봉투를 쓴다.
`api-contract.md` §4.2 의 **예외 8건**(벌거벗은 배열)만 봉투 없이 나간다:
`/models` · `/process/performance` · `/shipments/calendar` · `/kpi/production` ·
`/kpi/quality` · `/kpi/targets` · `/integrations` · `/notification-rules` ·
`/claims/{claim_no}/history`
"""
from __future__ import annotations

from typing import Any, Generic, TypeVar

from fastapi import Query
from pydantic import BaseModel
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

T = TypeVar("T")

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


class Page(BaseModel, Generic[T]):
    """`api-contract.md` §4.2 목록 응답 봉투."""

    items: list[T]
    total: int
    page: int
    page_size: int


class PageParams:
    """`page` / `page_size` / `sort` 공통 쿼리 의존성.

        @router.get("/foo")
        def list_foo(pg: PageParams = Depends()): ...
    """

    def __init__(
        self,
        page: int = Query(1, ge=1, description="1부터"),
        page_size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
        sort: str | None = Query(None, description='"field:asc" | "field:desc"'),
    ) -> None:
        self.page = page
        self.page_size = page_size
        self.sort = sort

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    def parse_sort(self, allowed: dict[str, Any], default: Any | None = None):
        """`sort=field:desc` 를 SQLAlchemy 정렬식으로 바꾼다.

        `allowed` 밖의 필드명은 **조용히 무시**하고 기본 정렬로 떨어진다
        (임의 컬럼명을 SQL 로 흘리지 않기 위함 — NFR-S-05).
        """
        if not self.sort:
            return default
        field, _, direction = self.sort.partition(":")
        col = allowed.get(field.strip())
        if col is None:
            return default
        return col.desc() if direction.strip().lower() == "desc" else col.asc()


def paginate(db: Session, stmt: Select, pg: PageParams, mapper, *, scalars: bool = True) -> dict:
    """`stmt` 를 count + limit/offset 으로 실행해 봉투 dict 를 만든다.

    `mapper` 는 행 하나를 응답 dict 로 바꾸는 함수다.

    `scalars=True`(기본)면 `.scalars()` 로 **첫 컬럼만** 꺼내 ORM 객체를 넘긴다.
    `SELECT` 에 컬럼을 여러 개 둔 경우(조인해서 사용자명·평가를 함께 집을 때 등)
    `scalars=False` 로 두면 `Row` 튜플이 그대로 `mapper` 에 간다.

    ⚠ 기본값을 True 로 둔 것은 기존 호출부 20여 곳이 전부 단일 엔티티라서다.
      다중 컬럼 `stmt` 에 이 옵션을 빠뜨리면 `.scalars()` 가 첫 컬럼만 남겨
      `TypeError: cannot unpack non-iterable` 로 터진다 — 조용히 틀리지는 않는다.
    """
    total = db.execute(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ).scalar_one()
    result = db.execute(stmt.limit(pg.page_size).offset(pg.offset))
    rows = result.scalars().all() if scalars else result.all()
    return {
        "items": [mapper(r) for r in rows],
        "total": int(total),
        "page": pg.page,
        "page_size": pg.page_size,
    }


def page_of(items: list, total: int, pg: PageParams) -> dict:
    """이미 만들어진 리스트를 봉투에 담는다."""
    return {"items": items, "total": total, "page": pg.page, "page_size": pg.page_size}
