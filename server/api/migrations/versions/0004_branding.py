"""Add branding table

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-12
"""
from alembic import op
import sqlalchemy as sa

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'branding',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('brand_name', sa.String(100), nullable=False, server_default='PeerDesk'),
        sa.Column('logo_data_url', sa.Text(), nullable=True),
        sa.Column('accent_color', sa.String(7), nullable=False, server_default='#2563eb'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('branding')
