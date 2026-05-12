"""initial

Revision ID: 0a7052284333
Revises: 
Create Date: 2026-05-12 07:22:48.200966

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0a7052284333'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('password_hash', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)

    op.create_table(
        'machines',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('peer_id', sa.String(9), nullable=False),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('os', sa.String(), nullable=True),
        sa.Column('owner_id', sa.String(), nullable=False),
        sa.Column('is_online', sa.Boolean(), nullable=False),
        sa.Column('last_seen_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_machines_peer_id'), 'machines', ['peer_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_machines_peer_id'), table_name='machines')
    op.drop_table('machines')
    op.drop_index(op.f('ix_users_email'), table_name='users')
    op.drop_table('users')
