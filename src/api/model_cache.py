"""ML 모델 싱글톤 캐시 — `DEF-IT-001` 회귀 방지.

**결함이었던 것**: `app.py` 의 `_cache` 와 `src/doe/routes.py` 의 `_doe_cache` 가
독립적인 dict 라서 같은 모델(`gradient_boosting` 등)이 프로세스 안에 **두 벌** 적재됐다.
NFR-P-04(동시 접속 20명)에서 두 라우터가 동시에 첫 호출을 받으면 중복 로드가 겹친다.

**해소** (`api-contract.md` §2.3 `TODO-API-002`):
  * 프로세스 전역에 **이 모듈의 `_BUNDLES` 하나만** 둔다.
  * `app.py._cache` 와 `src/doe/routes.py._doe_cache` 는 **같은 dict 를 참조**하는
    별칭이다. 새 캐시를 만들지 마라.
  * 이름별 락으로 감싼 **double-checked locking** 이라, 20 스레드가 동시에
    같은 모델을 처음 요청해도 `joblib.load` 는 **정확히 한 번만** 실행된다.
    (서로 다른 모델은 서로를 막지 않는다 — 이름별 락이기 때문이다.)

`app.py` 는 동기(`def`) 핸들러이므로 FastAPI 가 스레드풀에서 돌린다 → 진짜 스레드
경합이 발생한다. `asyncio.Lock` 이 아니라 `threading.Lock` 을 써야 하는 이유다.
"""
from __future__ import annotations

import threading

from fastapi import HTTPException

from src.features.engineering import load_preprocessors
from src.models.train import REGISTRY, load_model

# ── 프로세스 전역 단일 캐시 ──────────────────────────────────────────────
_BUNDLES: dict[str, dict] = {}

_REGISTRY_LOCK = threading.Lock()
_NAME_LOCKS: dict[str, threading.Lock] = {}

#: 모델 파일 없음 — `api-contract.md` §5 가 규정한 정확한 문구
MODEL_NOT_FOUND_DETAIL = "모델을 찾을 수 없습니다"


def _name_lock(model_name: str) -> threading.Lock:
    with _REGISTRY_LOCK:
        lock = _NAME_LOCKS.get(model_name)
        if lock is None:
            lock = threading.Lock()
            _NAME_LOCKS[model_name] = lock
        return lock


def get_bundle(model_name: str) -> dict:
    """`{"model", "imputer", "scaler"}` 번들을 반환한다. 없으면 404.

    이미 적재돼 있으면 락을 잡지 않는다 (fast path).
    """
    bundle = _BUNDLES.get(model_name)
    if bundle is not None:
        return bundle

    with _name_lock(model_name):
        # double-check — 락 대기 중 다른 스레드가 적재했을 수 있다
        bundle = _BUNDLES.get(model_name)
        if bundle is not None:
            return bundle
        try:
            model = load_model(model_name)
            imputer, scaler = load_preprocessors(name=model_name)
        except FileNotFoundError:
            # SF-TD4 §5 / api-contract.md §5 — 404 "모델을 찾을 수 없습니다"
            raise HTTPException(status_code=404, detail=MODEL_NOT_FOUND_DETAIL)
        _BUNDLES[model_name] = {"model": model, "imputer": imputer, "scaler": scaler}
        return _BUNDLES[model_name]


def get_bundle_checked(model_name: str) -> dict:
    """레지스트리에 없는 이름이면 400, 아티팩트가 없으면 404."""
    if model_name not in REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"알 수 없는 모델: '{model_name}'. 가능한 모델: {list(REGISTRY.keys())}",
        )
    return get_bundle(model_name)


def shared_cache() -> dict:
    """별칭용 — `app.py` / `src/doe/routes.py` 가 이 dict 를 그대로 참조한다."""
    return _BUNDLES


def loaded_model_names() -> list[str]:
    return list(_BUNDLES.keys())


def preload(names: tuple[str, ...] = ("gradient_boosting", "xgboost", "random_forest")) -> list[str]:
    """서버 기동 시 사전 적재. 실패는 무시한다 (아티팩트 없는 환경 대응)."""
    ok: list[str] = []
    for name in names:
        try:
            get_bundle(name)
            ok.append(name)
        except HTTPException:
            continue
    return ok
