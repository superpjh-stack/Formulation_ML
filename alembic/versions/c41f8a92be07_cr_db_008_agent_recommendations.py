"""agent_recommendations (CR-DB-008) — FE-RT-41 추천 vs 실제 적용

`agent-architecture.md` §6.9. 축소안(§6.2)으로 빠져 있던 6번 테이블이다 —
없는 동안 `GET /agents/recommendations` 는 501 이었고 화면은 영구히 0행이었다.

Revision ID: c41f8a92be07
Revises: 99ce6239f9b0
Create Date: 2026-08-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'c41f8a92be07'
down_revision: Union[str, Sequence[str], None] = '99ce6239f9b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'agent_recommendations',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('recommended_at', sa.DateTime(), server_default=sa.text('now()'),
                  nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=True),
        sa.Column('source', sa.String(length=20), nullable=False),
        sa.Column('message_id', sa.BigInteger(), nullable=True),
        sa.Column('input_temp', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('input_time', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('input_supplier', sa.String(length=20), nullable=True),
        sa.Column('rec_sn', sa.Numeric(precision=6, scale=3), nullable=False),
        sa.Column('rec_ag', sa.Numeric(precision=6, scale=3), nullable=False),
        sa.Column('rec_cu', sa.Numeric(precision=6, scale=3), nullable=False),
        sa.Column('rec_pb', sa.Numeric(precision=6, scale=3), nullable=False),
        sa.Column('predicted_quality', sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column('model_name', sa.String(length=40), nullable=True),
        sa.Column('optimization_success', sa.Boolean(), server_default='true',
                  nullable=False),
        sa.Column('applied_lot_id', sa.String(length=20), nullable=True),
        sa.Column('applied_at', sa.DateTime(), nullable=True),
        # 기존 테이블로 향하는 FK 는 전부 SET NULL — 추천 이력은 감사 기록이라
        # 사용자·메시지·LOT 이 사라져도 행 자체는 남아야 한다 (§6.10).
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['message_id'], ['agent_messages.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['applied_lot_id'], ['lots.lot_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_agent_recommendations_recommended_at', 'agent_recommendations',
                    [sa.text('recommended_at DESC')], unique=False)
    op.create_index('ix_agent_recommendations_applied_lot', 'agent_recommendations',
                    ['applied_lot_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('ix_agent_recommendations_applied_lot', table_name='agent_recommendations')
    op.drop_index('ix_agent_recommendations_recommended_at', table_name='agent_recommendations')
    op.drop_table('agent_recommendations')
