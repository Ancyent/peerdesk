"""Add machine placement FKs

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("machines", sa.Column("company_id", sa.String(), sa.ForeignKey("companies.id", ondelete="SET NULL"), nullable=True))
    op.add_column("machines", sa.Column("location_id", sa.String(), sa.ForeignKey("locations.id", ondelete="SET NULL"), nullable=True))
    op.add_column("machines", sa.Column("group_id", sa.String(), sa.ForeignKey("groups.id", ondelete="SET NULL"), nullable=True))


def downgrade() -> None:
    op.drop_column("machines", "group_id")
    op.drop_column("machines", "location_id")
    op.drop_column("machines", "company_id")
