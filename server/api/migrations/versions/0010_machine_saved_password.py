"""Add machines.saved_password_enc

Revision ID: 0010
Revises: 0009
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Encrypted (Fernet) connect password, saved per machine so the web viewer
    # can connect without re-typing it. Nullable: only set when the owner opts in.
    op.add_column("machines", sa.Column("saved_password_enc", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("machines", "saved_password_enc")
