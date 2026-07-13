"""Add registration_tokens.name

Revision ID: 0011
Revises: 0010
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Optional machine name chosen at token-generation time; applied to the
    # machine on redeem (overrides the agent's hostname-derived name).
    op.add_column("registration_tokens", sa.Column("name", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("registration_tokens", "name")
