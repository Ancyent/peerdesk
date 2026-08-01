"""theme.json parsing.

Pydantic gives shape validation; the rules that matter for safety — the id never
becoming a path segment, referenced paths staying inside the archive — are
explicit here rather than buried in field validators, because they are the ones
a reviewer needs to find.
"""
import json
import re
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, ValidationError

from . import limits, surface
from .errors import ThemeIssue, ThemeRejected

MANIFEST_NAME = "theme.json"
VALID_TARGETS = frozenset({"web", "appViewer", "desktop"})
VALID_THEMES = frozenset({"dark", "light"})
HEX_COLOR_RE = re.compile(r"#[0-9a-fA-F]{6}")

# The only schemes a link rendered as theme provenance may carry. Stated as
# what is accepted rather than what is refused: javascript: was the case that
# came up, but data:, vbscript: and every scheme a browser gains next are the
# same problem, and the spec's own threat model names the localStorage JWT as
# what a link in the admin UI is reaching for.
LINK_SCHEMES = frozenset({"http", "https"})


class Author(BaseModel):
    name: str
    url: str | None = None


class Brand(BaseModel):
    name: str
    accent: str


class Preview(BaseModel):
    src: str
    caption: str | None = None
    theme: str | None = None
    target: str | None = None


class Manifest(BaseModel):
    schema_version: int
    surface_version: int
    id: str
    name: str
    version: str
    author: Author
    description: str = ""
    logo: str | None = None
    created_at: str
    targets: list[str]
    themes: list[str]
    brand: Brand
    preview: list[Preview] = []

    def referenced_paths(self) -> set[str]:
        paths = {p.src for p in self.preview}
        if self.logo:
            paths.add(self.logo)
        return paths


def is_safe_relative_path(path: str) -> bool:
    """A manifest-referenced path must stay inside the archive.

    Checked here as well as in archive.py because the two arrive by different
    routes: this one is author-typed text, that one is a ZIP entry name.
    """
    if not path or path.startswith("/") or "\\" in path:
        return False
    parts = path.split("/")
    return not any(p in ("..", ".", "") for p in parts)


def is_safe_link(url: str) -> bool:
    """A manifest link must be a plain web address.

    Affirmative: an http: or https: URL with a host. Anything else — a scheme
    that executes (javascript:), a scheme that carries a payload (data:), a
    scheme-relative reference, or a bare word a browser would resolve against
    the admin page — is not a link to somewhere else and is refused.
    """
    if not url or len(url) > limits.MAX_URL_LENGTH:
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme.lower() in LINK_SCHEMES and bool(parts.netloc)


def _check_length(
    value: str | None, field: str, cap: int, issues: list[ThemeIssue]
) -> None:
    """Bound one free-text field.

    Stage 2 puts these in database columns and stage 3 renders them, so they
    are bounded where they are parsed rather than at every place they are used.
    """
    if value is not None and len(value) > cap:
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="field_too_long",
            message=f"{field} is {len(value)} characters; at most {cap} allowed",
        ))


def parse_manifest(raw: bytes) -> Manifest:
    try:
        body: Any = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ThemeRejected([ThemeIssue(
            file=MANIFEST_NAME, code="bad_json", message=f"not valid JSON: {exc}",
        )]) from None

    if not isinstance(body, dict):
        raise ThemeRejected([ThemeIssue(
            file=MANIFEST_NAME, code="bad_json", message="top level must be an object",
        )])

    # The wire names are `schema` and `surface`; the model uses explicit names so
    # `schema` does not collide with Pydantic's own attribute.
    shaped = dict(body)
    shaped["schema_version"] = shaped.pop("schema", None)
    shaped["surface_version"] = shaped.pop("surface", None)

    try:
        manifest = Manifest(**shaped)
    except ValidationError as exc:
        raise ThemeRejected([
            ThemeIssue(
                file=MANIFEST_NAME,
                code="bad_manifest",
                message=f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}",
            )
            for err in exc.errors()
        ]) from None

    issues: list[ThemeIssue] = []

    if manifest.schema_version != surface.SCHEMA_VERSION:
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="unsupported_schema",
            message=f"schema {manifest.schema_version} is not supported; this server reads {surface.SCHEMA_VERSION}",
        ))

    if manifest.surface_version > surface.SURFACE_VERSION:
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="surface_too_new",
            message=f"theme targets surface {manifest.surface_version}; this server provides {surface.SURFACE_VERSION}",
        ))

    if not surface.THEME_ID_RE.fullmatch(manifest.id):
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="bad_theme_id",
            message="id must be 1-64 characters of a-z, 0-9 and hyphen",
        ))

    for target in manifest.targets:
        if target not in VALID_TARGETS:
            issues.append(ThemeIssue(
                file=MANIFEST_NAME, code="bad_target",
                message=f"unknown target {target!r}; expected one of {sorted(VALID_TARGETS)}",
            ))

    for name in manifest.themes:
        if name not in VALID_THEMES:
            issues.append(ThemeIssue(
                file=MANIFEST_NAME, code="bad_theme_name",
                message=f"unknown theme {name!r}; expected one of {sorted(VALID_THEMES)}",
            ))

    if not HEX_COLOR_RE.fullmatch(manifest.brand.accent):
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="bad_accent",
            message="brand.accent must be a #rrggbb hex colour",
        ))

    if manifest.author.url is not None and not is_safe_link(manifest.author.url):
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="bad_author_url",
            message=(
                f"author.url must be an http:// or https:// address of at most "
                f"{limits.MAX_URL_LENGTH} characters"
            ),
        ))

    _check_length(manifest.name, "name", limits.MAX_NAME_LENGTH, issues)
    _check_length(manifest.author.name, "author.name", limits.MAX_NAME_LENGTH, issues)
    _check_length(manifest.brand.name, "brand.name", limits.MAX_NAME_LENGTH, issues)
    _check_length(manifest.description, "description", limits.MAX_DESCRIPTION_LENGTH, issues)
    for index, preview in enumerate(manifest.preview):
        _check_length(
            preview.caption, f"preview[{index}].caption",
            limits.MAX_CAPTION_LENGTH, issues,
        )

    if len(manifest.preview) > limits.MAX_PREVIEWS:
        issues.append(ThemeIssue(
            file=MANIFEST_NAME, code="too_many_previews",
            message=f"{len(manifest.preview)} previews; at most {limits.MAX_PREVIEWS} allowed",
        ))

    for path in sorted(manifest.referenced_paths()):
        if not is_safe_relative_path(path):
            issues.append(ThemeIssue(
                file=MANIFEST_NAME, code="bad_path",
                message=f"{path!r} must be a relative path inside the archive",
            ))

    if issues:
        raise ThemeRejected(issues)
    return manifest
