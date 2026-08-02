import importlib.util
import json
import struct
import sys
import zlib
from pathlib import Path

import pytest

# The builder ships in the image, not in the API package, so load it by path
# the way the image invokes it -- same approach as test_write_manifest.py.
_SPEC = importlib.util.spec_from_file_location(
    "brand",
    Path(__file__).resolve().parents[3] / "deploy" / "builder" / "brand.py",
)
_MOD = importlib.util.module_from_spec(_SPEC)
sys.modules["brand"] = _MOD
_SPEC.loader.exec_module(_MOD)
load_profile = _MOD.load_profile
tauri_config = _MOD.tauri_config
artifact_prefix = _MOD.artifact_prefix

VALID = {
    "product_name": "Acme Desk",
    "identifier": "com.acme.desk",
    "server_url": "https://desk.acme.example",
    "icon": "icon.png",
}


def _png(width: int, height: int) -> bytes:
    """A real PNG of the given size, so the shape check reads real bytes."""
    raw = b"".join(b"\x00" + bytes([80, 40, 200, 255]) * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _brand_dir(tmp_path: Path, **overrides) -> Path:
    d = tmp_path / "brand"
    d.mkdir(exist_ok=True)
    profile = {**VALID, **overrides}
    for key, value in list(overrides.items()):
        if value is None:
            profile.pop(key, None)
    (d / "brand.json").write_text(json.dumps(profile))
    if "icon" in profile:
        (d / profile["icon"]).write_bytes(_png(64, 64))
    return d


def test_no_brand_dir_means_an_unbranded_build():
    assert load_profile(None) is None


def test_a_valid_profile_loads_every_field(tmp_path):
    p = load_profile(_brand_dir(tmp_path))
    assert p.product_name == "Acme Desk"
    assert p.identifier == "com.acme.desk"
    assert p.server_url == "https://desk.acme.example"
    assert p.icon.name == "icon.png"


def test_the_slug_lowercases_and_hyphenates(tmp_path):
    assert load_profile(_brand_dir(tmp_path)).slug == "acme-desk"


def test_the_updater_endpoint_is_derived_from_the_server_url(tmp_path):
    """Operators asked to write this by hand get it wrong, and the mistake only
    surfaces at the first update, on machines they no longer control."""
    p = load_profile(_brand_dir(tmp_path))
    assert p.updater_endpoint == (
        "https://desk.acme.example/api/releases/update/"
        "{{target}}/{{arch}}/{{current_version}}"
    )


def test_a_trailing_slash_on_the_server_url_does_not_double_up(tmp_path):
    p = load_profile(_brand_dir(tmp_path, server_url="https://desk.acme.example/"))
    assert "//api/releases" not in p.updater_endpoint


def test_an_explicit_updater_endpoint_overrides_the_derivation(tmp_path):
    p = load_profile(_brand_dir(tmp_path, updater_endpoint="https://u.acme.example/feed"))
    assert p.updater_endpoint == "https://u.acme.example/feed"


@pytest.mark.parametrize("field", ["product_name", "identifier", "server_url", "icon"])
def test_every_required_field_is_required(tmp_path, field):
    with pytest.raises(ValueError, match=field):
        load_profile(_brand_dir(tmp_path, **{field: None}))


@pytest.mark.parametrize("bad", ["acme", "", "com..desk", "com.acme.", ".com.acme"])
def test_a_malformed_identifier_is_rejected(tmp_path, bad):
    """Tauri uses this for bundle identity. A malformed one fails deep inside
    the Windows bundler with an error naming neither the field nor the file."""
    with pytest.raises(ValueError, match="identifier"):
        load_profile(_brand_dir(tmp_path, identifier=bad))


@pytest.mark.parametrize("bad", ["   ", "Acme/Desk", "Acme\\Desk"])
def test_a_product_name_that_cannot_be_a_filename_is_rejected(tmp_path, bad):
    with pytest.raises(ValueError, match="product_name"):
        load_profile(_brand_dir(tmp_path, product_name=bad))


def test_a_missing_icon_file_is_rejected_by_name(tmp_path):
    d = _brand_dir(tmp_path)
    (d / "icon.png").unlink()
    with pytest.raises(ValueError, match="icon"):
        load_profile(d)


def test_a_non_square_icon_is_rejected_before_anything_compiles(tmp_path):
    """cargo tauri icon rejects non-square input. Catching it here costs a
    second; catching it there costs twenty minutes of build first."""
    d = _brand_dir(tmp_path)
    (d / "icon.png").write_bytes(_png(64, 32))
    with pytest.raises(ValueError, match="square"):
        load_profile(d)


def test_an_unbranded_config_carries_only_the_version():
    assert tauri_config(None, "1.2.3") == {"version": "1.2.3"}


def test_a_branded_config_carries_the_brand_and_the_version(tmp_path):
    cfg = tauri_config(load_profile(_brand_dir(tmp_path)), "1.2.3")
    assert cfg["version"] == "1.2.3"
    assert cfg["productName"] == "Acme Desk"
    assert cfg["identifier"] == "com.acme.desk"
    # Without this the binary keeps its original name inside a branded folder.
    assert cfg["mainBinaryName"] == "acme-desk"
    assert cfg["app"]["windows"][0]["title"] == "Acme Desk"
    assert cfg["plugins"]["updater"]["endpoints"] == [
        "https://desk.acme.example/api/releases/update/"
        "{{target}}/{{arch}}/{{current_version}}"
    ]


def test_the_artifact_prefix_falls_back_to_peerdesk(tmp_path):
    assert artifact_prefix(None) == "peerdesk"
    assert artifact_prefix(load_profile(_brand_dir(tmp_path))) == "acme-desk"
