import json

import pytest

from themes import surface
from themes.errors import ThemeRejected
from themes.manifest import parse_manifest

VALID = {
    "schema": 1,
    "surface": 1,
    "id": "aurora-glass",
    "name": "Aurora Glass",
    "version": "1.0.0",
    "author": {"name": "PeerDesk", "url": "https://example.invalid"},
    "description": "Glass over an aurora backdrop.",
    "logo": "images/logo.svg",
    "created_at": "2026-08-01",
    "targets": ["web", "appViewer", "desktop"],
    "themes": ["dark", "light"],
    "brand": {"name": "PeerDesk", "accent": "#22c5b0"},
    "preview": [{"src": "images/01.png", "caption": "Machines", "theme": "dark", "target": "web"}],
}


def _raw(**overrides) -> bytes:
    return json.dumps({**VALID, **overrides}).encode()


def test_parses_a_valid_manifest():
    m = parse_manifest(_raw())
    assert m.id == "aurora-glass"
    assert m.brand.accent == "#22c5b0"
    assert m.preview[0].caption == "Machines"


def test_referenced_paths_covers_logo_and_previews():
    assert parse_manifest(_raw()).referenced_paths() == {"images/logo.svg", "images/01.png"}


def test_rejects_malformed_json_without_leaking_a_json_error():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(b"{not json")
    assert e.value.issues[0].file == "theme.json"
    assert e.value.issues[0].code == "bad_json"


def test_rejects_a_non_object_top_level():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(b"[1, 2, 3]")
    assert e.value.issues[0].code == "bad_json"


def test_rejects_a_theme_id_that_could_become_a_path():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(id="../../etc"))
    assert any(i.code == "bad_theme_id" for i in e.value.issues)


def test_rejects_a_surface_newer_than_this_server():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(surface=surface.SURFACE_VERSION + 1))
    issue = next(i for i in e.value.issues if i.code == "surface_too_new")
    # The author must learn what to target, not just that it failed.
    assert str(surface.SURFACE_VERSION) in issue.message


def test_accepts_a_surface_at_the_server_version():
    assert parse_manifest(_raw(surface=surface.SURFACE_VERSION)).surface_version == surface.SURFACE_VERSION


def test_rejects_an_unknown_schema_version():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(schema=99))
    assert any(i.code == "unsupported_schema" for i in e.value.issues)


def test_rejects_more_previews_than_the_cap():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(preview=[{"src": f"images/{i}.png"} for i in range(9)]))
    assert any(i.code == "too_many_previews" for i in e.value.issues)


def test_rejects_a_referenced_path_that_escapes_the_archive():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(logo="../../../etc/passwd"))
    assert any(i.code == "bad_path" for i in e.value.issues)


def test_rejects_an_absolute_referenced_path():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(preview=[{"src": "/etc/passwd"}]))
    assert any(i.code == "bad_path" for i in e.value.issues)


def test_rejects_an_unknown_target():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(targets=["web", "toaster"]))
    assert any(i.code == "bad_target" for i in e.value.issues)


def test_rejects_a_non_hex_accent():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(brand={"name": "X", "accent": "javascript:alert(1)"}))
    assert any(i.code == "bad_accent" for i in e.value.issues)


def test_logo_is_optional():
    body = {k: v for k, v in VALID.items() if k != "logo"}
    m = parse_manifest(json.dumps(body).encode())
    assert m.logo is None
    assert m.referenced_paths() == {"images/01.png"}


def test_reports_several_problems_at_once():
    with pytest.raises(ThemeRejected) as e:
        parse_manifest(_raw(id="NOPE", targets=["toaster"]))
    codes = {i.code for i in e.value.issues}
    assert {"bad_theme_id", "bad_target"} <= codes
