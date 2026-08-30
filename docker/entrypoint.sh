#!/bin/sh
# 백엔드 컨테이너 기동 절차 — DB 대기 → 마이그레이션 → (최초 1회) 시드 → uvicorn
set -e

DB_HOST="${DB_HOST:-db}"
STATE_DIR="${STATE_DIR:-/app/run}"
mkdir -p "$STATE_DIR"

echo "[boot] PostgreSQL(${DB_HOST}) 를 기다린다"
until pg_isready -h "$DB_HOST" -U postgres -q; do sleep 2; done

# JWT 서명키. 넘겨받지 않았으면 볼륨에 만들어 둔다 — 컨테이너를 다시 띄워도 같은 키라
# 이미 발급한 토큰이 살아남는다. src/api/deps.py 의 하드코딩 기본값은 쓰지 않는다.
if [ -z "$JWT_SECRET_KEY" ]; then
  if [ ! -f "$STATE_DIR/jwt_secret" ]; then
    python -c "import secrets; print(secrets.token_urlsafe(48))" > "$STATE_DIR/jwt_secret"
    chmod 600 "$STATE_DIR/jwt_secret"
  fi
  JWT_SECRET_KEY="$(cat "$STATE_DIR/jwt_secret")"
  export JWT_SECRET_KEY
fi

echo "[boot] alembic upgrade head"
alembic upgrade head

# 시드는 한 번만 넣는다. seed_db.py 자체는 upsert 라 재실행이 안전하지만
# 매 기동마다 돌릴 일은 아니다.
if [ ! -f "$STATE_DIR/seeded" ]; then
  echo "[boot] 시드 적재 (scripts/seed_db.py)"
  python scripts/seed_db.py
  touch "$STATE_DIR/seeded"
fi

# 워커를 늘리면 모델 캐시(DEF-IT-001)가 프로세스마다 따로 잡힌다 — 메모리를 보고 올려라.
exec uvicorn app:app --host 0.0.0.0 --port 8000 --workers "${UVICORN_WORKERS:-1}"
