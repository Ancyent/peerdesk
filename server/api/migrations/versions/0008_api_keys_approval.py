"""Add api_keys table and machine approval_status

Revision ID: 0008
Revises: 0007
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("key", sa.String(40), unique=True, nullable=False),
        sa.Column("name", sa.String(200), nullable=False, server_default="Default Key"),
        sa.Column("created_by", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("auto_approve", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("machines", sa.Column(
        "approval_status", sa.String(10), server_default="approved", nullable=False
    ))
    op.add_column("machines", sa.Column(
        "api_key_id", sa.String(),
        sa.ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True
    ))


def downgrade() -> None:
    op.drop_column("machines", "api_key_id")
    op.drop_column("machines", "approval_status")
    op.drop_table("api_keys")
