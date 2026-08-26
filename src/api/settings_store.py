"""`system_settings` 키-값 접근 계층 — FE-RT-29 · FE-RT-33 · 전 화면.

`system_settings` 는 **`id` 대리키가 없는 유일한 테이블**이다 (`key` 가 자연 PK).
`db-schema.md` §6.8.

### 네임스페이스 경계 (`api-contract.md` §8.7)
| 엔드포인트 | 읽고 쓰는 키 | 화면 |
|---|---|---|
| `/settings` | `ml.*` · `quality.*` · `equipment.*` · `deviation.*` | FE-RT-29 |
| `/integrations` | **`integration.*` 만** | FE-RT-33 |

두 화면이 같은 키를 편집하면 서로의 변경을 덮어쓴다. `GET /settings` 는
`integration.*` 를 **반환하지 않는다.** `PUT` 은 둘 다 **자기 네임스페이스 안에서만**
갱신한다.

### 기본값
행이 없으면 계약값으로 떨어진다. 목표값 3종은 `src/features/engineering.py` 의
모듈 상수를 임포트해서 쓴다 — **숫자 62.0 을 API 코드에 다시 쓰지 마라**
(`api-contract.md` §8.3).
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from src.db.models import SystemSetting
from src.features.engineering import AG_TARGET, CU_TARGET, SN_TARGET

# ── 키 상수 ─────────────────────────────────────────────────────────────
K_SN_TARGET = "ml.sn_target"
K_AG_TARGET = "ml.ag_target"
K_CU_TARGET = "ml.cu_target"
K_PASS_SCORE = "quality.pass_score"
K_WARN_SCORE = "quality.warn_score"
K_TEMP_WARN = "equipment.temp_warn_c"
K_DEV_SN = "deviation.warn_sn"
K_DEV_AG = "deviation.warn_ag"
K_DEV_CU = "deviation.warn_cu"

#: `PUT /settings` 로 **변경 불가**한 키 (§8.7). 오면 422.
READONLY_KEYS = frozenset({K_SN_TARGET, K_AG_TARGET, K_CU_TARGET})

#: `/settings` 가 다루는 네임스페이스. `integration.*` 는 여기 없다.
SETTINGS_PREFIXES = ("ml.", "quality.", "equipment.", "deviation.")
INTEGRATION_PREFIX = "integration."

#: 계약 기본값. `system_settings` 에 행이 없을 때 쓴다.
#: 값은 goal.md 2.3 하드 비즈니스 룰 · `ts-types.md` §4 상수와 동일하다.
DEFAULTS: dict[str, tuple[Any, str, str]] = {
    K_SN_TARGET:  (SN_TARGET, "number", "Sn 목표 (읽기 전용 — 모델 재학습 필요)"),
    K_AG_TARGET:  (AG_TARGET, "number", "Ag 목표 (읽기 전용 — 모델 재학습 필요)"),
    K_CU_TARGET:  (CU_TARGET, "number", "Cu 목표 (읽기 전용 — 모델 재학습 필요)"),
    K_PASS_SCORE: (70, "number", "품질 합격 기준점"),
    K_WARN_SCORE: (80, "number", "LOT 상태 pass/warning 경계"),
    K_TEMP_WARN:  (255, "number", "설비 온도 경고 (°C 초과)"),
    K_DEV_SN:     (2.0, "number", "Sn 편차 경고 임계 (±)"),
    K_DEV_AG:     (0.3, "number", "Ag 편차 경고 임계 (±)"),
    K_DEV_CU:     (0.1, "number", "Cu 편차 경고 임계 (±)"),
}

#: `/integrations` 저장 키 6종 (`api-contract.md` §8.9.1).
#: ⚠ `db-schema.md` §8.4 는 `auth_type`/`username`/`timeout_ms`/`last_sync_at`/`status`
#:   까지 열거하지만, **API 계약 §8.9.1 이 3키(enabled/endpoint/type)로 확정**했고
#:   `last_sync_at`/`status` 는 저장하지 않는다고 명시했다. API 계약이 정본이다.
INTEGRATION_SYSTEMS = ("erp", "xrf")
INTEGRATION_DEFAULTS: dict[str, dict[str, Any]] = {
    "erp": {"enabled": False, "endpoint": "", "type": "REST"},
    "xrf": {"enabled": False, "endpoint": "", "type": "REST"},
}


# ── 타입 변환 ────────────────────────────────────────────────────────────
def _coerce(raw: str, value_type: str) -> Any:
    if value_type == "number":
        try:
            f = float(raw)
        except (TypeError, ValueError):
            return None
        return int(f) if f.is_integer() else f
    if value_type == "boolean":
        return str(raw).strip().lower() in ("true", "1", "yes", "on")
    if value_type == "json":
        import json
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return None
    return raw


def _to_str(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _type_of(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, (dict, list)):
        return "json"
    return "string"


# ── 읽기 ────────────────────────────────────────────────────────────────
def load(db: Session, prefixes: tuple[str, ...] | None = None) -> dict[str, Any]:
    """`system_settings` 를 `{key: 파싱된 값}` 으로 읽는다. 없는 키는 기본값."""
    rows = db.execute(select(SystemSetting)).scalars().all()
    values: dict[str, Any] = {k: v[0] for k, v in DEFAULTS.items()}
    for row in rows:
        values[row.key] = _coerce(row.value, row.value_type)
    if prefixes is not None:
        values = {k: v for k, v in values.items() if k.startswith(prefixes)}
    return values


def get(db: Session, key: str, default: Any = None) -> Any:
    row = db.get(SystemSetting, key)
    if row is None:
        fallback = DEFAULTS.get(key)
        return fallback[0] if fallback else default
    return _coerce(row.value, row.value_type)


def upsert(db: Session, key: str, value: Any, *, updated_by: int | None = None,
           description: str | None = None) -> None:
    """행이 있으면 갱신, 없으면 삽입. **커밋은 호출자가 한다.**"""
    row = db.get(SystemSetting, key)
    value_type = _type_of(value)
    if row is None:
        default = DEFAULTS.get(key)
        db.add(SystemSetting(
            key=key,
            value=_to_str(value),
            value_type=value_type,
            description=description or (default[2] if default else None),
            updated_by=updated_by,
        ))
    else:
        row.value = _to_str(value)
        row.value_type = value_type
        if description is not None:
            row.description = description
        row.updated_by = updated_by


# ── 화면용 조립 ──────────────────────────────────────────────────────────
def public_settings(db: Session) -> dict:
    """`GET /settings/public` — 화면 렌더용 읽기 전용 임계값 **7종이 전부다**.

    `api-contract.md` §8.1.1:
    > ⛔ **절대 포함하지 마라**: `integration.*` (ERP/XRF 접속정보) · `updated_by` ·
    > 그 밖의 운영 파라미터. 새 키를 추가하려면 "비관리자가 화면을 그리는 데
    > 반드시 필요한가"를 먼저 통과시켜라.
    """
    v = load(db, prefixes=SETTINGS_PREFIXES)
    return {
        "sn_target": v[K_SN_TARGET],
        "ag_target": v[K_AG_TARGET],
        "cu_target": v[K_CU_TARGET],
        "quality_pass_score": v[K_PASS_SCORE],
        "quality_warn_score": v[K_WARN_SCORE],
        "temp_warn_c": v[K_TEMP_WARN],
        "deviation_warn": {"sn": v[K_DEV_SN], "ag": v[K_DEV_AG], "cu": v[K_DEV_CU]},
    }


def admin_settings(db: Session) -> dict:
    """`GET /settings` (admin 전용) — `SystemSettingsDto` (`ts-types.md` §9.6).

    `integration.*` 는 반환하지 않는다 (§8.7 네임스페이스 경계).
    """
    from src.api.serialization import iso
    from src.db.models import User

    v = load(db, prefixes=SETTINGS_PREFIXES)

    latest = None
    rows = db.execute(select(SystemSetting)).scalars().all()
    tracked = [r for r in rows if r.key.startswith(SETTINGS_PREFIXES)]
    if tracked:
        latest = max(tracked, key=lambda r: r.updated_at)

    username = None
    if latest is not None and latest.updated_by is not None:
        user = db.get(User, latest.updated_by)
        username = user.username if user else None

    return {
        "sn_target": v[K_SN_TARGET],
        "ag_target": v[K_AG_TARGET],
        "cu_target": v[K_CU_TARGET],
        "quality_pass_score": v[K_PASS_SCORE],
        "temp_warn_c": v[K_TEMP_WARN],
        "deviation_warn": {"sn": v[K_DEV_SN], "ag": v[K_DEV_AG], "cu": v[K_DEV_CU]},
        "updated_by_username": username,
        "updated_at": iso(latest.updated_at) if latest is not None else None,
    }


def integrations(db: Session) -> list[dict]:
    """`GET /integrations` — 벌거벗은 배열, `system` 이 식별자 (§8.9.1).

    `last_sync_at` 은 **항상 `null`** (담을 컬럼이 없다).
    `status` 는 `enabled` 에서 **2값 파생** — `'in_use'` / `'not_in_use'`.
    **4값(연결됨/오류/동기화중/비활성)으로 만들지 마라. 근거가 없다.**

    ⛔ 자격증명(비밀번호·API 키) 필드를 절대 포함하지 마라. `admin` 이 화면에서
    평문으로 읽는다 — 자격증명은 서버 환경변수에 둔다 (`db-schema.md` §8.4).
    """
    rows = {r.key: r for r in db.execute(select(SystemSetting)).scalars().all()}
    out = []
    for system in INTEGRATION_SYSTEMS:
        base = INTEGRATION_DEFAULTS[system]
        def _v(field: str, default):
            row = rows.get(f"{INTEGRATION_PREFIX}{system}.{field}")
            return _coerce(row.value, row.value_type) if row is not None else default

        enabled = bool(_v("enabled", base["enabled"]))
        out.append({
            "system": system,
            "type": str(_v("type", base["type"])),
            "endpoint": str(_v("endpoint", base["endpoint"])),
            "enabled": enabled,
            "last_sync_at": None,
            "status": "in_use" if enabled else "not_in_use",
        })
    return out
