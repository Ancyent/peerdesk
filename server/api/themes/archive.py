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
    # Empty name is not safe
    if not name:
        return False
    # Absolute paths are not safe
    if name.startswith("/"):
        return False
    # Backslashes (Windows-style separators) are not safe
    if "\\" in name:
        return False
    # NUL bytes are not safe and can cause issues at file I/O
    if "\x00" in name:
        return False
    # Split by forward slashes and check each part
    parts = name.split("/")
    # "." and "" catch "./x" and doubled separators, which some tools emit and
    # which normalise differently across platforms.
    # ".." catches path traversal attempts.
    return not any(p in ("..", ".", "") for p in parts)


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
    except zipfile.BadZipFile as exc:
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
