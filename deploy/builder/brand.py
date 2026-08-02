"""Read, validate and interpret a white-label brand profile.

Everything a branded client needs that cannot be delivered at runtime lives
here, and the list is deliberately short: the client already receives its
display name, logo and accent colour from GET /branding, and its server URL
from the agent's config. Duplicating any of those would create a second place
to change and a chance for the two to disagree.

Validation is strict and runs before anything compiles. A malformed identifier
fails deep inside the Windows bundler with an error naming neither the field
nor the file, and a non-square icon fails inside cargo tauri icon -- both after
twenty minutes of build. Failing here costs a second.
"""
import json
import re
import struct
from dataclasses import dataclass
from pathlib import Path

PROFILE_NAME = "brand.json"
REQUIRED = ("product_name", "identifier", "server_url", "icon")

# Reverse-DNS: at least two non-empty, dot-separated segments.
IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$")

UPDATE_PATH = "/api/releases/update/{{target}}/{{arch}}/{{current_version}}"

# The config the fragment is merged into. Resolved from this file so the builder
# image, which runs brand.py by path out of the mounted checkout, finds the same
# tauri.conf.json the build is about to compile.
TAURI_CONF = Path(__file__).resolve().parents[2] / "desktop" / "src-tauri" / "tauri.conf.json"


@dataclass(frozen=True)
class Profile:
    product_name: str
    identifier: str
    server_url: str
    icon: Path
    updater_endpoint: str
    slug: str


def _slugify(product_name: str) -> str:
    """Lowercase, runs of non-alphanumerics collapsed to single hyphens.

    Used for artifact filenames and mainBinaryName. Deliberately NOT used to
    guess the Linux package name: Tauri derives that with a rule of its own --
    it turns "PeerDesk" into "peer-desk", splitting at the case boundary -- and
    a reimplementation here would silently drift from it. Where the real package
    name is needed, it is read out of the built package instead.
    """
    slug = re.sub(r"[^a-z0-9]+", "-", product_name.lower()).strip("-")
    if not slug:
        raise ValueError(f"{PROFILE_NAME}: product_name {product_name!r} slugifies to nothing")
    return slug


def _png_size(data: bytes) -> tuple[int, int] | None:
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _check_icon_shape(icon: Path) -> None:
    if icon.suffix.lower() == ".svg":
        return  # SVG scales; cargo tauri icon accepts it without a shape check.
    size = _png_size(icon.read_bytes())
    if size is None:
        raise ValueError(f"{PROFILE_NAME}: icon {icon.name!r} is not a PNG or an SVG")
    if size[0] != size[1]:
        raise ValueError(
            f"{PROFILE_NAME}: icon {icon.name!r} must be square, got {size[0]}x{size[1]}"
        )


def load_profile(brand_dir: Path | None) -> Profile | None:
    if brand_dir is None:
        return None
    brand_dir = Path(brand_dir)

    raw = json.loads((brand_dir / PROFILE_NAME).read_text())

    for field in REQUIRED:
        value = raw.get(field)
        if not isinstance(value, str) or not value.strip():
            raise ValueError(
                f"{PROFILE_NAME}: {field} is required and must be a non-empty string"
            )

    product_name = raw["product_name"].strip()
    if "/" in product_name or "\\" in product_name:
        raise ValueError(f"{PROFILE_NAME}: product_name must not contain a path separator")

    identifier = raw["identifier"].strip()
    if not IDENTIFIER_RE.match(identifier):
        raise ValueError(
            f"{PROFILE_NAME}: identifier {identifier!r} must be reverse-DNS, e.g. com.acme.desk"
        )

    icon = brand_dir / raw["icon"]
    if not icon.is_file():
        raise ValueError(f"{PROFILE_NAME}: icon {raw['icon']!r} not found in {brand_dir}")
    _check_icon_shape(icon)

    server_url = raw["server_url"].strip().rstrip("/")
    updater_endpoint = raw.get("updater_endpoint") or (server_url + UPDATE_PATH)

    return Profile(
        product_name=product_name,
        identifier=identifier,
        server_url=server_url,
        icon=icon,
        updater_endpoint=updater_endpoint,
        slug=_slugify(product_name),
    )


def _retitled_windows(conf_path: Path, product_name: str) -> list[dict]:
    """The whole app.windows array, with only the main window's title changed.

    Both consumers of this fragment merge it with RFC 7386 JSON Merge Patch
    (json_patch::merge in tauri-build), whose defining rule is that a patch
    value which is not an object REPLACES the target outright. Objects merge
    key by key; arrays do not merge at all.

    So a fragment carrying [{"label": "main", "title": ...}] does not add a
    title to the existing window -- it substitutes a one-key window for it, and
    everything tauri.conf.json declares alongside is gone: width, height,
    minWidth, minHeight, and decorations: false, which the app's own TitleBar
    (drawn with data-tauri-drag-region) depends on. The branded client then
    launches with an OS titlebar stacked on its own, at the default 800x600.
    Reading the real array and re-emitting it complete is the only way to patch
    one field of it.

    Any future array-valued field needs the same treatment. The deliberate
    exception is plugins.updater.endpoints: replacing that array wholesale is
    exactly what a brand wants.
    """
    windows = json.loads(Path(conf_path).read_text())["app"]["windows"]
    if not any(w.get("label") == "main" for w in windows):
        raise ValueError(f"{conf_path}: app.windows declares no window labelled 'main'")
    return [{**w, "title": product_name} if w.get("label") == "main" else w for w in windows]


def tauri_config(profile: Profile | None, version: str, conf_path: Path = TAURI_CONF) -> dict:
    """The fragment handed to both TAURI_CONFIG and `cargo tauri build --config`.

    Both are needed and neither is sufficient. tauri-build reads TAURI_CONFIG,
    which is what reaches the Windows viewer -- built by a plain `cargo build`
    where the CLI never runs. The CLI merges --config into its own view, which
    is what stamps the deb/rpm/AppImage metadata; it sets TAURI_CONFIG for its
    children but never reads it, so the variable alone would leave those
    packages carrying the wrong name and version.

    conf_path is a parameter of this function rather than of load_profile
    because it is not part of the brand: a Profile describes what the operator
    supplied, while producing a merge patch is inherently a statement about the
    document being patched. Defaulting it to the checkout's own tauri.conf.json
    keeps build.sh's call unchanged and gives tests an explicit seam.
    """
    config: dict = {"version": version}
    if profile is None:
        return config
    config.update({
        "productName": profile.product_name,
        "identifier": profile.identifier,
        "mainBinaryName": profile.slug,
        "app": {"windows": _retitled_windows(conf_path, profile.product_name)},
        "plugins": {"updater": {"endpoints": [profile.updater_endpoint]}},
    })
    return config


def artifact_prefix(profile: Profile | None) -> str:
    return "peerdesk" if profile is None else profile.slug
