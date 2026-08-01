import hashlib
import json
import zipfile

import pytest

from themes.errors import ThemeRejected
from themes.validate import validate_archive

MANIFEST = {
    "schema": 1, "surface": 1, "id": "demo", "name": "Demo", "version": "1.0.0",
    "author": {"name": "Tester"}, "description": "d", "created_at": "2026-08-01",
    "targets": ["web"], "themes": ["dark"],
    "brand": {"name": "Demo", "accent": "#22c5b0"}, "preview": [],
}

# A real 1x1 PNG, so the probe sees genuine header bytes.
PNG_1x1 = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)


def build(tmp_path, files, manifest=None):
    path = tmp_path / "theme.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("theme.json", json.dumps(MANIFEST if manifest is None else manifest))
        for name, body in files.items():
            z.writestr(name, body)
    return path


def test_validates_a_minimal_theme(tmp_path):
    result = validate_archive(build(tmp_path, {"css/tokens.css": ":root { --accent: #22c5b0; }"}))
    assert result.manifest.id == "demo"
    assert "css/tokens.css" in result.files
    assert result.ignored == []


def test_checksum_is_the_sha256_of_the_archive(tmp_path):
    path = build(tmp_path, {"css/tokens.css": ":root{}"})
    assert validate_archive(path).checksum == hashlib.sha256(path.read_bytes()).hexdigest()


def test_reports_unexpected_files_as_ignored_rather_than_dropping_them_silently(tmp_path):
    result = validate_archive(build(tmp_path, {
        "css/tokens.css": ":root{}",
        "__MACOSX/._x": "junk",
        ".DS_Store": "junk",
        "deploy.sh": "rm -rf /",
    }))
    assert set(result.ignored) == {"__MACOSX/._x", ".DS_Store", "deploy.sh"}
    # The point: they are not in the write set at all.
    assert "deploy.sh" not in result.files


def test_a_manifest_is_required(tmp_path):
    path = tmp_path / "no-manifest.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("css/tokens.css", ":root{}")
    with pytest.raises(ThemeRejected) as e:
        validate_archive(path)
    assert any(i.code == "missing_manifest" for i in e.value.issues)


def test_a_referenced_asset_must_exist(tmp_path):
    manifest = {**MANIFEST, "preview": [{"src": "images/missing.png"}]}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}"}, manifest))
    assert any(i.code == "missing_asset" for i in e.value.issues)


def test_an_asset_is_typed_by_content_not_extension(tmp_path):
    manifest = {**MANIFEST, "preview": [{"src": "images/shell.png"}]}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/shell.png": "#!/bin/sh\n"}, manifest))
    assert any(i.code == "bad_asset_type" for i in e.value.issues)


def test_a_preview_over_the_pixel_cap_is_rejected(tmp_path, monkeypatch):
    from themes import limits
    monkeypatch.setattr(limits, "MAX_PREVIEW_EDGE_PX", 0)
    manifest = {**MANIFEST, "preview": [{"src": "images/p.png"}]}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/p.png": PNG_1x1}, manifest))
    assert any(i.code == "preview_too_large" for i in e.value.issues)


def test_a_valid_preview_is_kept(tmp_path):
    manifest = {**MANIFEST, "preview": [{"src": "images/p.png"}]}
    result = validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/p.png": PNG_1x1}, manifest))
    assert "images/p.png" in result.files


def test_css_problems_surface_with_their_filename(tmp_path):
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/web.css": "[data-pd-btn] { position: fixed; }"}))
    issue = next(i for i in e.value.issues if i.code == "refused_property")
    assert issue.file == "css/web.css"


def test_a_javascript_file_is_never_in_the_write_set(tmp_path):
    result = validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "css/evil.js": "fetch('//x')"}))
    assert "css/evil.js" not in result.files
    assert "css/evil.js" in result.ignored


def test_fonts_are_accepted_when_they_are_really_fonts(tmp_path):
    result = validate_archive(build(tmp_path, {
        "css/tokens.css": ":root{}",
        "fonts/x.woff2": b"wOF2" + b"\x00" * 40,
    }))
    assert "fonts/x.woff2" in result.files


def test_a_font_that_is_not_a_font_is_rejected(tmp_path):
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "fonts/x.woff2": "#!/bin/sh"}))
    assert any(i.code == "bad_asset_type" for i in e.value.issues)


def test_recursion_error_in_css_parsing_is_caught(tmp_path, monkeypatch):
    """A deeply nested CSS value can cause RecursionError in tinycss2.

    We must catch it and convert it to ThemeRejected so the archive
    is cleanly rejected, not a 500 error.
    """
    from themes import validate

    # Mock filter_css to raise RecursionError, simulating what can happen
    # with deeply nested CSS that exceeds the parser's stack depth.
    def raise_recursion(*args, **kwargs):
        raise RecursionError("maximum recursion depth exceeded")

    monkeypatch.setattr(validate, "filter_css", raise_recursion)

    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root {}"}))

    assert any(i.code == "bad_css" for i in e.value.issues)
    # Verify the message indicates it's a nesting issue
    css_issue = next(i for i in e.value.issues if i.code == "bad_css")
    assert "nested" in css_issue.message or "complex" in css_issue.message
