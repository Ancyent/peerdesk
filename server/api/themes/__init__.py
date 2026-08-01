"""Theme package format and validator.

Nothing here touches the database, the filesystem beyond the archive it is
given, or HTTP. That is deliberate: every rule below is a security control, and
a pure function is the only kind you can exhaustively test against a corpus of
hostile inputs.
"""
from .errors import ThemeIssue, ThemeRejected
from .manifest import Manifest
from .validate import ValidatedTheme, validate_archive

__all__ = [
    "Manifest", "ThemeIssue", "ThemeRejected", "ValidatedTheme", "validate_archive",
]
