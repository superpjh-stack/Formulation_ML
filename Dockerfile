# 고려솔더 AI 스마트공장 — 백엔드(FastAPI + ML) 이미지
#
# `models/artifacts/*` 와 `data/raw/*` 는 git-ignored 라 레포에 없다.
# 그래서 이미지를 만들 때 표본 데이터를 생성하고 4개 모델을 학습한다 —
# CLAUDE.md "Performance Baseline" 의 수치가 이 경로로 재현된다.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# libgomp1  — xgboost/sklearn 의 OpenMP 런타임
# postgresql-client — entrypoint 의 pg_isready
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 postgresql-client curl \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
# 서버가 쓰지 않는 노트북/개발 의존성은 뺀다. app.py 와 src/ 어디서도 import 하지 않는다
# (jupyter 계열만 1GB 가 넘는다). requirements.txt 는 정본 그대로 두고 여기서만 거른다.
RUN grep -vE '^(jupyter|ipykernel|pytest|streamlit|matplotlib|seaborn)\b' requirements.txt > /tmp/req.txt \
 && pip install -r /tmp/req.txt

COPY . .

# 표본 데이터 → data/raw/{formulation_history,lots_seed}.csv  (seed_db.py 가 lots_seed.csv 를 읽는다)
# 학습      → models/artifacts/{name}.joblib + preprocessors_{name}.joblib + {name}_meta.json
RUN python data/raw/generate_sample.py \
 && for m in gradient_boosting xgboost random_forest ridge; do \
      python scripts/train.py --data formulation_history.csv --target quality_score --model "$m"; \
    done

RUN chmod +x docker/entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["docker/entrypoint.sh"]
