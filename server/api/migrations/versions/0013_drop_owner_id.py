"""Tighten account_id and drop owner_id, now that authorization runs on account_id

Revision ID: 0013
Revises: 0012
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

SCOPED = ["machines", "companies", "api_keys", "registration_tokens", "branding"]


def upgrade() -> None:
    # Rows created while account_id was nullable (Tasks 2-6) may have NULL in it.
    # On the live database 0012 and 0013 run back to back so there are none, but a
    # dev database that ran the app in between will have them, and ALTER would
    # fail on the first one. Adopt any orphans into the first account.
    for table in SCOPED:
        op.execute(
            f"UPDATE {table} SET account_id = (SELECT id FROM accounts ORDER BY created_at LIMIT 1) "
            f"WHERE account_id IS NULL"
        )
    # Every router sets account_id now, so the column can finally be required.
    for table in SCOPED:
        op.alter_column(table, "account_id", nullable=False)
    for table in ("machines", "companies"):
        op.drop_column(table, "owner_id")


def downgrade() -> None:
    for table in ("machines", "companies"):
        op.add_column(table, sa.Column("owner_id", sa.String(), nullable=True))
        op.execute(f"UPDATE {table} SET owner_id = created_by_id")
    for table in SCOPED:
        op.alter_column(table, "account_id", nullable=True)
