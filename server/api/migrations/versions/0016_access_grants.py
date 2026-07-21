"""access_grants

Revision ID: 0016
Revises: 0015
"""
import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "access_grants",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("membership_id", sa.String(), nullable=False),
        sa.Column("created_by_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("company_id", sa.String(), nullable=True),
        sa.Column("location_id", sa.String(), nullable=True),
        sa.Column("group_id", sa.String(), nullable=True),
        sa.Column("machine_id", sa.String(), nullable=True),
        sa.ForeignKeyConstraint(["membership_id"], ["memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["company_id"], ["companies.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["location_id"], ["locations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["group_id"], ["groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["machine_id"], ["machines.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "(CASE WHEN company_id  IS NULL THEN 0 ELSE 1 END + "
            " CASE WHEN location_id IS NULL THEN 0 ELSE 1 END + "
            " CASE WHEN group_id    IS NULL THEN 0 ELSE 1 END + "
            " CASE WHEN machine_id  IS NULL THEN 0 ELSE 1 END) = 1",
            name="ck_access_grant_exactly_one_target",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_access_grants_membership_id"), "access_grants", ["membership_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_access_grants_membership_id"), table_name="access_grants")
    op.drop_table("access_grants")
