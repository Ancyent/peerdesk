"""backfill inconsistent machine placement columns

Revision ID: 0018
Revises: 0017

Task 2 started enforcing that machines.company_id/location_id/group_id all
describe one consistent path down the Company -> Location -> Group tree (see
access.assert_placement_consistent), but only for new writes through
PATCH /machines/{id}/placement and POST /tokens. Rows written before that
check existed could and did end up inconsistent -- a pre-existing test proved
it: PATCH .../placement with only {"group_id": ...} used to return 200 and
leave company_id/location_id NULL.

A machine in that state is invisible to a member holding a company- or
location-level grant even though it sits inside that company/location,
because access.visible_machines matches grants against these denormalized
columns directly (no recursive walk). This migration repairs any row already
in that state.

The tree is exactly three levels and both groups.location_id and
locations.company_id are NOT NULL, so every group has exactly one location
and every location exactly one company -- this is a deterministic repair
(there is only one correct answer), not a guess.
"""
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Machines placed at group level: derive location_id and company_id from
    # the group's own ancestry, overwriting whatever (possibly NULL, possibly
    # wrong) values are currently there.
    op.execute(
        """
        UPDATE machines m
        SET location_id = g.location_id,
            company_id = l.company_id
        FROM groups g
        JOIN locations l ON l.id = g.location_id
        WHERE m.group_id = g.id
          AND (m.location_id IS DISTINCT FROM g.location_id
               OR m.company_id IS DISTINCT FROM l.company_id)
        """
    )

    # Machines placed at location level only (no group): derive company_id
    # from the location.
    op.execute(
        """
        UPDATE machines m
        SET company_id = l.company_id
        FROM locations l
        WHERE m.location_id = l.id
          AND m.group_id IS NULL
          AND m.company_id IS DISTINCT FROM l.company_id
        """
    )


def downgrade() -> None:
    # No-op: this migration only repairs data that was already wrong by the
    # application's own invariant (assert_placement_consistent). There is no
    # prior "correct" state to restore -- reintroducing the inconsistency on
    # downgrade would just recreate the bug this migration fixes.
    pass
