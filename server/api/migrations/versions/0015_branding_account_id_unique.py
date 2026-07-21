"""Make branding.account_id UNIQUE, deduplicating first if needed

Revision ID: 0015
Revises: 0014
"""
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # _get_or_create (routers/branding.py) reads branding by account_id with
    # scalar_one_or_none() but there was never a UNIQUE constraint backing
    # that read: two concurrent first-time POST /branding calls for the same
    # account can each see no row and each insert one. After that, every
    # GET /branding -- public, called by the unauthenticated login page --
    # raises MultipleResultsFound and returns 500, permanently.
    #
    # It's been safe only because production has a single surviving id=1 row
    # and the insert branch has never been reached a second time. Nothing
    # guarantees that stays true, and a live database could already hold
    # duplicates by the time this runs. As with 0013's NULL branding row,
    # aborting a production migration on unexpected data is worse than the
    # data itself -- branding is regenerable from defaults, so deduplicate
    # (keep the lowest id per account_id, drop the rest) before the UNIQUE
    # constraint is created, rather than let CREATE UNIQUE fail mid-migration.
    op.execute(
        "DELETE FROM branding a USING branding b "
        "WHERE a.account_id = b.account_id AND a.id > b.id"
    )
    # Replace the plain index 0012 created with a unique one of the same
    # name, rather than adding a second, redundant index alongside it.
    op.drop_index("ix_branding_account_id", table_name="branding")
    op.create_index("ix_branding_account_id", "branding", ["account_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_branding_account_id", table_name="branding")
    op.create_index("ix_branding_account_id", "branding", ["account_id"], unique=False)
