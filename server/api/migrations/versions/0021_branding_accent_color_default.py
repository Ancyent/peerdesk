"""backfill branding.accent_color from the pre-Aurora default to the new one

Revision ID: 0021
Revises: 0020

The Aurora design pass changed the app's default accent colour from
``#2563eb`` (blue) to ``#22c5b0`` (teal) in code only -- ``DEFAULT_BRANDING``
in web/src/hooks/useBranding.ts -- and nothing updated the ``branding`` rows
that were written under the old default. That matters because of how
``applyBranding`` (same file) treats the stored value: when
``accent_color.toLowerCase()`` equals ``DEFAULT_BRANDING.accent_color`` it
removes the inline ``--accent`` style and lets the stylesheet's per-theme
values apply; when it differs, it treats the row as a deliberate
customisation and writes ``--accent`` inline, which beats the stylesheet in
both themes. So a row still holding ``#2563eb`` is now read as "this
deployment chose blue on purpose" and renders the old colour on top of the
new design -- silently, with no error and nothing in the logs.

What this cannot know, honestly stated: a row holding ``#2563eb`` is either
(a) a row nobody has ever touched, still sitting at whatever the app
defaulted it to when the account was created, or (b) a row where an admin
opened the branding settings and typed the literal hex ``#2563eb`` back in,
by coincidence matching the old default exactly. The schema cannot tell
these apart -- ``branding`` has ``updated_at`` but no ``created_at`` to
compare it against, and no "customised" flag. Case (a) is overwhelmingly the
likely one: ``#2563eb`` was the default every single row was created with
before Aurora (see models.py's own ``Branding.accent_color`` default, and
migration 0004), so the base rate of a row sitting untouched at its default
value vastly exceeds the rate of someone deliberately re-entering that exact
string. Doing nothing is not neutral either: every unbranded, pre-Aurora
install would keep silently rendering the wrong colour in both themes
forever, with no way for an operator to notice short of reading this
migration. Given that, treating every ``#2563eb`` row as accidental and
repairing it is the correct trade, even though it is provably wrong for
whichever admin (if any) hits case (b).

Expected blast radius: on a typical deployment this touches zero or one row
per account -- only accounts that never opened branding settings after
Aurora shipped, and only if they exist at all (most installs have exactly
one). It is not expected to touch a large fraction of any deployment's
``branding`` table; most rows will already show either a real custom colour
or, on decently-run installs, the corrected default applied by hand (as was
done for this project's own production database ahead of this migration).

The match is case-insensitive: accent_color is a plain ``String(7)`` with no
normalisation anywhere in the write path, so a row can hold ``#2563EB``,
``#2563Eb``, etc. and still mean exactly the old default. The written value
is lowercase ``#22c5b0``, matching ``DEFAULT_BRANDING.accent_color`` exactly,
since applyBranding's comparison lowercases both sides -- writing anything
else would just move the mismatch rather than fix it.
"""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # LOWER(...) on the WHERE side matches '#2563eb' regardless of the case
    # it was stored in; the SET side is the lowercase literal so the result
    # matches DEFAULT_BRANDING.accent_color byte-for-byte.
    op.execute(
        """
        UPDATE branding
        SET accent_color = '#22c5b0'
        WHERE LOWER(accent_color) = '#2563eb'
        """
    )


def downgrade() -> None:
    # Deliberate no-op, not a symmetric reverse.
    #
    # The symmetric reverse -- rewrite every row holding '#22c5b0' back to
    # '#2563eb' -- has the mirror-image version of the ambiguity described
    # above, except worse: by the time anyone downgrades, every account that
    # actually likes the new teal (the overwhelmingly common case, since it
    # is now the shipped default) would be indistinguishable from the
    # handful this migration just repaired. A symmetric downgrade would
    # silently vandalise every one of those legitimate rows back to the old
    # blue, which is a strictly worse outcome than what upgrade() fixed.
    #
    # There is also no prior state worth restoring: the rows this migration
    # touches were never correctly "blue" in any meaningful sense -- they
    # were unbranded installs whose default happened to render as blue
    # because the code changed under them. Reintroducing that mismatch on
    # downgrade would just recreate the bug this migration exists to fix.
    pass
