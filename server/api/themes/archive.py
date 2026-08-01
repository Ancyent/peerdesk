"""Decide whether an archive is safe to read, without reading it.

Everything here comes from the central directory. No entry is opened, so an
archive that lies about itself is rejected on the strength of the lie rather
than after the damage.

The order matters: validate, then extract. Reversed, the attacker's files are
already on the volume by the time anything is checked.
"""
import zipfile
from dataclasses import dataclass
from pathlib import Path

from . import limits
from .errors import ThemeIssue, ThemeRejected

ARCHIVE = "<archive>"


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    compressed: int
    uncompressed: int


def is_safe_entry_name(name: str) -> bool:
    r"""Affirm that a ZIP entry name is safe to extract.

    A name is safe if and only if ALL of these hold:
    - non-empty and no longer than MAX_ENTRY_NAME_LENGTH bytes (which is ASCII, so bytes = chars)
    - does not begin with / (absolute path)
    - splits on / into at least one component
    - each component is non-empty, not . or .., at most 255 bytes, and contains
      only ASCII characters from the allowlist: a-z, A-Z, 0-9, - _ . + ( ), space

    ASCII-only is deliberate. Restricting to ASCII closes filename spoofing and
    normalisation collisions (RTLO, zero-width joiners, C1 controls, Unicode
    line/paragraph separators, combining marks, and future codepoints) in one
    clause. It is a reasonable cost to prevent these attacks and achieve
    consistency across platforms — theme authors cannot name a file café.png,
    but validators taking archives from strangers cannot afford that risk.
    """
    # Allowlist of acceptable ASCII characters (one per category to be explicit)
    # Letters, digits, and punctuation/space that are safe across filesystems
    ALLOWED_CHARS = set(
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.+() "
    )

    # Non-empty and length-bounded at the whole-name level
    # Using len() on str is safe because we only accept ASCII (one char = one byte)
    if not name or len(name) > limits.MAX_ENTRY_NAME_LENGTH:
        return False

    # Absolute paths are rejected
    if name.startswith("/"):
        return False

    # Split into components
    parts = name.split("/")

    # Must have at least one component (would be empty if name is just "/")
    if not parts:
        return False

    # Every component must pass affirmative checks
    for component in parts:
        # Component must be non-empty
        if not component:
            return False

        # Component must not be . or ..
        if component in (".", ".."):
            return False

        # Component must be at most 255 bytes (256 ASCII chars max per component)
        # len() counts characters; ASCII is one byte per character
        if len(component) > 255:
            return False

        # Every character must be in the allowlist
        for char in component:
            if char not in ALLOWED_CHARS:
                return False

    return True


def _is_symlink(info: zipfile.ZipInfo) -> bool:
    return (info.external_attr >> 16) & 0xF000 == 0xA000


def inspect(path: Path) -> list[ArchiveEntry]:
    size = path.stat().st_size
    if size > limits.MAX_ARCHIVE_BYTES:
        raise ThemeRejected([ThemeIssue(
            file=ARCHIVE, code="archive_too_large",
            message=f"{size} bytes; at most {limits.MAX_ARCHIVE_BYTES} allowed",
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

    issues: list[ThemeIssue] = []
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
            if _is_symlink(info) or not is_safe_entry_name(info.filename):
                issues.append(ThemeIssue(
                    file=info.filename, code="unsafe_entry",
                    message="entry name escapes the archive root or is not a regular file",
                ))
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
        raise ThemeRejected(issues)
    return entries
