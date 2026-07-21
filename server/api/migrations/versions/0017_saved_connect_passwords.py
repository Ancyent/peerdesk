"""saved connect passwords move to (membership, machine)

Revision ID: 0017
Revises: 0016
"""
import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_connect_passwords",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("membership_id", sa.String(), nullable=False),
        sa.Column("machine_id", sa.String(), nullable=False),
        sa.Column("password_enc", sa.String(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["membership_id"], ["memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["machine_id"], ["machines.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("membership_id", "machine_id",
                            name="uq_saved_password_membership_machine"),
    )
    op.create_index(op.f("ix_saved_connect_passwords_membership_id"),
                    "saved_connect_passwords", ["membership_id"])
    op.create_index(op.f("ix_saved_connect_passwords_machine_id"),
                    "saved_connect_passwords", ["machine_id"])

    # Move each stored password to its enroller's membership in that machine's
    # account. The INNER JOIN is the rule, not an optimisation: a machine whose
    # created_by_id is NULL (its ON DELETE SET NULL fired) or whose enroller has
    # left the account produces no row, so the credential is dropped rather than
    # silently reassigned to an admin -- the kind of inheritance nobody audits.
    op.execute(
        """
        INSERT INTO saved_connect_passwords (id, membership_id, machine_id, password_enc, updated_at)
        SELECT md5(random()::text || m.id), mem.id, m.id, m.saved_password_enc, NOW()
        FROM machines m
        JOIN memberships mem
          ON mem.user_id = m.created_by_id
         AND mem.account_id = m.account_id
        WHERE m.saved_password_enc IS NOT NULL
        """
    )

    op.drop_column("machines", "saved_password_enc")


def downgrade() -> None:
    op.add_column("machines", sa.Column("saved_password_enc", sa.String(), nullable=True))
    # Lossy by nature: several people may have held a copy and the column can
    # hold only one. Takes the oldest, which is the enroller's in the common case.
    op.execute(
        """
        UPDATE machines m
        SET saved_password_enc = s.password_enc
        FROM (
            SELECT DISTINCT ON (machine_id) machine_id, password_enc
            FROM saved_connect_passwords
            ORDER BY machine_id, updated_at ASC
        ) s
        WHERE s.machine_id = m.id
        """
    )
    op.drop_index(op.f("ix_saved_connect_passwords_machine_id"), table_name="saved_connect_passwords")
    op.drop_index(op.f("ix_saved_connect_passwords_membership_id"), table_name="saved_connect_passwords")
    op.drop_table("saved_connect_passwords")
