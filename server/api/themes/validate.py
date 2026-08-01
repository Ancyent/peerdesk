"""The whole validation pass, in the order the spec fixes.

Nothing is written here. The result describes what *would* be written, so the
caller can place it atomically and this module stays a pure function of the
archive it was handed.
"""
import hashlib
import logging
import zipfile
from dataclasses import dataclass
from pathlib import Path

from . import limits
from .archive import ARCHIVE, inspect
from .cssfilter import filter_css
from .errors import IssueList, ThemeIssue, ThemeRejected
from .imageprobe import probe
from .manifest import MANIFEST_NAME, Manifest, parse_manifest
from .svgsanitize import sanitize_svg

logger = logging.getLogger(__name__)

# The only stylesheets a theme may ship. One per target, plus the shared tokens.
CSS_FILES = ("css/tokens.css", "css/web.css", "css/appViewer.css", "css/desktop.css")

# Where a theme's fonts live. A prefix rather than a list, because an author
# ships whatever weights they need.
FONTS_PREFIX = "fonts/"

RASTER_KINDS = frozenset({"png", "jpeg", "webp"})


def structural_role(name: str) -> str | None:
    """What this file is to the package, judged by the format alone.

    Returns a phrase naming the role, or None if the file holds no structural
    role and is therefore an ordinary asset.

    This exists so a file is judged by what it *is* before anything branches on
    where it was mentioned. Testing "is it a stylesheet?" before "was it named
    as a preview?" is what let `"preview": [{"src": "css/tokens.css"}]` skip the
    raster check, the byte cap and the pixel cap in one step; fixing only the
    theme.json case fixed the reported example rather than the shape.
    """
    if name == MANIFEST_NAME:
        return "the manifest"
    if name in CSS_FILES:
        return "a stylesheet"
    if name.startswith(FONTS_PREFIX):
        return "a font"
    return None


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


def _parse_manifest_safe(manifest_data: bytes) -> tuple[Manifest | None, ThemeIssue | None]:
    """Parse manifest, converting any exception to a ThemeIssue.

    Returns (manifest, issue). If manifest is not None, the parse succeeded and issue is None.
    If manifest is None, issue describes why the parse failed.
    """
    try:
        return parse_manifest(manifest_data), None
    except ThemeRejected:
        raise
    except Exception:
        return None, ThemeIssue(
            file=MANIFEST_NAME, code="bad_manifest",
            message="theme.json could not be parsed as valid JSON",
        )


def _check_image_references(manifest: Manifest) -> None:
    """A logo or a preview must name a file that is only an image.

    Raised on its own rather than folded into the file loop, because a manifest
    pointing its logo at a stylesheet has to be corrected before anything else
    it says about the archive can be acted on.
    """
    issues: list[ThemeIssue] = []
    for reference in sorted(manifest.referenced_paths()):
        role = structural_role(reference)
        if role is not None:
            issues.append(ThemeIssue(
                file=MANIFEST_NAME, code="bad_manifest",
                message=(
                    f"{reference!r} is {role} and cannot also be used as a logo "
                    f"or a preview"
                ),
            ))
    if issues:
        raise ThemeRejected(issues)


def _validate_stylesheets(
    zf: zipfile.ZipFile, names: set[str],
    files: dict[str, bytes], issues: IssueList,
) -> set[str]:
    """Filter every stylesheet present, and return what they reference.

    Stylesheets come first because they are what discovers the rest: a
    background image belongs to the theme because some accepted url() points at
    it, and nothing else in the package says so.
    """
    urls: set[str] = set()

    for name in CSS_FILES:
        if name not in names:
            continue

        data, read_issue = _read_entry(zf, name)
        if data is None:
            issues.append(read_issue)
            continue

        if len(data) > limits.MAX_CSS_BYTES:
            # Checked before the parser sees it. Parsing is pure Python and the
            # most expensive thing here by an order of magnitude, so a
            # multi-megabyte stylesheet is a denial of service dressed as a
            # theme; rejecting it after parsing would be too late to matter.
            issues.append(ThemeIssue(
                file=name, code="css_too_large",
                message=f"{len(data)} bytes; at most {limits.MAX_CSS_BYTES} allowed",
            ))
            continue

        try:
            filtered = filter_css(data.decode("utf-8"), name)
        except ThemeRejected as rejected:
            issues.extend(rejected.issues)
            continue
        except UnicodeDecodeError:
            issues.append(ThemeIssue(
                file=name, code="bad_css", message="stylesheet must be UTF-8",
            ))
            continue
        except RecursionError:
            issues.append(ThemeIssue(
                file=name, code="bad_css",
                message="stylesheet is too deeply nested or complex to parse",
            ))
            continue

        files[name] = filtered.css.encode("utf-8")
        urls |= filtered.urls

    return urls


def _validate_asset(
    name: str, data: bytes, is_preview: bool,
    files: dict[str, bytes], issues: IssueList,
) -> None:
    try:
        info = probe(data)
    except RecursionError:
        issues.append(ThemeIssue(
            file=name, code="bad_asset", message="asset is too complex to analyze",
        ))
        return

    if info is None:
        issues.append(ThemeIssue(
            file=name, code="bad_asset_type",
            message="not a PNG, JPEG, WebP, SVG or WOFF2 by content",
        ))
        return

    if is_preview:
        if info.kind not in RASTER_KINDS:
            issues.append(ThemeIssue(
                file=name, code="bad_asset_type",
                message=f"previews must be PNG, JPEG or WebP, not {info.kind}",
            ))
            return
        if len(data) > limits.MAX_PREVIEW_BYTES:
            issues.append(ThemeIssue(
                file=name, code="preview_too_large",
                message=f"{len(data)} bytes; at most {limits.MAX_PREVIEW_BYTES} allowed",
            ))
            return
        if max(info.width, info.height) > limits.MAX_PREVIEW_EDGE_PX:
            issues.append(ThemeIssue(
                file=name, code="preview_too_large",
                message=(
                    f"{info.width}x{info.height}; long edge must be at most "
                    f"{limits.MAX_PREVIEW_EDGE_PX}px"
                ),
            ))
            return
        files[name] = data
        return

    if info.kind == "svg":
        try:
            files[name] = sanitize_svg(data, name)
        except ThemeRejected as rejected:
            issues.extend(rejected.issues)
        except RecursionError:
            issues.append(ThemeIssue(
                file=name, code="bad_asset", message="SVG is too complex to sanitize",
            ))
        return

    files[name] = data


def validate_archive(path: Path) -> ValidatedTheme:
    entries = inspect(path)
    names = {e.name for e in entries}

    if MANIFEST_NAME not in names:
        raise ThemeRejected([ThemeIssue(
            file=MANIFEST_NAME, code="missing_manifest",
            message="theme.json must be present at the archive root",
        )])

    # Tracks what the validator was looking at, so the outer net can name the
    # file rather than reporting an empty one.
    current = ARCHIVE

    try:
        with zipfile.ZipFile(path) as zf:
            current = MANIFEST_NAME
            manifest_data, read_issue = _read_entry(zf, MANIFEST_NAME)
            if manifest_data is None:
                raise ThemeRejected([read_issue])

            manifest, parse_issue = _parse_manifest_safe(manifest_data)
            if manifest is None:
                raise ThemeRejected([parse_issue])

            _check_image_references(manifest)

            issues = IssueList()
            files: dict[str, bytes] = {MANIFEST_NAME: manifest_data}

            css_urls = _validate_stylesheets(zf, names, files, issues)

            # The write set, assembled from every route by which a file can be
            # part of a theme: named by the manifest, shipped as a font, or
            # pointed at by an accepted url(). That last route is why a
            # CSS-referenced image is shipped at all — without it such a file
            # was reported as "ignored" and the theme was written 404-ing its
            # own background.
            assets = (
                set(manifest.referenced_paths())
                | {n for n in names if n.startswith(FONTS_PREFIX)}
                | css_urls
            )
            # Stylesheets and the manifest have already had their turn, whether
            # they passed or not.
            assets -= set(files) | {n for n in CSS_FILES if n in names}

            preview_paths = {p.src for p in manifest.preview}

            for name in sorted(assets):
                current = name
                if name not in names:
                    issues.append(ThemeIssue(
                        file=name, code="missing_asset",
                        message="referenced by the theme but not present in the archive",
                    ))
                    continue

                data, read_issue = _read_entry(zf, name)
                if data is None:
                    issues.append(read_issue)
                    continue

                _validate_asset(name, data, name in preview_paths, files, issues)

            if issues:
                raise ThemeRejected(issues.finish())

            current = ARCHIVE
            return ValidatedTheme(
                manifest=manifest,
                files=files,
                ignored=sorted(names - set(files)),
                checksum=_checksum(path),
            )
    except ThemeRejected:
        # Re-raise genuine validation findings without modification.
        raise
    except Exception as e:
        # The outer net: no exception from archive content escapes this
        # function, because the stage-2 HTTP handler above it has to be able to
        # answer "rejected" rather than 500.
        #
        # The trade-off, written down so the next reader need not derive it:
        # this also masks validator bugs. A future AttributeError in this
        # package becomes a user-facing `validator_error` telling an admin
        # their theme is broken, rather than failing loudly here. The
        # logger.exception below is the seam that keeps such a bug findable —
        # stage 2 configures the handler, and an operator seeing repeated
        # validator_error in the log is looking at our bug, not at hostile
        # input.
        logger.exception("theme validation failed unexpectedly on %s", current)
        raise ThemeRejected([ThemeIssue(
            file=current, code="validator_error",
            message=(
                f"validation failed with {type(e).__name__}: "
                f"{str(e)[:limits.MAX_ERROR_DETAIL_CHARS]}"
            ),
        )])
