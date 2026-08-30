"""SF-TD5 데이터베이스설계서 §2~§3 을 그대로 옮긴 SQLAlchemy 2.0 모델.

원칙
  * 컬럼명·타입·NOT NULL·기본값·UK/FK 는 **SF-TD5 §3 표 그대로**다.
  * `shipments` 만은 §3 에 컬럼 정의가 없다. **§2 ERD 필드를 스펙으로 삼았고**
    타입은 인접 테이블 관례에서 유추했다 (contracts/db-schema.md §3.10 참조).
  * 인덱스는 SF-TD5 §3.1 의 SQL 3개(idx_lots_date / idx_lots_supplier /
    idx_lots_status)를 이름까지 동일하게 만든다.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from src.agent.embed import EMBED_DIM


class Base(DeclarativeBase):
    pass


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.3 suppliers (공급사)
# ══════════════════════════════════════════════════════════════════════════
class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(200))
    primary_material: Mapped[str | None] = mapped_column(String(50))
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    lots: Mapped[list["Lot"]] = relationship(back_populates="supplier")


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.1 lots (LOT 정보)
# ══════════════════════════════════════════════════════════════════════════
class Lot(Base):
    __tablename__ = "lots"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    supplier_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False
    )
    sn_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    ag_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    cu_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    pb_ratio: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    temperature: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    time_min: Mapped[int | None] = mapped_column(Integer)
    quality_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # pass / fail / warning / pending
    status: Mapped[str] = mapped_column(String(10), nullable=False, server_default="pending")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    supplier: Mapped["Supplier"] = relationship(back_populates="lots")
    components: Mapped[list["Component"]] = relationship(back_populates="lot")
    quality_results: Mapped[list["Quality"]] = relationship(back_populates="lot")
    shipments: Mapped[list["Shipment"]] = relationship(back_populates="lot")
    alerts: Mapped[list["Alert"]] = relationship(back_populates="lot")

    __table_args__ = (
        Index("idx_lots_date", date.desc()),
        Index("idx_lots_supplier", "supplier_id"),
        Index("idx_lots_status", "status"),
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.2 components (성분 데이터)
# ══════════════════════════════════════════════════════════════════════════
class Component(Base):
    __tablename__ = "components"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lots.id", ondelete="RESTRICT"), nullable=False
    )
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    sn: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    ag: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    cu: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    pb: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    sn_deviation: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    ag_deviation: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    cu_deviation: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    analysis_method: Mapped[str | None] = mapped_column(String(20), server_default="XRF")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    lot: Mapped["Lot"] = relationship(back_populates="components")


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.4 quality (품질 검사 결과)
# ══════════════════════════════════════════════════════════════════════════
class Quality(Base):
    __tablename__ = "quality"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lots.id", ondelete="RESTRICT"), nullable=False
    )
    score: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)  # 점수 >= 70
    model_used: Mapped[str] = mapped_column(String(30), nullable=False)
    predicted_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    tested_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    lot: Mapped["Lot"] = relationship(back_populates="quality_results")


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.5 equipment (설비)
# ══════════════════════════════════════════════════════════════════════════
class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    eq_id: Mapped[str] = mapped_column(String(10), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # normal / warning / error / maintenance
    status: Mapped[str] = mapped_column(String(15), nullable=False, server_default="normal")
    temperature: Mapped[Decimal | None] = mapped_column(Numeric(5, 1))
    uptime: Mapped[int | None] = mapped_column(Integer, server_default="0")
    last_maintenance: Mapped[dt.date | None] = mapped_column(Date)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.6 ml_models (ML 모델 이력)
# ══════════════════════════════════════════════════════════════════════════
class MlModel(Base):
    __tablename__ = "ml_models"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(30), nullable=False)
    model_type: Mapped[str] = mapped_column(String(30), nullable=False)
    rmse: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))
    r2: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))
    mape: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))
    train_samples: Mapped[int | None] = mapped_column(Integer)
    artifact_path: Mapped[str] = mapped_column(String(255), nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    trained_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.7 alerts (알림)
# ══════════════════════════════════════════════════════════════════════════
class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False)  # info/warning/critical
    message: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str | None] = mapped_column(String(30))  # system/ml/equipment
    lot_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("lots.id", ondelete="SET NULL")
    )
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    lot: Mapped["Lot | None"] = relationship(back_populates="alerts")


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.8 users (사용자)
# ══════════════════════════════════════════════════════════════════════════
class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    email: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # admin / manufacture / quality / sales / viewer
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default="viewer")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    last_login: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    audit_logs: Mapped[list["AuditLog"]] = relationship(back_populates="user")


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.9 audit_logs (감사 로그)
#   보관 1년 (SF-TD5 §4 / NFR-S-04). 월별 파티셔닝은 SF-TD5 §3.9 가 권고하나
#   v1 에서는 단일 테이블 + created_at 인덱스로 시작한다 — db-schema.md §5 참조.
# ══════════════════════════════════════════════════════════════════════════
class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    # CREATE / UPDATE / DELETE / LOGIN / PREDICT
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    target_table: Mapped[str | None] = mapped_column(String(50))
    target_id: Mapped[int | None] = mapped_column(BigInteger)
    detail: Mapped[dict | None] = mapped_column(JSONB)
    ip_address: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    user: Mapped["User | None"] = relationship(back_populates="audit_logs")

    __table_args__ = (Index("idx_audit_logs_created", created_at.desc()),)


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §2 ERD shipments (출하)
#   ⚠ SF-TD5 §3 에 컬럼 정의 표가 **없다**. §2 ERD 의 7개 필드
#     (id / lot_id / customer / product / quantity / unit / shipped_at) 를
#     스펙으로 삼고, 타입은 인접 테이블 관례 + mock-data.ts SHIPPING_HISTORY
#     의 값(customer 'CUST-A', product 'Sn62 솔더', quantity 200, unit 'kg')에서 유추했다.
#     created_at 은 ERD 에 없으므로 **추가하지 않는다**.
# ══════════════════════════════════════════════════════════════════════════
class Shipment(Base):
    __tablename__ = "shipments"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    lot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lots.id", ondelete="RESTRICT"), nullable=False
    )
    customer: Mapped[str] = mapped_column(String(100), nullable=False)
    product: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, server_default="kg")
    shipped_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    lot: Mapped["Lot"] = relationship(back_populates="shipments")


# ╔════════════════════════════════════════════════════════════════════════╗
# ║  CR-DB-001 (승인 2026-08-25) — SF-TD5 개정 §3.11~§3.18                  ║
# ║                                                                        ║
# ║  SF-TD5 v1.0 의 10개 테이블로는 44화면 중 29화면만 커버됐다.            ║
# ║  나머지 15화면(필수 요구사항 12건 포함)이 저장할 곳이 없어              ║
# ║  아키텍트가 8개 테이블 추가를 제안했고 도입기업이 승인했다.             ║
# ║  SF-TD5 문서도 같은 날 개정반영됐다 (v1.1).                             ║
# ╚════════════════════════════════════════════════════════════════════════╝


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.11 receipts (원재료 입고)  ← FE-RT-06 입고 현황 / FE-RT-07 입고 이력
#   FR-R-01 (입고 현황 조회) · FR-R-02 (입고 이력 조회) — 둘 다 필수
# ══════════════════════════════════════════════════════════════════════════
class Receipt(Base):
    __tablename__ = "receipts"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    receipt_no: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    date: Mapped[dt.date] = mapped_column(Date, nullable=False)
    supplier_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("suppliers.id", ondelete="RESTRICT"), nullable=False
    )
    material: Mapped[str] = mapped_column(String(50), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, server_default="kg")
    # accepted / rejected / inspecting
    status: Mapped[str] = mapped_column(
        String(15), nullable=False, server_default="inspecting"
    )
    # ── CR-DB-003 (기획1 TODO-G1-019) ────────────────────────────────────
    # FR-R-02(입고 이력, 필수)가 "성분 데이터 포함"을 요구하는데 조인 키가 없었다.
    # `components` 는 `lot_id NOT NULL FK(lots)` 라 **생산 LOT 전용**이고,
    # 입고 시점 원재료에는 아직 LOT 이 없다. NOT NULL 을 푸는 건 SF-TD5 v1.0
    # §3.2 를 거스르므로, 입고 시점 실측치를 receipts 에 직접 둔다.
    # status='inspecting' 구간에서는 미측정이므로 전부 NULL 허용.
    sn_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))
    ag_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))
    cu_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))
    pb_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 3))
    analysis_method: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    supplier: Mapped["Supplier"] = relationship()

    __table_args__ = (
        Index("idx_receipts_date", date.desc()),
        Index("idx_receipts_supplier", "supplier_id"),
        Index("idx_receipts_status", "status"),
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.12 claims (고객 클레임)  ← FE-RT-19 클레임 관리
#   FR-S-04 (클레임 관리) — 필수
# ══════════════════════════════════════════════════════════════════════════
class Claim(Base):
    __tablename__ = "claims"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    claim_no: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    lot_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("lots.id", ondelete="RESTRICT"), nullable=False
    )
    customer: Mapped[str] = mapped_column(String(100), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    # open / analyzing / resolved / rejected
    status: Mapped[str] = mapped_column(String(15), nullable=False, server_default="open")
    resolution: Mapped[str | None] = mapped_column(Text)
    resolved_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    lot: Mapped["Lot"] = relationship()

    __table_args__ = (
        Index("idx_claims_status", "status"),
        Index("idx_claims_lot", "lot_id"),
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.13 process_conditions (표준 공정 조건)  ← FE-RT-23 공정 조건
#   FR-P-03 (공정 조건 관리) — 필수
# ══════════════════════════════════════════════════════════════════════════
class ProcessCondition(Base):
    __tablename__ = "process_conditions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    product_code: Mapped[str] = mapped_column(String(30), nullable=False)
    temp_min: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    temp_max: Mapped[Decimal] = mapped_column(Numeric(5, 1), nullable=False)
    time_min: Mapped[int] = mapped_column(Integer, nullable=False)
    time_max: Mapped[int] = mapped_column(Integer, nullable=False)
    speed: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    history: Mapped[list["ConditionHistory"]] = relationship(back_populates="condition")

    __table_args__ = (
        # 제품코드 + 버전은 유일하다 (개정 시 version 증가)
        UniqueConstraint("product_code", "version", name="uq_process_conditions_product_version"),
        Index("idx_process_conditions_product", "product_code"),
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.14 condition_history (공정 조건 변경 이력)  ← FE-RT-24 이력 조회
#   FR-P-04 (이력 조회) — 필수
# ══════════════════════════════════════════════════════════════════════════
class ConditionHistory(Base):
    __tablename__ = "condition_history"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    condition_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("process_conditions.id", ondelete="RESTRICT"), nullable=False
    )
    changed_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    before: Mapped[dict | None] = mapped_column(JSONB)
    after: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    condition: Mapped["ProcessCondition"] = relationship(back_populates="history")
    user: Mapped["User | None"] = relationship()

    __table_args__ = (Index("idx_condition_history_created", created_at.desc()),)


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.15 notification_rules (알림 규칙)  ← FE-RT-28 알림 설정
#   FR-SY-03 (알림 설정) — 필수
# ══════════════════════════════════════════════════════════════════════════
class NotificationRule(Base):
    __tablename__ = "notification_rules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # quality_fail / deviation_exceed / equipment_warning
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    threshold: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    # email / system
    channel: Mapped[str] = mapped_column(String(10), nullable=False, server_default="system")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # 이벤트 유형 + 채널 조합은 하나만 존재한다
        UniqueConstraint("event_type", "channel", name="uq_notification_rules_event_channel"),
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.16 system_settings (시스템 설정)  ← FE-RT-29 시스템 설정
#   FR-SY-04 (시스템 설정) — 필수
#   ⚠ SN/AG/CU 목표값은 학습된 모델의 파생 피처 기준이므로 변경 시
#     모델 재학습이 필요하다 (api-contract.md §8.7).
# ══════════════════════════════════════════════════════════════════════════
class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    # number / string / boolean / json
    value_type: Mapped[str] = mapped_column(
        String(10), nullable=False, server_default="string"
    )
    description: Mapped[str | None] = mapped_column(String(200))
    updated_by: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL")
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    user: Mapped["User | None"] = relationship()


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.17 master_codes (기준정보 공통 코드)
#   ← FE-RT-30 품질 기준 / FE-RT-31 작업 표준 / FE-RT-32 코드 관리
#   FR-MD-01 · FR-MD-02 · FR-MD-03 (변경 제안 ID) — 셋 다 필수
#   group_code 로 3화면을 한 테이블에서 구분한다:
#     'QUALITY_STD' / 'WORK_STD' / 'SUPPLIER' / 'PRODUCT' / 'STATUS' ...
#   화면별 가변 항목(성분 상하한, 표준서 본문 등)은 value JSONB 에 담는다.
# ══════════════════════════════════════════════════════════════════════════
class MasterCode(Base):
    __tablename__ = "master_codes"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    group_code: Mapped[str] = mapped_column(String(30), nullable=False)
    code: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[dict | None] = mapped_column(JSONB)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # 버전 이력 보존용 — 같은 코드의 서로 다른 버전은 공존한다
        UniqueConstraint("group_code", "code", "version", name="uq_master_codes_group_code_version"),
        # ⚠ CR-DB-002 / 기획3 지적 — 위 UK 만으로는 같은 코드가 버전만 달리해
        #   **동시에 활성 상태로** 중복 저장된다. suppliers.code 등을 참조하는
        #   마스터 조회에서 정합성이 깨진다.
        #   → 부분 유니크 인덱스로 "활성 코드는 유일" 을 DB 레벨에서 강제한다.
        Index(
            "uq_master_codes_active_code",
            "group_code", "code",
            unique=True,
            postgresql_where=text("active"),
        ),
        Index("idx_master_codes_group", "group_code"),
    )


# ══════════════════════════════════════════════════════════════════════════
# SF-TD5 §3.18 kpi_targets (KPI 목표값)  ← FE-RT-45 KPI 설정
#   FR-K-03 (KPI 설정) — 필수. FE-RT-43·44 의 목표 대비 현황에도 쓰인다
# ══════════════════════════════════════════════════════════════════════════
class KpiTarget(Base):
    __tablename__ = "kpi_targets"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    # yield_pct / defect_rate / quality_avg / pass_rate / claim_rate / production_volume
    kpi_key: Mapped[str] = mapped_column(String(30), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)  # 'YYYY-MM'
    target_value: Mapped[Decimal] = mapped_column(Numeric(10, 3), nullable=False)
    actual_value: Mapped[Decimal | None] = mapped_column(Numeric(10, 3))
    # CR-DB-003 — 월 마감 스냅샷을 언제 집계했는지. NULL = 아직 마감 안 됨.
    # 화면의 "실적 집계 기준" 표시에 쓴다 (기획3 지적: 표시할 방법이 없었다).
    actual_updated_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        UniqueConstraint("kpi_key", "period", name="uq_kpi_targets_key_period"),
        Index("idx_kpi_targets_period", "period"),
    )


# ══════════════════════════════════════════════════════════════════════════
# agent-architecture.md §6.7 doc_sources / doc_chunks — RAG 색인
#
# 벡터 3컬럼은 **NULL 허용**이다. §6.7 은 NOT NULL 로 규정하지만 청크가 먼저
# 적재되고 임베딩이 나중에 붙는 순서라 값 없이 NOT NULL 을 걸 수 없다. 0 벡터로
# 채우면 차원만 맞는 무의미한 벡터가 색인에 들어가 AI 가 엉뚱한 청크를 근거로
# 답한다. 전량 임베딩 후 후속 마이그레이션에서 조인다.
#
# `embedding is null` 인 행이 하나라도 있으면 `index_status` 는 `pending` 이다 —
# 컬럼이 생겼다는 것과 검색이 된다는 것은 다르다 (§3.5 D3).
# ══════════════════════════════════════════════════════════════════════════
class DocSource(Base):
    __tablename__ = "doc_sources"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_key: Mapped[str] = mapped_column(String(300), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, server_default="common")
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    index_status: Mapped[str] = mapped_column(String(15), nullable=False, server_default="pending")
    #: 실패 사유. 조용히 넘어가지 않는다 (§6.7)
    index_error: Mapped[str | None] = mapped_column(String(300))
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    indexed_at: Mapped[dt.datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    chunks: Mapped[list["DocChunk"]] = relationship(
        back_populates="source", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        UniqueConstraint("source_type", "source_key", name="uq_doc_sources_type_key"),
    )


class DocChunk(Base):
    __tablename__ = "doc_chunks"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("doc_sources.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    #: 인용 정밀도 — "문서 3쪽" 이 아니라 "WS-KS-001 §4.4 다." 를 가리킨다 (§3.6)
    heading: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    #: 컨텍스트 예산 계산용 **추정치**다 (chunker.count_tokens). 과금 근거가 아니다.
    token_count: Mapped[int] = mapped_column(Integer, nullable=False)
    #: pgvector. 차원은 `src/agent/embed.py:EMBED_DIM` (=1024) 와 반드시 같다.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(EMBED_DIM))
    #: 🔴 모델이 바뀌면 전량 재색인이 필요하다는 사실을 스키마가 기억한다 (§2.11·§3.7)
    embed_model: Mapped[str | None] = mapped_column(String(60))
    embed_dim: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    source: Mapped[DocSource] = relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("source_id", "chunk_index", name="uq_doc_chunks_source_index"),
        # §3.6 — 코사인 거리, m=16, ef_construction=64
        Index(
            "ix_doc_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
        # 재색인 대상 스캔용 — `embed_model` 이 현재 설정과 다른 행을 찾는다 (§3.7)
        Index("ix_doc_chunks_embed_model", "embed_model"),
    )


# ══════════════════════════════════════════════════════════════════════════
# agent-architecture.md §6.3~§6.9 — AI Agent 실행 기록
#
# `agent_recommendations`(§6.9)를 **만들었다** (CR-DB-008). 축소안으로 빠져
# 있던 테이블이다 — 없는 동안 FE-RT-41 은 501 을 그리고 있었고, 그 화면이
# 답해야 할 질문 5개 중 4개가 "저장소 부재"로 답을 못 했다 (plan-agent §2~3).
# ══════════════════════════════════════════════════════════════════════════
class AgentSession(Base):
    __tablename__ = "agent_sessions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    #: 사용자 삭제 시 세션은 남긴다 — 감사 대상이다
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200))
    started_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    last_active_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    closed: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    messages: Mapped[list["AgentMessage"]] = relationship(
        back_populates="session", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        Index("ix_agent_sessions_user_active", "user_id", "last_active_at"),
        Index("ix_agent_sessions_scope", "scope"),
    )


class AgentMessage(Base):
    __tablename__ = "agent_messages"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("agent_sessions.id", ondelete="CASCADE"), nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    #: `user` | `assistant`. **`system` 은 저장하지 않는다** — 룰은 `rule_hash` 로 재현한다
    role: Mapped[str] = mapped_column(String(10), nullable=False)
    #: 🔴 **NULL 일 수 있다는 것이 설계 의도다** (§6.4). 답이 없으면 없는 것이고,
    #:    빈 문자열로 위장하지 않는다. `rule_violation`·`no_evidence` 면 NULL 이다.
    content: Mapped[str | None] = mapped_column(Text)
    answer_status: Mapped[str | None] = mapped_column(String(20))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    session: Mapped[AgentSession] = relationship(back_populates="messages")
    citations: Mapped[list["AgentCitation"]] = relationship(
        back_populates="message", cascade="all, delete-orphan", passive_deletes=True
    )

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_agent_messages_session_seq"),
        Index("ix_agent_messages_session_seq", "session_id", "seq"),
    )


class AgentCitation(Base):
    __tablename__ = "agent_citations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False
    )
    ord: Mapped[int] = mapped_column(Integer, nullable=False)
    #: `data` | `doc` | `model` — §7.11 사용자 노출 어휘 그대로.
    #: `sql` 같은 구현 용어를 저장하지 않는다.
    kind: Mapped[str] = mapped_column(String(10), nullable=False)
    #: 🔴 SET NULL — 재색인으로 청크가 교체돼도 **그때 무엇을 보고 답했는지**는
    #:    `snippet` 에 남아야 한다. CASCADE 로 지우면 사후 검증이 불가능해진다.
    chunk_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("doc_chunks.id", ondelete="SET NULL")
    )
    detail: Mapped[str | None] = mapped_column(String(200))
    #: `data` 일 때 조회 건수. **NULL 이면 근거로 세지 않는다** (§7.11.2).
    #: 0 은 유효한 값이다 — "조회했고 0건이었다" 는 근거다.
    row_count: Mapped[int | None] = mapped_column(Integer)
    source_ref: Mapped[str] = mapped_column(String(200), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    link: Mapped[str | None] = mapped_column(String(300))
    snippet: Mapped[str | None] = mapped_column(Text)
    score: Mapped[Decimal | None] = mapped_column(Numeric(6, 4))

    message: Mapped[AgentMessage] = relationship(back_populates="citations")

    __table_args__ = (Index("ix_agent_citations_message_ord", "message_id", "ord"),)


class AgentRun(Base):
    """실행 로그 — `FR-AG-05` · 사업계획서 p.60 "사용 로그 기록·관리"."""

    __tablename__ = "agent_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    #: 실패해 메시지가 없을 수도 있다
    message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agent_messages.id", ondelete="SET NULL")
    )
    session_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agent_sessions.id", ondelete="SET NULL")
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )
    scope: Mapped[str] = mapped_column(String(20), nullable=False)
    #: `sql` | `rag` | `tool` | `hybrid` | `refuse`
    route: Mapped[str] = mapped_column(String(10), nullable=False)
    answer_status: Mapped[str] = mapped_column(String(20), nullable=False)
    provider: Mapped[str | None] = mapped_column(String(20))
    #: 모델 ID 를 코드에 박지 않는 대신 여기 기록한다
    model_id: Mapped[str | None] = mapped_column(String(60))
    #: `RuleSnapshot` SHA-256 — **어떤 룰로 답했는지 재현**
    rule_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    tool_calls: Mapped[list | None] = mapped_column(JSONB)
    retrieval: Mapped[dict | None] = mapped_column(JSONB)
    latency_ms: Mapped[dict] = mapped_column(JSONB, nullable=False)
    total_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer)
    violations: Mapped[list | None] = mapped_column(JSONB)
    regenerated: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    error_code: Mapped[str | None] = mapped_column(String(40))
    #: 🔴 **외부로 나간 프롬프트 전문 (마스킹 후)** — §2.8 통제의 사후 검증.
    #:    원본이 아니라 **실제 나간 것**을 저장한다. 90일 후 NULL 처리한다.
    prompt_sent: Mapped[str | None] = mapped_column(Text)
    #: 🔴 **버려진 답변 포함 원본** — 룰 위반으로 버린 답도 남는다 (§4.5.1)
    raw_answer: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_agent_runs_created", "created_at"),
        Index("ix_agent_runs_scope_created", "scope", "created_at"),
        Index("ix_agent_runs_status", "answer_status"),
        Index("ix_agent_runs_user_created", "user_id", "created_at"),
    )


class AgentFeedback(Base):
    """👍/👎 — FE-RT-42 "정확도" 의 **유일한 실측 원천** (§6.8).

    정답 라벨이 없는 자연어 답변에서 정확도를 계산할 방법은 사람의 평가밖에 없다.
    자동 지표를 지어내지 않는다.
    """

    __tablename__ = "agent_feedback"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("agent_messages.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )
    #: 1 (👍) | -1 (👎)
    rating: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String(30))
    comment: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        # 1인 1평가
        UniqueConstraint("message_id", "user_id", name="uq_agent_feedback_message_user"),
    )


class AgentRecommendation(Base):
    """추천 vs 실제 적용 — FE-RT-41 `FR-AG-04` · §6.9 (CR-DB-008).

    추천이 나온 순간 1행 INSERT 하고, 그 추천대로 배합한 LOT 이 확정되면
    `applied_lot_id`·`applied_at` 을 UPDATE 한다. 두 시점을 한 행에 두는 것이
    "추천 vs 실제 적용 비교"(FR-AG-04)를 조인 없이 답하게 해준다.

    🔴 **적용 배합비와 실측 품질은 저장하지 않는다.** §6.9 표에는
       `actual_quality` 컬럼이 있지만 그 값의 정본은 `lots.quality_score` 다.
       같은 값을 두 곳에 두면 한쪽만 갱신되는 날이 오고, 화면은 그때 옛 값을
       현재값으로 그린다 — 이 프로젝트가 걷어낸 조용한 실패와 같은 종류다.
       `applied_lot_id` 로 조인해서 **조회 시점의 실측**을 읽는다.

    ⚠ `applied_lot_id` 는 §6.9 가 VARCHAR(30) 이라 적었으나 `lots.lot_id` 가
      VARCHAR(20) 이라 길이를 맞췄다. 참조 대상보다 긴 값은 어차피 FK 를
      통과하지 못한다.

    ⚠ 성분 합계 100% **CHECK 는 걸지 않는다.** 수용 기준 6번이 "합계가 100.0 이
      아닌 추천 행은 경고 배지" 라고 정했다 — 그런 행이 **존재할 수 있어야**
      배지를 띄울 수 있다. 저장을 막으면 이상한 추천이 나온 사실 자체가 사라진다.
    """

    __tablename__ = "agent_recommendations"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    recommended_at: Mapped[dt.datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
    #: 사용자 삭제 시 추천 이력은 남긴다 — 감사 대상이다
    user_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL")
    )
    #: `recommend_api`(FE-RT-14 화면) | `agent`(FE-RT-15 배합 AI Agent)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    #: Agent 경유일 때만 채운다. 재색인·세션 삭제로 메시지가 사라져도 추천은 남는다
    message_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agent_messages.id", ondelete="SET NULL")
    )
    input_temp: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    input_time: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    input_supplier: Mapped[str | None] = mapped_column(String(20))
    #: 추천 배합비 — `lots.*_ratio` 와 같은 DECIMAL(6,3)
    rec_sn: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    rec_ag: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    rec_cu: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    rec_pb: Mapped[Decimal] = mapped_column(Numeric(6, 3), nullable=False)
    predicted_quality: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    model_name: Mapped[str | None] = mapped_column(String(40))
    #: 🔴 §5 오류 계약 — 수렴 실패는 200 + `false` 다. **그 행도 저장한다.**
    #:    실패한 추천을 기록에서 빼면 "AI 추천은 늘 수렴한다" 로 읽힌다.
    optimization_success: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    #: 실제로 이 추천대로 배합한 LOT. 내부 BIGINT `id` 가 아니라 업무 키를 쓴다
    applied_lot_id: Mapped[str | None] = mapped_column(
        String(20), ForeignKey("lots.lot_id", ondelete="SET NULL")
    )
    applied_at: Mapped[dt.datetime | None] = mapped_column(DateTime)

    __table_args__ = (
        Index("ix_agent_recommendations_recommended_at", recommended_at.desc()),
        Index("ix_agent_recommendations_applied_lot", "applied_lot_id"),
    )


__all__ = [
    "Base",
    # SF-TD5 v1.0 — §3.1~§3.10
    "Supplier",
    "Lot",
    "Component",
    "Quality",
    "Equipment",
    "MlModel",
    "Alert",
    "User",
    "AuditLog",
    "Shipment",
    # SF-TD5 v1.1 (CR-DB-001) — §3.11~§3.18
    "Receipt",
    "Claim",
    "ProcessCondition",
    "ConditionHistory",
    "NotificationRule",
    "SystemSetting",
    "MasterCode",
    "KpiTarget",
    # agent-architecture.md §6.3~§6.8 (CR-DB-007)
    "DocSource",
    "DocChunk",
    "AgentSession",
    "AgentMessage",
    "AgentCitation",
    "AgentRun",
    "AgentFeedback",
    # agent-architecture.md §6.9 (CR-DB-008)
    "AgentRecommendation",
]
