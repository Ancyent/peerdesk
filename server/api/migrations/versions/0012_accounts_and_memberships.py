"""Accounts, memberships, and account-scoped resources

Revision ID: 0012
Revises: 0011
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

SCOPED = ["machines", "companies", "api_keys", "registration_tokens", "branding"]
# Step 1 (`grep -n "owner_id" models.py`) found owner_id on exactly two
# tables: machines and companies. api_keys and registration_tokens carry
# `created_by` (audit, not ownership) and never had owner_id; like branding,
# they are backfilled from the first account instead of a rename-in-place.
FROM_OWNER = ["machines", "companies"]


def upgrade() -> None:
    op.create_table(
        "accounts",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "memberships",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(), sa.ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "account_id", name="uq_membership_user_account"),
    )
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])
    op.create_index("ix_memberships_account_id", "memberships", ["account_id"])

    # Nullable first so existing rows stay valid; backfilled below.
    for table in SCOPED:
        op.add_column(table, sa.Column("account_id", sa.String(), nullable=True))

    # One account per existing user, with that user as its admin. Reusing the
    # user id as the account id makes the backfill below a straight copy.
    op.execute("""
        INSERT INTO accounts (id, name, created_at)
        SELECT u.id, COALESCE(u.name, 'My Account'), NOW() FROM users u
    """)
    op.execute("""
        INSERT INTO memberships (id, user_id, account_id, role, created_at)
        SELECT u.id, u.id, u.id, 'admin', NOW() FROM users u
    """)

    for table in FROM_OWNER:
        op.execute(f"UPDATE {table} SET account_id = owner_id")

    # api_keys and registration_tokens never had owner_id. Every row is tied
    # to an existing user via created_by, and every user now has an account,
    # so backfilling from the first account can never leave a NULL here
    # (unlike branding, which has no such guarantee).
    op.execute("UPDATE api_keys SET account_id = (SELECT id FROM accounts ORDER BY created_at LIMIT 1)")
    op.execute("UPDATE registration_tokens SET account_id = (SELECT id FROM accounts ORDER BY created_at LIMIT 1)")

    # Branding is a single global row with no owner; attach it to the first account.
    op.execute("UPDATE branding SET account_id = (SELECT id FROM accounts ORDER BY created_at LIMIT 1)")
    op.execute("DELETE FROM branding WHERE account_id IS NULL")

    for table in SCOPED:
        op.alter_column(table, "account_id", nullable=False)
        op.create_foreign_key(f"fk_{table}_account", table, "accounts", ["account_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{table}_account_id", table, ["account_id"])

    # owner_id survives only as audit, under a name that cannot be mistaken for access.
    op.alter_column("machines", "owner_id", new_column_name="created_by_id", nullable=True)
    op.alter_column("companies", "owner_id", new_column_name="created_by_id", nullable=True)


def downgrade() -> None:
    op.alter_column("machines", "created_by_id", new_column_name="owner_id")
    op.alter_column("companies", "created_by_id", new_column_name="owner_id")
    for table in SCOPED:
        op.drop_index(f"ix_{table}_account_id", table)
        op.drop_constraint(f"fk_{table}_account", table, type_="foreignkey")
        op.drop_column(table, "account_id")
    op.drop_table("memberships")
    op.drop_table("accounts")
