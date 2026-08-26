"""DB 세션/엔진 — SF-TD5 §1 (koryo_solder_db, PostgreSQL, UTF-8).

로컬 기동 PostgreSQL 은 **17.10** 이다. SF-TD5 §1 은 15 를 명시하나 문법 차이가
없으므로 17 로 진행하고 그 사실을 contracts/db-schema.md 에 기록했다.

접속 문자열은 환경변수 `DATABASE_URL` 로 덮어쓸 수 있다.
"""
from __future__ import annotations

import os
from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

DEFAULT_DATABASE_URL = "postgresql+psycopg://gerardo92@localhost:5432/koryo_solder_db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

# NFR-P-04 (동시 접속 20명) 대응 — pool_size + overflow 로 20 커넥션 이상 확보
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,     # 끊긴 커넥션 자동 감지 → SF-TD4 §5 의 503 처리와 연동
    pool_size=10,
    max_overflow=15,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def get_session() -> Iterator[Session]:
    """FastAPI 의존성 주입용 세션 제너레이터.

        @router.get("/lots")
        def list_lots(db: Session = Depends(get_session)): ...

    DB 연결 실패는 여기서 잡지 않는다 — `app.py` 의 전역 예외 핸들러가
    `OperationalError` 를 503 "서비스 일시 중단" 으로 변환한다 (SF-TD4 §5).
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
