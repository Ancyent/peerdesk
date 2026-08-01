"""How a rejected theme explains itself.

Frozen and hashable so the validator can collapse duplicates without caring
whether two rules happened to flag the same line.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class ThemeIssue:
    file: str
    code: str
    message: str
    line: int | None = None

    def render(self) -> str:
        where = f"{self.file}:{self.line}" if self.line is not None else self.file
        return f"{where}: {self.message}"


class ThemeRejected(Exception):
    """Carries every problem found, not the first one.

    An author who has to re-upload once per error to discover the next one stops
    writing themes, so validation always runs to completion within a stage.
    """

    def __init__(self, issues: list[ThemeIssue]):
        self.issues = issues
        super().__init__("\n".join(i.render() for i in issues))
