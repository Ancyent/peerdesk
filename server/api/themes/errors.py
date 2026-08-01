"""How a rejected theme explains itself.

Frozen and hashable so the validator can collapse duplicates without caring
whether two rules happened to flag the same line.
"""
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

from . import limits

# The pseudo-filename used when a problem belongs to the archive as a whole
# rather than to any entry inside it.
ARCHIVE = "<archive>"


@dataclass(frozen=True)
class ThemeIssue:
    file: str
    code: str
    message: str
    line: int | None = None

    def render(self) -> str:
        where = f"{self.file}:{self.line}" if self.line is not None else self.file
        return f"{where}: {self.message}"


class IssueList:
    """A bounded collector for issues.

    A hostile stylesheet produces one issue per declaration, and an archive
    that is under every size cap can still hold hundreds of thousands of them.
    Collecting them all costs more memory than the archive did and renders a
    message no author would ever read.

    Collection therefore stops at ``limits.MAX_ISSUES``, and the truncation is
    reported as the final issue so the author knows the list they were given is
    not the whole story. The limit is read at construction time, so a test can
    monkeypatch it.
    """

    def __init__(self, limit: int | None = None):
        self._limit = limits.MAX_ISSUES if limit is None else limit
        self._items: list[ThemeIssue] = []
        self._truncated = False

    def append(self, issue: ThemeIssue) -> None:
        if len(self._items) >= self._limit:
            self._truncated = True
        else:
            self._items.append(issue)

    def extend(self, issues: Iterable[ThemeIssue]) -> None:
        for issue in issues:
            self.append(issue)

    def stopped(self) -> bool:
        """Loop guard: True once nothing further would be recorded.

        Calling this marks the list as truncated, which is correct precisely
        because there is only one reason to call it — a caller asking whether
        to stop is a caller about to stop, and the author must be told the list
        they were handed is not the whole story.
        """
        if len(self._items) >= self._limit:
            self._truncated = True
            return True
        return False

    def __bool__(self) -> bool:
        return bool(self._items)

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[ThemeIssue]:
        return iter(self._items)

    def finish(self) -> list[ThemeIssue]:
        """The collected issues, plus a final note if the list was truncated."""
        if not self._truncated:
            return list(self._items)
        return [
            *self._items,
            ThemeIssue(
                file=ARCHIVE, code="issues_truncated",
                message=(
                    f"more problems were found than can be reported; the first "
                    f"{len(self._items)} are listed above — fix those and upload again"
                ),
            ),
        ]


class ThemeRejected(Exception):
    """Carries every problem found, not the first one.

    An author who has to re-upload once per error to discover the next one stops
    writing themes, so validation always runs to completion within a stage.
    IssueList above is the only thing that ever truncates that list, and it says
    so when it does.
    """

    def __init__(self, issues: list[ThemeIssue]):
        self.issues = issues
        super().__init__("\n".join(i.render() for i in issues))
