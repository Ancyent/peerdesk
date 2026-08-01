"""The whole validation pass, in the order the spec fixes.

Nothing is written here. The result describes what *would* be written, so the
caller can place it atomically and this module stays a pure function of the
archive it was handed.
"""
import hashlib
import zipfile
from dataclasses import dataclass
from pathlib import Path

from . import limits
from .archive import inspect
from .cssfilter import filter_css
from .errors import ThemeIssue, ThemeRejected
from .imageprobe import probe
from .manifest import MANIFEST_NAME, Manifest, parse_manifest
from .svgsanitize import sanitize_svg

# The only stylesheets a theme may ship. One per target, plus the shared tokens.
CSS_FILES = ("css/tokens.css", "css/web.css", "css/appViewer.css", "css/desktop.css")

RASTER_KINDS = frozenset({"png", "jpeg", "webp"})


def _read_entry(zf: zipfile.ZipFile, name: str) -> tuple[bytes | None, ThemeIssue | None]:
    """Read an archive entry, converting any exception to a ThemeIssue.

    Returns (data, issue). If data is not None, the read succeeded and issue is None.
    If data is None, issue describes why the read failed.
    """
    try:
        return zf.read(name), None
    except Exception:
        return None, ThemeIssue(
            file=name, code="unreadable_entry",
            message="entry could not be decompressed or read from the archive",
        )


@dataclass(frozen=True)
class ValidatedTheme:
    manifest: Manifest
    files: dict[str, bytes]
    ignored: list[str]
    checksum: str


def _checksum(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_archive(path: Path) -> ValidatedTheme:
    entries = inspect(path)
    names = {e.name for e in entries}

    if MANIFEST_NAME not in names:
        raise ThemeRejected([ThemeIssue(
            file=MANIFEST_NAME, code="missing_manifest",
            message="theme.json must be present at the archive root",
        )])

    with zipfile.ZipFile(path) as zf:
        manifest_data, read_issue = _read_entry(zf, MANIFEST_NAME)
        if manifest_data is None:
            raise ThemeRejected([read_issue])

        manifest = parse_manifest(manifest_data)

        # Reject if the manifest references itself (prevents bypassing validation).
        referenced = manifest.referenced_paths()
        if MANIFEST_NAME in referenced:
            raise ThemeRejected([ThemeIssue(
                file=MANIFEST_NAME, code="bad_manifest",
                message="theme.json cannot be referenced as an asset",
            )])

        preview_paths = {p.src for p in manifest.preview}
        expected = {MANIFEST_NAME} | referenced
        expected |= {name for name in CSS_FILES if name in names}
        expected |= {n for n in names if n.startswith("fonts/")}

        issues: list[ThemeIssue] = []
        files: dict[str, bytes] = {MANIFEST_NAME: manifest_data}

        for name in sorted(expected - {MANIFEST_NAME}):
            if name not in names:
                issues.append(ThemeIssue(
                    file=name, code="missing_asset",
                    message="referenced by theme.json but not present in the archive",
                ))
                continue

            data, read_issue = _read_entry(zf, name)
            if data is None:
                issues.append(read_issue)
                continue

            if name in CSS_FILES:
                try:
                    files[name] = filter_css(data.decode("utf-8"), name).encode("utf-8")
                except ThemeRejected as rejected:
                    issues.extend(rejected.issues)
                except UnicodeDecodeError:
                    issues.append(ThemeIssue(
                        file=name, code="bad_css", message="stylesheet must be UTF-8",
                    ))
                except RecursionError:
                    issues.append(ThemeIssue(
                        file=name, code="bad_css",
                        message="stylesheet is too deeply nested or complex to parse",
                    ))
                continue

            # Previews must be raster; check before probing so we reject SVG and WOFF2 early.
            if name in preview_paths:
                try:
                    info = probe(data)
                except RecursionError:
                    issues.append(ThemeIssue(
                        file=name, code="bad_asset",
                        message="asset is too complex to analyze",
                    ))
                    continue

                if info is None:
                    issues.append(ThemeIssue(
                        file=name, code="bad_asset_type",
                        message="not a PNG, JPEG, WebP, SVG or WOFF2 by content",
                    ))
                    continue

                if info.kind not in RASTER_KINDS:
                    issues.append(ThemeIssue(
                        file=name, code="bad_asset_type",
                        message=f"previews must be PNG, JPEG or WebP, not {info.kind}",
                    ))
                    continue

                if len(data) > limits.MAX_PREVIEW_BYTES:
                    issues.append(ThemeIssue(
                        file=name, code="preview_too_large",
                        message=f"{len(data)} bytes; at most {limits.MAX_PREVIEW_BYTES} allowed",
                    ))
                    continue

                if max(info.width, info.height) > limits.MAX_PREVIEW_EDGE_PX:
                    issues.append(ThemeIssue(
                        file=name, code="preview_too_large",
                        message=f"{info.width}x{info.height}; long edge must be at most {limits.MAX_PREVIEW_EDGE_PX}px",
                    ))
                    continue

                files[name] = data
                continue

            # Non-preview assets: probe, sanitize SVG if needed, and add.
            try:
                info = probe(data)
            except RecursionError:
                issues.append(ThemeIssue(
                    file=name, code="bad_asset",
                    message="asset is too complex to analyze",
                ))
                continue

            if info is None:
                issues.append(ThemeIssue(
                    file=name, code="bad_asset_type",
                    message="not a PNG, JPEG, WebP, SVG or WOFF2 by content",
                ))
                continue

            if info.kind == "svg":
                try:
                    files[name] = sanitize_svg(data, name)
                except ThemeRejected as rejected:
                    issues.extend(rejected.issues)
                except RecursionError:
                    issues.append(ThemeIssue(
                        file=name, code="bad_asset",
                        message="SVG is too complex to sanitize",
                    ))
                continue

            files[name] = data

    if issues:
        raise ThemeRejected(issues)

    return ValidatedTheme(
        manifest=manifest,
        files=files,
        ignored=sorted(names - set(files)),
        checksum=_checksum(path),
    )
