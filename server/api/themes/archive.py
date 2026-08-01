"""Decide whether an archive is safe to read, without reading it.

Everything here comes from the central directory. No entry is opened, so an
archive that lies about itself is rejected on the strength of the lie rather
than after the damage.

The order matters: validate, then extract. Reversed, the attacker's files are
already on the volume by the time anything is checked.
"""
import struct
import zipfile
from dataclasses import dataclass
from pathlib import Path

from . import limits
from .errors import ARCHIVE, IssueList, ThemeIssue, ThemeRejected

__all__ = [
    "ARCHIVE", "ArchiveEntry", "declared_entry_count", "entry_name_problem",
    "inspect", "is_safe_entry_name",
]

# The characters an entry name component may be built from. ASCII-only is
# deliberate: it closes filename spoofing and normalisation collisions (RTLO,
# zero-width joiners, C1 controls, Unicode line and paragraph separators,
# combining marks, and every codepoint not yet assigned) in one clause. Theme
# authors cannot name a file café.png, but a validator taking archives from
# strangers cannot afford that risk.
#
# @ is here because icon@2x.png is an ordinary asset name; its earlier absence
# was an unintended consequence of the ASCII rule rather than a decision.
ALLOWED_NAME_CHARS = frozenset(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.+()@ "
)


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    compressed: int
    uncompressed: int


def entry_name_problem(name: str) -> tuple[str, str] | None:
    r"""Affirm that a ZIP entry name is safe to extract.

    Returns None if it is; otherwise (code, message) naming what is wrong. The
    codes are distinct because the causes are: `images/logo@2x.png` and
    `images/café.png` both being reported as "escapes the archive root or is
    not a regular file" was one message doing three jobs badly.

    A name is safe if and only if ALL of these hold:
    - non-empty and no longer than MAX_ENTRY_NAME_LENGTH characters (ASCII, so
      characters = bytes)
    - does not begin with / (absolute path) and contains no backslash (a path
      separator on Windows, so traversal there)
    - splits on / into components that are each non-empty, neither . nor .., at
      most limits.MAX_ENTRY_COMPONENT_LENGTH characters, and built only from
      ALLOWED_NAME_CHARS
    """
    if not name:
        return ("bad_entry_name", "entry name is empty")
    # len() on str is byte-accurate only because non-ASCII is rejected below.
    # A name that is over the cap in characters is over it in bytes too, so
    # checking here first is safe.
    if len(name) > limits.MAX_ENTRY_NAME_LENGTH:
        return (
            "bad_entry_name",
            f"entry name is {len(name)} characters; at most "
            f"{limits.MAX_ENTRY_NAME_LENGTH} allowed",
        )
    if name.startswith("/"):
        return ("unsafe_entry", "entry name is an absolute path")
    if "\\" in name:
        return (
            "unsafe_entry",
            "entry name contains a backslash, which is a path separator on Windows",
        )

    for component in name.split("/"):
        if not component:
            return ("bad_entry_name", "entry name has an empty path component")
        if component in (".", ".."):
            return (
                "unsafe_entry",
                f"path component {component!r} escapes the archive root",
            )
        if len(component) > limits.MAX_ENTRY_COMPONENT_LENGTH:
            return (
                "bad_entry_name",
                f"path component {component[:32]!r}... is {len(component)} characters; "
                f"at most {limits.MAX_ENTRY_COMPONENT_LENGTH} allowed",
            )
        for char in component:
            if char not in ALLOWED_NAME_CHARS:
                return (
                    "bad_entry_name",
                    f"character {char!r} (U+{ord(char):04X}) is not allowed in an entry "
                    f"name; use ASCII letters, digits, or - _ . + ( ) @ and space",
                )

    return None


def is_safe_entry_name(name: str) -> bool:
    """True when entry_name_problem finds nothing to report."""
    return entry_name_problem(name) is None


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return (info.external_attr >> 16) & 0xF000 == 0xA000


def declared_entry_count(path: Path) -> int | None:
    """Entry count from the end-of-central-directory record alone.

    Constructing a ZipFile parses the entire central directory, so an archive
    claiming 190,000 entries costs seconds and hundreds of megabytes to reject
    for having too many entries. The EOCD record carries that count at a known
    offset from the end of the file, so it can be had before any of that.

    Returns None when the count cannot be read — a comment longer than the
    window, a ZIP64 record out of reach, a truncated file. The caller then
    falls back to counting infolist(), which applies the same cap.
    """
    size = path.stat().st_size
    # The EOCD record is 22 bytes plus a comment of at most 0xFFFF bytes.
    window = min(size, 22 + 0xFFFF)
    if window < 22:
        return None
    with path.open("rb") as handle:
        handle.seek(size - window)
        tail = handle.read(window)

    index = tail.rfind(b"PK\x05\x06")
    if index == -1 or index + 22 > len(tail):
        return None
    (count,) = struct.unpack("<H", tail[index + 10:index + 12])
    if count != 0xFFFF:
        return count

    # 0xFFFF means "see the ZIP64 record", which sits just before the ZIP64
    # locator, which sits just before the EOCD — so inside the same window
    # unless the comment is enormous.
    index64 = tail.rfind(b"PK\x06\x06")
    if index64 == -1 or index64 + 40 > len(tail):
        return None
    (count64,) = struct.unpack("<Q", tail[index64 + 32:index64 + 40])
    return count64


def inspect(path: Path) -> list[ArchiveEntry]:
    size = path.stat().st_size
    if size > limits.MAX_ARCHIVE_BYTES:
        raise ThemeRejected([ThemeIssue(
            file=ARCHIVE, code="archive_too_large",
            message=f"{size} bytes; at most {limits.MAX_ARCHIVE_BYTES} allowed",
        )])

    declared = declared_entry_count(path)
    if declared is not None and declared > limits.MAX_ENTRIES:
        # Rejected before ZipFile is constructed, because constructing it is
        # the expensive half of the work this check exists to prevent.
        raise ThemeRejected([ThemeIssue(
            file=ARCHIVE, code="too_many_entries",
            message=f"{declared} entries; at most {limits.MAX_ENTRIES} allowed",
        )])

    try:
        zf = zipfile.ZipFile(path)
    except Exception as exc:
        # Catch any failure to read the archive: BadZipFile, NotImplementedError,
        # EOFError, struct.error, and others. All indicate the file cannot be safely
        # read from the central directory and should be rejected.
        raise ThemeRejected([ThemeIssue(
            file=ARCHIVE, code="bad_archive", message=f"not a readable ZIP: {exc}",
        )]) from None

    issues = IssueList()
    entries: list[ArchiveEntry] = []
    total = 0

    with zf:
        infos = zf.infolist()
        if len(infos) > limits.MAX_ENTRIES:
            issues.append(ThemeIssue(
                file=ARCHIVE, code="too_many_entries",
                message=f"{len(infos)} entries; at most {limits.MAX_ENTRIES} allowed",
            ))

        for info in infos:
            if info.is_dir():
                continue
            if _is_symlink(info):
                issues.append(ThemeIssue(
                    file=info.filename, code="symlink_entry",
                    message="entry is a symbolic link, not a regular file",
                ))
                continue
            problem = entry_name_problem(info.filename)
            if problem is not None:
                code, message = problem
                issues.append(ThemeIssue(file=info.filename, code=code, message=message))
                continue

            total += info.file_size
            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > limits.MAX_EXPANSION_RATIO:
                    issues.append(ThemeIssue(
                        file=info.filename, code="expansion_ratio",
                        message=f"expands {ratio:.0f}x; at most {limits.MAX_EXPANSION_RATIO}x allowed",
                    ))

            entries.append(ArchiveEntry(info.filename, info.compress_size, info.file_size))

        if total > limits.MAX_UNCOMPRESSED_BYTES:
            issues.append(ThemeIssue(
                file=ARCHIVE, code="uncompressed_too_large",
                message=f"{total} bytes uncompressed; at most {limits.MAX_UNCOMPRESSED_BYTES} allowed",
            ))

    if issues:
        raise ThemeRejected(issues.finish())
    return entries
