"""마스터/트랜잭션 CRUD 의 요청·응답 모델 — `ts-types.md` §5·§9 와 **1:1**.

  * 와이어 포맷은 **snake_case** (`api-contract.md` §4.1). camelCase 변환은
    프론트 `lib/koryo-api.ts` 매퍼가 한다.
  * 응답 조립은 `src/api/dto.py` (개발2) 의 매퍼를 재사용한다.
    같은 테이블의 DTO 를 두 벌 만들면 화면마다 다른 필드를 받는다.
  * `Decimal` 은 매퍼가 `float` 으로 바꾼 뒤 여기로 들어온다 (`DEF-IT-002`).
  * 필드명·null 허용 여부를 임의로 바꾸지 마라. 바꾸려면 `ts-types.md` 부터 고쳐라.
"""
from __future__ import annotations

import datetime as dt
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# ── 도메인 열거형 (DB 허용값과 1:1 — `ts-types.md` §4) ──────────────────
LotStatus = Literal["pass", "fail", "warning", "pending"]
EquipmentState = Literal["normal", "warning", "error", "maintenance"]
AlertLevel = Literal["info", "warning", "critical"]
ReceiptStatus = Literal["accepted", "rejected", "inspecting"]
ClaimStatus = Literal["open", "analyzing", "resolved", "rejected"]
MasterGroupCode = Literal["QUALITY_STD", "WORK_STD", "SUPPLIER", "PRODUCT", "STATUS"]

#: 종결 상태 — `resolution` 이 없으면 422 (`api-contract.md` §8.5.1)
CLAIM_CLOSED_STATES = ("resolved", "rejected")

#: 성분 합계 허용 오차 — goal.md 2.3 "배합 합계 정확히 100.0%"
COMPOSITION_SUM_TOLERANCE = 0.05
COMPOSITION_SUM_MESSAGE = "성분 합계는 100%여야 합니다"


class _Out(BaseModel):
    """응답 모델 공통 — 정의되지 않은 필드는 응답에서 잘라낸다."""

    model_config = ConfigDict(extra="ignore")


# ══════════════════════════════════════════════════════════════════════════
# suppliers — `ts-types.md` §5.1
# ══════════════════════════════════════════════════════════════════════════
class SupplierOut(_Out):
    id: int
    code: str
    name: str
    contact: str | None
    primary_material: str | None
    active: bool
    created_at: str


class SupplierIn(BaseModel):
    code: str = Field(..., max_length=10)
    name: str = Field(..., max_length=100)
    contact: str | None = Field(None, max_length=200)
    primary_material: str | None = Field(None, max_length=50)
    active: bool = True


class SupplierPatch(BaseModel):
    name: str | None = Field(None, max_length=100)
    contact: str | None = Field(None, max_length=200)
    primary_material: str | None = Field(None, max_length=50)
    active: bool | None = None


class SupplierStats(_Out):
    """`GET /suppliers/{code}/stats` — 공급사별 성분 안정성 (FE-RT-09·12)."""

    lot_count: int
    avg_quality: float | None
    pass_rate: float | None
    sn_std: float | None
    ag_std: float | None
    cu_std: float | None


# ══════════════════════════════════════════════════════════════════════════
# lots — `ts-types.md` §5.1
# ══════════════════════════════════════════════════════════════════════════
class LotOut(_Out):
    lot_id: str
    date: str
    supplier_code: str | None
    sn_ratio: float
    ag_ratio: float
    cu_ratio: float
    pb_ratio: float
    temperature: float | None
    time_min: int | None
    quality_score: float | None
    status: str
    created_at: str
    updated_at: str


class ComponentOut(_Out):
    id: int
    lot_id: str | None
    date: str
    sn: float
    ag: float
    cu: float
    pb: float
    sn_deviation: float
    ag_deviation: float
    cu_deviation: float
    analysis_method: str | None
    created_at: str


class QualityOut(_Out):
    id: int
    lot_id: str | None
    score: float
    passed: bool
    model_used: str
    predicted_score: float | None
    tested_at: str


class ShipmentOut(_Out):
    id: int
    lot_id: str | None
    customer: str
    product: str
    quantity: float
    unit: str
    shipped_at: str


class LotDetailOut(LotOut):
    """`GET /lots/{lot_id}` — 성분·품질·출하 조인 (`ts-types.md` §5.1)."""

    components: list[ComponentOut]
    quality: list[QualityOut]
    shipments: list[ShipmentOut]


class LotStatusPatch(BaseModel):
    status: LotStatus


# ══════════════════════════════════════════════════════════════════════════
# components — 편차는 **서버가 계산한다** (`api-contract.md` §8.3)
# ══════════════════════════════════════════════════════════════════════════
class ComponentIn(BaseModel):
    lot_id: str = Field(..., description="문자열 LOT ID (LOT-2026-001)")
    date: dt.date
    sn: float = Field(..., ge=0, le=100)
    ag: float = Field(..., ge=0, le=100)
    cu: float = Field(..., ge=0, le=100)
    pb: float = Field(..., ge=0, le=100)
    analysis_method: str | None = Field("XRF", max_length=20)

    @model_validator(mode="after")
    def _sum_100(self):
        """goal.md 2.3 하드 룰 — 합계 100% 가 아니면 **422**."""
        if abs(self.sn + self.ag + self.cu + self.pb - 100.0) > COMPOSITION_SUM_TOLERANCE:
            raise ValueError(COMPOSITION_SUM_MESSAGE)
        return self


# ══════════════════════════════════════════════════════════════════════════
# quality — `passed` 는 **서버가 계산한다** (SF-TD5 §3.4)
# ══════════════════════════════════════════════════════════════════════════
class QualityIn(BaseModel):
    lot_id: str
    score: float = Field(..., ge=0, le=100)
    model_used: str = Field(..., max_length=30)
    predicted_score: float | None = Field(None, ge=0, le=100)


class QualityCertificate(_Out):
    """`GET /quality/{lot_id}/certificate` — **JSON 만** 반환한다.

    PDF 생성은 `ISS-001` 로 v1.1 범위 밖이다 (goal.md 2.7).
    """

    lot_id: str
    date: str
    supplier: str | None
    components: ComponentOut | None
    score: float | None
    passed: bool | None
    issued_at: str


# ══════════════════════════════════════════════════════════════════════════
# shipments
# ══════════════════════════════════════════════════════════════════════════
class ShipmentIn(BaseModel):
    lot_id: str
    customer: str = Field(..., max_length=100)
    product: str = Field(..., max_length=100)
    quantity: float = Field(..., gt=0)
    unit: str = Field("kg", max_length=10)


class ShipmentCalendarRow(_Out):
    """`GET /shipments/calendar` — **벌거벗은 배열** (§4.2 예외)."""

    date: str
    count: int
    quantity: float


# ══════════════════════════════════════════════════════════════════════════
# receipts — `ts-types.md` §9.1
# ══════════════════════════════════════════════════════════════════════════
class ReceiptOut(_Out):
    id: int
    receipt_no: str
    date: str
    supplier_code: str | None
    material: str
    quantity: float
    unit: str
    status: str
    sn_pct: float | None
    ag_pct: float | None
    cu_pct: float | None
    pb_pct: float | None
    analysis_method: str | None
    #: 서버 계산 (저장 컬럼 아님). 측정 전이면 null.
    #: ⚠ **경고 배지에 쓰지 마라** — 원재료는 단일 원소라 배합 목표 62.0% 와의
    #:   차이가 품질 편차가 아니다 (`api-contract.md` §8.3.1).
    deviations: dict[str, float] | None
    created_at: str


class ReceiptIn(BaseModel):
    date: dt.date
    supplier_code: str
    material: str = Field(..., max_length=50)
    quantity: float = Field(..., gt=0)
    unit: str = Field("kg", max_length=10)
    status: ReceiptStatus = "inspecting"


class ReceiptPatch(BaseModel):
    """검사 결과 입력 (FE-RT-06). 전달된 키만 갱신한다."""

    status: ReceiptStatus | None = None
    sn_pct: float | None = Field(None, ge=0, le=100)
    ag_pct: float | None = Field(None, ge=0, le=100)
    cu_pct: float | None = Field(None, ge=0, le=100)
    pb_pct: float | None = Field(None, ge=0, le=100)
    analysis_method: str | None = Field(None, max_length=20)


# ══════════════════════════════════════════════════════════════════════════
# claims — `ts-types.md` §9.2
# ══════════════════════════════════════════════════════════════════════════
class ClaimOut(_Out):
    id: int
    claim_no: str
    lot_id: str | None
    customer: str
    reason: str
    status: str
    resolution: str | None
    resolved_at: str | None
    created_at: str


class ClaimIn(BaseModel):
    lot_id: str
    customer: str = Field(..., max_length=100)
    reason: str = Field(..., min_length=1)


class ClaimPatch(BaseModel):
    """`resolved`/`rejected` 로 보내면서 `resolution` 이 비면 **422** (§8.5.1).

    역행 전이(`resolved` → `open`)는 **거부하지 않는다.** 상태 그래프는
    UI 가드이지 API 검증이 아니다 — 프론트가 확인 대화상자만 띄운다.
    """

    status: ClaimStatus
    resolution: str | None = None

    @model_validator(mode="after")
    def _closed_needs_resolution(self):
        if self.status in CLAIM_CLOSED_STATES and not (self.resolution or "").strip():
            raise ValueError("처리 내용을 입력해야 처리완료로 변경할 수 있습니다")
        return self


class ClaimHistoryState(_Out):
    status: str | None = None
    resolution: str | None = None


class ClaimHistoryOut(_Out):
    """`GET /claims/{claim_no}/history` — **벌거벗은 배열** (§4.2 예외).

    ⚠ `ip_address` 를 포함하지 마라 — 감사 정보는 `admin` 전용 `/audit-logs` 소관이다.
    """

    changed_at: str
    changed_by_username: str | None
    before: ClaimHistoryState | None
    after: ClaimHistoryState | None


# ══════════════════════════════════════════════════════════════════════════
# equipment — `temp_warning` 은 **서버가 판정한다** (§8.6)
# ══════════════════════════════════════════════════════════════════════════
class EquipmentOut(_Out):
    id: int
    eq_id: str
    name: str
    status: str
    temperature: float | None
    uptime: int | None
    last_maintenance: str | None
    temp_warning: bool
    updated_at: str


# ══════════════════════════════════════════════════════════════════════════
# process_conditions / condition_history — `ts-types.md` §9.3·§9.4
# ══════════════════════════════════════════════════════════════════════════
class ProcessConditionOut(_Out):
    id: int
    product_code: str
    temp_min: float
    temp_max: float
    time_min: int
    time_max: int
    speed: float | None
    version: int
    active: bool
    created_at: str


class ProcessConditionIn(BaseModel):
    product_code: str = Field(..., max_length=30)
    temp_min: float = Field(..., ge=0)
    temp_max: float = Field(..., ge=0)
    time_min: int = Field(..., ge=0)
    time_max: int = Field(..., ge=0)
    speed: float | None = Field(None, ge=0)
    active: bool = True

    @model_validator(mode="after")
    def _ranges(self):
        if self.temp_min > self.temp_max:
            raise ValueError("temp_min 은 temp_max 보다 클 수 없습니다")
        if self.time_min > self.time_max:
            raise ValueError("time_min 은 time_max 보다 클 수 없습니다")
        return self


class ProcessConditionPatch(BaseModel):
    """부분 갱신. `product_code` 는 **변경 불가**다 (`ts-types.md` §9.3)."""

    temp_min: float | None = Field(None, ge=0)
    temp_max: float | None = Field(None, ge=0)
    time_min: int | None = Field(None, ge=0)
    time_max: int | None = Field(None, ge=0)
    speed: float | None = Field(None, ge=0)
    active: bool | None = None


class ConditionHistoryOut(_Out):
    kind: Literal["condition"]
    id: int
    created_at: str
    condition_id: int
    product_code: str | None
    changed_by_username: str | None
    before: dict[str, Any] | None
    after: dict[str, Any] | None


class AlarmHistoryOut(_Out):
    kind: Literal["alarm"]
    id: int
    created_at: str
    level: str
    message: str
    lot_id: str | None
    resolved: bool
    resolved_at: str | None


#: 판별 유니온 — 프론트는 `kind` 로 좁힌다 (`ts-types.md` §9.4).
ProcessHistoryOut = Annotated[
    ConditionHistoryOut | AlarmHistoryOut, Field(discriminator="kind")
]


# ══════════════════════════════════════════════════════════════════════════
# master_codes — `ts-types.md` §9.7
# ══════════════════════════════════════════════════════════════════════════
class MasterCodeOut(_Out):
    id: int
    group_code: str
    code: str
    name: str
    value: dict[str, Any] | None
    sort_order: int
    version: int
    active: bool
    created_at: str


class MasterCodeGroupOut(_Out):
    """`GET /master/code-groups` — **벌거벗은 배열**."""

    group_code: str
    count: int


class MasterCodeIn(BaseModel):
    group_code: MasterGroupCode
    code: str = Field(..., max_length=30)
    name: str = Field(..., max_length=100)
    sort_order: int = 0


class MasterCodePatch(BaseModel):
    name: str | None = Field(None, max_length=100)
    sort_order: int | None = None
    active: bool | None = None


class QualityStandardIn(BaseModel):
    """FE-RT-30. `master_codes(group_code='QUALITY_STD')` 의 `value` JSONB 로 저장된다.

    `master_codes.name` 은 NOT NULL 인데 계약 요청 본문에 `name` 이 없다
    → `"{product_code} 품질 기준"` 으로 서버가 채운다.
    """

    product_code: str = Field(..., max_length=30)
    sn_min: float
    sn_max: float
    ag_min: float
    ag_max: float
    cu_min: float
    cu_max: float
    pb_min: float
    pb_max: float
    pass_score: int = Field(..., ge=0, le=100)

    @model_validator(mode="after")
    def _ranges(self):
        for lo, hi, label in (
            (self.sn_min, self.sn_max, "sn"), (self.ag_min, self.ag_max, "ag"),
            (self.cu_min, self.cu_max, "cu"), (self.pb_min, self.pb_max, "pb"),
        ):
            if lo > hi:
                raise ValueError(f"{label}_min 은 {label}_max 보다 클 수 없습니다")
        return self


class QualityStandardPatch(BaseModel):
    sn_min: float | None = None
    sn_max: float | None = None
    ag_min: float | None = None
    ag_max: float | None = None
    cu_min: float | None = None
    cu_max: float | None = None
    pb_min: float | None = None
    pb_max: float | None = None
    pass_score: int | None = Field(None, ge=0, le=100)
    active: bool | None = None


class WorkStandardIn(BaseModel):
    """FE-RT-31. `master_codes(group_code='WORK_STD')` 로 저장된다.

    `process_code` → `code`, `title` → `name`, `content` → `value.content`.
    """

    process_code: str = Field(..., max_length=30)
    title: str = Field(..., max_length=100)
    content: str
    version: int = Field(1, ge=1)
    author: str | None = Field(None, max_length=100)


class WorkStandardPatch(BaseModel):
    """**버전은 서버가 자동 증가**시킨다 (`api-contract.md` §8.8). 본문에 넣지 마라."""

    title: str | None = Field(None, max_length=100)
    content: str | None = None
    author: str | None = Field(None, max_length=100)
    active: bool | None = None
