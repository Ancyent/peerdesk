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
# Each table's owner column, confirmed against models.py: machines and
# companies use `owner_id` (models.py:89, :214), api_keys and
# registration_tokens use `created_by` (models.py:308, :282). Because
# account ids reuse user ids (see below), a per-row copy from this column
# is a correct account_id backfill for all four tables. branding has no
# owner column at all and is handled separately.
OWNER_COLUMN = {
    "machines": "owner_id",
    "companies": "owner_id",
    "api_keys": "created_by",
    "registration_tokens": "created_by",
}
# Tables that get a created_by_id column (Machine, Company): derived from
# OWNER_COLUMN so this stays in sync with the backfill map above instead of
# being a second, independently-maintained list of the same two tables.
OWNER_ID_TABLES = tuple(table for table, col in OWNER_COLUMN.items() if col == "owner_id")


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

    # Each resource goes to ITS OWN owner's account. Because account ids are the
    # user ids above, this is a straight copy. Backfilling everything to the first
    # account instead would look fine today (nothing reads account_id yet) and
    # become an authorization bug the moment Task 7 makes the column authoritative.
    for table, owner_col in OWNER_COLUMN.items():
        op.execute(f"UPDATE {table} SET account_id = {owner_col}")

    # Branding is a single global row with no owner; attach it to the first account.
    # If there are no accounts (a fresh install with no users), leave it NULL —
    # account_id is nullable until Task 7, and deleting the row here would be
    # unrecoverable on downgrade.
    op.execute("UPDATE branding SET account_id = (SELECT id FROM accounts ORDER BY created_at LIMIT 1)")

    # account_id stays NULLABLE here on purpose. The routers do not set it until
    # Tasks 6-7; making it NOT NULL now fails every insert they make. Task 7's
    # migration tightens it once they do.
    for table in SCOPED:
        op.create_foreign_key(f"fk_{table}_account", table, "accounts", ["account_id"], ["id"], ondelete="CASCADE")
        op.create_index(f"ix_{table}_account_id", table, ["account_id"])

    # Expand, do not rename: copy owner_id into created_by_id and LEAVE owner_id
    # in place. Routers still read it until Task 7 moves them onto account_id,
    # and dropping it here would break them mid-refactor. Task 7 drops it.
    for table in OWNER_ID_TABLES:
        op.add_column(table, sa.Column("created_by_id", sa.String(), nullable=True))
        op.execute(f"UPDATE {table} SET created_by_id = owner_id")
        op.create_foreign_key(
            f"fk_{table}_created_by", table, "users", ["created_by_id"], ["id"], ondelete="SET NULL"
        )


def downgrade() -> None:
    for table in OWNER_ID_TABLES:
        op.drop_constraint(f"fk_{table}_created_by", table, type_="foreignkey")
        op.drop_column(table, "created_by_id")
    for table in SCOPED:
        op.drop_index(f"ix_{table}_account_id", table)
        op.drop_constraint(f"fk_{table}_account", table, type_="foreignkey")
        op.drop_column(table, "account_id")
    op.drop_table("memberships")
    op.drop_table("accounts")
