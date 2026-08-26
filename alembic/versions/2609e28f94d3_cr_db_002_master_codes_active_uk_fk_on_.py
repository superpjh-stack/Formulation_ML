"""CR-DB-002: master_codes active UK + FK ON DELETE policy

Revision ID: 2609e28f94d3
Revises: bd14233e77af
Create Date: 2026-08-25 10:05:52.664670

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2609e28f94d3'
down_revision: Union[str, Sequence[str], None] = 'bd14233e77af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ── 이 리비전이 고치는 것 ──────────────────────────────────────────────────
#
# A-1. master_codes 활성 코드 중복 (기획3 지적 — 필수)
#      기존 UK (group_code, code, version) 만으로는 같은 코드가 버전만
#      달리해 **동시에 활성 상태로** 중복 저장된다. 부분 유니크 인덱스로
#      "활성 코드는 그룹 내 유일" 을 DB 레벨에서 강제한다.
#      기존 UK 는 버전 이력 보존을 위해 **유지**한다 (교체 아님).
#
# A-4. FK ON DELETE 미지정 (기획2 지적 — 필수)
#      전 FK 가 NO ACTION 이라 FE-RT-26 사용자 삭제 시 audit_logs 참조로
#      FK 위반(409)이 난다. 감사 이력은 사용자보다 오래 살아야 한다.
#        · NULL 허용 FK 4건 → ON DELETE SET NULL (부모 삭제해도 이력 보존)
#        · NOT NULL  FK 7건 → ON DELETE RESTRICT (의도를 DB 에 명시)
#
# ※ 사용자 삭제는 API 계층에서 소프트 삭제(active=false)가 정본이다.
#   아래 SET NULL 은 하드 삭제가 발생했을 때의 2차 방어선이다.

# (테이블, 제약명, 컬럼, 참조테이블, 참조컬럼, 삭제규칙)
_FKS = [
    # NULL 허용 → SET NULL
    ("alerts",            "alerts_lot_id_fkey",                  "lot_id",       "lots",               "id", "SET NULL"),
    ("audit_logs",        "audit_logs_user_id_fkey",             "user_id",      "users",              "id", "SET NULL"),
    ("condition_history", "condition_history_changed_by_fkey",   "changed_by",   "users",              "id", "SET NULL"),
    ("system_settings",   "system_settings_updated_by_fkey",     "updated_by",   "users",              "id", "SET NULL"),
    # NOT NULL → RESTRICT
    ("lots",              "lots_supplier_id_fkey",               "supplier_id",  "suppliers",          "id", "RESTRICT"),
    ("receipts",          "receipts_supplier_id_fkey",           "supplier_id",  "suppliers",          "id", "RESTRICT"),
    ("components",        "components_lot_id_fkey",              "lot_id",       "lots",               "id", "RESTRICT"),
    ("quality",           "quality_lot_id_fkey",                 "lot_id",       "lots",               "id", "RESTRICT"),
    ("shipments",         "shipments_lot_id_fkey",               "lot_id",       "lots",               "id", "RESTRICT"),
    ("claims",            "claims_lot_id_fkey",                  "lot_id",       "lots",               "id", "RESTRICT"),
    ("condition_history", "condition_history_condition_id_fkey", "condition_id", "process_conditions", "id", "RESTRICT"),
]


def upgrade() -> None:
    # ── A-1 ────────────────────────────────────────────────────────────────
    op.create_index(
        "uq_master_codes_active_code",
        "master_codes",
        ["group_code", "code"],
        unique=True,
        postgresql_where=sa.text("active"),
    )

    # ── A-4 ────────────────────────────────────────────────────────────────
    for tbl, name, col, ref_tbl, ref_col, rule in _FKS:
        op.drop_constraint(name, tbl, type_="foreignkey")
        op.create_foreign_key(name, tbl, ref_tbl, [col], [ref_col], ondelete=rule)


def downgrade() -> None:
    for tbl, name, col, ref_tbl, ref_col, _rule in _FKS:
        op.drop_constraint(name, tbl, type_="foreignkey")
        op.create_foreign_key(name, tbl, ref_tbl, [col], [ref_col])

    op.drop_index("uq_master_codes_active_code", table_name="master_codes")
