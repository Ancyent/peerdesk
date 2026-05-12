"""Add registration_tokens

Revision ID: 0007
Revises: 0006
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "registration_tokens",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("token", sa.String(9), unique=True, nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("company_id", sa.String(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True),
        sa.Column("location_id", sa.String(), sa.ForeignKey("locations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("group_id", sa.String(), sa.ForeignKey("groups.id", ondelete="SET NULL"), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("registration_tokens")
