import hashlib
import json
import zipfile

import pytest

from themes.errors import ThemeRejected, ThemeIssue
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


def test_an_svg_referenced_as_a_preview_is_rejected(tmp_path):
    """Previews must be raster; SVG is not allowed even if it's well-formed."""
    svg_data = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    manifest = {**MANIFEST, "preview": [{"src": "images/logo.svg"}]}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/logo.svg": svg_data}, manifest))
    assert any(i.code == "bad_asset_type" and "previews must be" in i.message for i in e.value.issues)


def test_an_svg_referenced_as_a_logo_is_sanitized_and_kept(tmp_path):
    """SVGs referenced as a logo (not preview) are sanitized and kept."""
    svg_data = b'<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40"/></svg>'
    # Add logo to manifest to make it a referenced asset.
    manifest = {**MANIFEST, "logo": "images/logo.svg"}
    result = validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/logo.svg": svg_data}, manifest))
    assert "images/logo.svg" in result.files


def test_manifest_cannot_reference_itself(tmp_path):
    """The manifest cannot reference itself as an asset (preview or otherwise)."""
    manifest = {**MANIFEST, "preview": [{"src": "theme.json"}]}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}"}, manifest))
    assert any(i.code == "bad_manifest" for i in e.value.issues)


def test_corrupted_entry_produces_themed_rejection(tmp_path, monkeypatch):
    """Archive entries that raise any exception during read are rejected cleanly.

    This tests the defensive requirement: no exception from archive content
    escapes validate_archive. Instead, all exceptions become ThemeRejected.
    """
    from themes import validate
    import zipfile as zf_module

    original_zf_read = zf_module.ZipFile.read

    call_count = [0]

    def read_that_fails_on_css(self, name, pwd=None):
        call_count[0] += 1
        if call_count[0] == 2 and name == "css/tokens.css":  # Fail on CSS read.
            raise OSError("corrupted or incomplete deflate stream")
        return original_zf_read(self, name, pwd)

    monkeypatch.setattr(zf_module.ZipFile, "read", read_that_fails_on_css)

    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}"}))

    # Should have at least one issue from the exception.
    assert len(e.value.issues) > 0
    # Verify we didn't let the raw exception escape.
    for issue in e.value.issues:
        assert isinstance(issue, ThemeIssue)


def test_read_errors_dont_hide_other_issues(tmp_path, monkeypatch):
    """When one entry read fails, validation continues and reports all issues."""
    from themes import validate

    original_read_entry = validate._read_entry
    call_count = [0]

    def read_entry_that_fails_once(zf, name):
        call_count[0] += 1
        if call_count[0] == 2:  # Fail on CSS entry only.
            return None, ThemeIssue(file=name, code="unreadable_entry", message="test")
        return original_read_entry(zf, name)

    monkeypatch.setattr(validate, "_read_entry", read_entry_that_fails_once)

    # Manifest references a missing asset so we get two issues.
    manifest = {
        **MANIFEST,
        "preview": [{"src": "images/missing.png"}]
    }
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}"}, manifest))

    codes = {i.code for i in e.value.issues}
    # Should have both the read error and missing asset issue.
    assert "unreadable_entry" in codes
    assert "missing_asset" in codes


def test_deeply_nested_css_is_rejected_not_recursion_error(tmp_path):
    """Real deeply nested CSS (500+ levels) triggers RecursionError in the parser.

    The validator must catch it and convert to ThemeRejected, not let it escape.
    """
    # Build a CSS function nesting that triggers RecursionError in tinycss2.
    # 500 levels of calc() exceeds the parser's stack depth without hitting
    # the archive expansion_ratio check (which happens around 1000 levels).
    nested = "calc(" * 500 + "1" + ")" * 500
    css = f":root {{ --deep: {nested}; }}"

    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": css}))

    # The RecursionError must be caught and converted to a ThemeIssue.
    assert any(i.code == "bad_css" for i in e.value.issues)


def test_deeply_nested_svg_is_rejected_not_recursion_error(tmp_path):
    """Real deeply nested SVG (1000+ levels of <g> tags) triggers RecursionError.

    The validator must catch it and convert to ThemeRejected.
    """
    # Build an SVG with 1000 levels of nesting, which triggers RecursionError in sanitizer.
    nested_svg = "<svg xmlns='http://www.w3.org/2000/svg'>"
    nested_svg += "<g>" * 1000
    nested_svg += "<circle cx='50' cy='50' r='40'/>"
    nested_svg += "</g>" * 1000
    nested_svg += "</svg>"

    # Reference it so it's in the expected set.
    manifest = {**MANIFEST, "logo": "images/deep.svg"}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/deep.svg": nested_svg.encode()}, manifest))

    # The RecursionError during SVG sanitization must be caught.
    assert any(i.code == "bad_asset" for i in e.value.issues)


def test_deeply_nested_image_metadata_is_rejected_not_recursion_error(tmp_path, monkeypatch):
    """Deeply nested image metadata (hypothetically) can trigger RecursionError.

    The validator must catch it during probe and convert to ThemeRejected.
    Note: imageprobe is iterative and bounded by design, so no genuine recursion
    path exists; this test verifies the guard works if one did.
    """
    from themes import validate

    # Mock the probe function to simulate RecursionError on complex metadata.
    def raise_recursion_on_complex_image(data):
        # Raise only for images we explicitly mark as complex (larger than typical).
        # The manifest (JSON) is small, so it won't hit this.
        if len(data) == len(PNG_1x1) + 1:  # Our test image is PNG_1x1 with extra byte
            raise RecursionError("too complex to parse image metadata")
        # For other images, use real probe.
        from themes.imageprobe import probe as real_probe
        return real_probe(data)

    monkeypatch.setattr(validate, "probe", raise_recursion_on_complex_image)

    # Create an "image" by appending a byte to PNG_1x1 to trigger the mock.
    test_image = PNG_1x1 + b"x"
    manifest = {**MANIFEST, "logo": "images/complex.png"}
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/complex.png": test_image}, manifest))

    assert any(i.code == "bad_asset" for i in e.value.issues)


def test_deeply_nested_json_manifest_triggers_recursion_error(tmp_path):
    """Deeply nested JSON (10,000+ array levels) in theme.json triggers RecursionError.

    The parse_manifest guard must catch and convert to ThemeRejected.
    """
    # Build a manifest with ~10,000 levels of nested arrays.
    # Store uncompressed so expansion_ratio check doesn't catch it first.
    nested_json = "[" * 10000 + '{"schema": 1}' + "]" * 10000
    path = tmp_path / "theme.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("theme.json", nested_json)
        z.writestr("css/tokens.css", ":root{}")

    with pytest.raises(ThemeRejected) as e:
        validate_archive(path)

    # Must be caught and reported as bad_manifest, not propagate RecursionError.
    assert any(i.code == "bad_manifest" for i in e.value.issues)
    # Ensure we're not swallowing genuine ThemeRejected as validator_error.
    assert not any(i.code == "validator_error" for i in e.value.issues)


def test_deeply_nested_json_manifest_with_smaller_depth_also_rejected(tmp_path):
    """Deeply nested JSON is rejected regardless of depth.

    Test with a smaller depth to ensure the guard works across different sizes.
    """
    # Build a manifest with ~2,000 levels of nested arrays.
    nested_json = "[" * 2000 + '{"schema": 1}' + "]" * 2000
    path = tmp_path / "theme.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_STORED) as z:
        z.writestr("theme.json", nested_json)
        z.writestr("css/tokens.css", ":root{}")

    with pytest.raises(ThemeRejected) as e:
        validate_archive(path)

    # Must be caught as bad_manifest.
    assert any(i.code == "bad_manifest" for i in e.value.issues)


def test_validator_outer_net_catches_unexpected_exception(tmp_path, monkeypatch):
    """The outer net catches ANY exception and converts to ThemeRejected.

    This ensures no exception from any module escapes validate_archive.
    """
    from themes import validate

    # Mock one of the called modules to raise an unusual exception.
    original_probe = validate.probe

    def probe_that_fails(*args, **kwargs):
        raise MemoryError("simulated memory failure")

    monkeypatch.setattr(validate, "probe", probe_that_fails)

    # Reference an asset so probe gets called.
    manifest = {**MANIFEST, "logo": "images/test.svg"}
    svg_data = b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'

    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/tokens.css": ":root{}", "images/test.svg": svg_data}, manifest))

    # The outer net should catch it with validator_error code.
    codes = {i.code for i in e.value.issues}
    assert "validator_error" in codes
    # Verify the exception type is mentioned in the message.
    error_issue = next(i for i in e.value.issues if i.code == "validator_error")
    assert "MemoryError" in error_issue.message


def test_genuine_theme_rejected_is_not_swallowed_by_outer_net(tmp_path):
    """Genuine ThemeRejected raised deep inside is re-raised unchanged.

    The outer net must not convert real findings to validator_error.
    """
    # Create a valid archive with a CSS property violation.
    with pytest.raises(ThemeRejected) as e:
        validate_archive(build(tmp_path, {"css/web.css": "[data-pd-btn] { position: fixed; }"}))

    # Should have the real issue, not validator_error.
    codes = {i.code for i in e.value.issues}
    assert "refused_property" in codes
    assert "validator_error" not in codes
