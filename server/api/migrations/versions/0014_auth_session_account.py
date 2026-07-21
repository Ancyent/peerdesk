"""Persist the active account on auth_sessions, so it survives /auth/refresh

Revision ID: 0014
Revises: 0013
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable and not backfilled on purpose: sessions created before this
    # change predate the concept and simply fall back to the user's oldest
    # membership at refresh time (see routers/auth.py), so nobody is logged
    # out and no migration-time backfill is needed.
    op.add_column("auth_sessions", sa.Column("account_id", sa.String(), nullable=True))
    op.create_foreign_key(
        "fk_auth_sessions_account", "auth_sessions", "accounts", ["account_id"], ["id"], ondelete="SET NULL"
    )
    op.create_index("ix_auth_sessions_account_id", "auth_sessions", ["account_id"])


def downgrade() -> None:
    op.drop_index("ix_auth_sessions_account_id", table_name="auth_sessions")
    op.drop_constraint("fk_auth_sessions_account", "auth_sessions", type_="foreignkey")
    op.drop_column("auth_sessions", "account_id")
