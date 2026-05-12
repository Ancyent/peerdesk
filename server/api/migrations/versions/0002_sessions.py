"""Add sessions table

Revision ID: 0002
Revises: 0a7052284333
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa

revision = '0002'
down_revision = '0a7052284333'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'sessions',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('host_peer_id', sa.String(9), nullable=False),
        sa.Column('viewer_user_id', sa.String(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('connection_type', sa.String(10), nullable=False),
        sa.Column('bytes_transferred', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['viewer_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_sessions_host_peer_id'), 'sessions', ['host_peer_id'])


def downgrade() -> None:
    op.drop_index(op.f('ix_sessions_host_peer_id'), table_name='sessions')
    op.drop_table('sessions')
