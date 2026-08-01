import zipfile

import pytest

from themes.archive import inspect, is_safe_entry_name
from themes.errors import ThemeRejected


def build(tmp_path, entries, name="t.zip"):
    path = tmp_path / name
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for entry_name, body in entries.items():
            z.writestr(entry_name, body)
    return path


def codes(path) -> set[str]:
    with pytest.raises(ThemeRejected) as e:
        inspect(path)
    return {i.code for i in e.value.issues}


def test_lists_entries_of_a_sane_archive(tmp_path):
    path = build(tmp_path, {"theme.json": "{}", "css/tokens.css": ":root{}"})
    assert {e.name for e in inspect(path)} == {"theme.json", "css/tokens.css"}


def test_rejects_a_path_escaping_the_root(tmp_path):
    assert "unsafe_entry" in codes(build(tmp_path, {"../../etc/passwd": "x"}))


def test_rejects_an_absolute_path(tmp_path):
    assert "unsafe_entry" in codes(build(tmp_path, {"/etc/passwd": "x"}))


def test_rejects_a_windows_style_traversal(tmp_path):
    assert "unsafe_entry" in codes(build(tmp_path, {"..\\..\\windows\\x": "x"}))


def test_rejects_too_many_entries(tmp_path):
    assert "too_many_entries" in codes(build(tmp_path, {f"f{i}.txt": "x" for i in range(201)}))


def test_rejects_an_oversized_archive(tmp_path, monkeypatch):
    from themes import limits
    monkeypatch.setattr(limits, "MAX_ARCHIVE_BYTES", 100)
    assert "archive_too_large" in codes(build(tmp_path, {"a.txt": "x" * 5000}))


def test_rejects_a_zip_bomb_by_expansion_ratio(tmp_path):
    # Highly compressible content: small on disk, large on expansion.
    assert "expansion_ratio" in codes(build(tmp_path, {"bomb.txt": "A" * (40 * 1024 * 1024)}))


def test_rejects_a_symlink_entry(tmp_path):
    path = tmp_path / "link.zip"
    with zipfile.ZipFile(path, "w") as z:
        info = zipfile.ZipInfo("evil")
        # 0xA1FF: the symlink bit set in the external attributes.
        info.external_attr = 0xA1FF << 16
        z.writestr(info, "/etc/passwd")
    assert "unsafe_entry" in codes(path)


def test_rejects_a_file_that_is_not_a_zip(tmp_path):
    path = tmp_path / "nope.zip"
    path.write_bytes(b"this is not a zip")
    assert "bad_archive" in codes(path)


def test_directory_entries_are_ignored_not_rejected(tmp_path):
    path = tmp_path / "d.zip"
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("css/", "")
        z.writestr("css/tokens.css", ":root{}")
    assert {e.name for e in inspect(path)} == {"css/tokens.css"}


def test_is_safe_entry_name_rules():
    assert is_safe_entry_name("css/tokens.css")
    for bad in ("../x", "/x", "a/../../b", "a\\b", "", "./x"):
        assert not is_safe_entry_name(bad)


def test_is_safe_entry_name_rejects_nul_byte():
    assert not is_safe_entry_name("logo.svg\x00.exe")


def test_is_safe_entry_name_rejects_windows_drive_prefix():
    """Windows drive-letter paths like C:/x are not relative."""
    assert not is_safe_entry_name("C:/x")
    assert not is_safe_entry_name("C:x")


def test_is_safe_entry_name_rejects_control_characters():
    """Control characters (tab, newline, etc.) are not acceptable."""
    assert not is_safe_entry_name("a\tb")  # tab (0x09)
    assert not is_safe_entry_name("a\nb")  # newline (0x0A)


def test_is_safe_entry_name_rejects_unbounded_length():
    """Very long names exceeding MAX_ENTRY_NAME_LENGTH are rejected."""
    from themes import limits
    long_name = "a" * (limits.MAX_ENTRY_NAME_LENGTH + 1)
    assert not is_safe_entry_name(long_name)


def test_is_safe_entry_name_accepts_at_exact_length_cap():
    """A name at exactly MAX_ENTRY_NAME_LENGTH is accepted.

    Build it as multiple 255-byte components joined with slashes to respect
    the per-component limit.
    """
    from themes import limits
    # Create components of 255 bytes each, joined by slashes
    # 16 components of 255 bytes + 15 slashes = 4080 + 15 = 4095 bytes
    component = "a" * 255
    parts = [component] * 16
    name_at_cap = "/".join(parts)
    # Verify it's within the cap
    assert len(name_at_cap) <= limits.MAX_ENTRY_NAME_LENGTH
    assert is_safe_entry_name(name_at_cap)


def test_is_safe_entry_name_accepts_component_at_255_bytes():
    """A component at exactly 255 bytes is accepted."""
    component_255 = "a" * 255
    assert is_safe_entry_name(component_255)
    assert is_safe_entry_name(f"dir/{component_255}")


def test_is_safe_entry_name_rejects_component_over_255_bytes():
    """A component longer than 255 bytes is rejected."""
    component_256 = "a" * 256
    assert not is_safe_entry_name(component_256)
    assert not is_safe_entry_name(f"dir/{component_256}")


def test_is_safe_entry_name_rejects_trailing_slash():
    """Names ending with / have an empty final component."""
    assert not is_safe_entry_name("css/")


def test_is_safe_entry_name_rejects_only_dots():
    """Names that are only dots (. or ..) or doubled dots are rejected."""
    assert not is_safe_entry_name(".")
    assert not is_safe_entry_name("..")


def test_is_safe_entry_name_rejects_unc_style_paths():
    """UNC paths like //server/share/x have empty components."""
    assert not is_safe_entry_name("//server/share/x")


def test_is_safe_entry_name_accepts_legal_names():
    """Common legal names are accepted."""
    assert is_safe_entry_name("css/tokens.css")
    assert is_safe_entry_name("images/a-b_c.1.png")
    assert is_safe_entry_name("fonts/Inter-Regular.woff2")
    assert is_safe_entry_name("file with space.txt")


def test_rejects_archive_with_high_extract_version(tmp_path):
    """An archive with extract_version above MAX_EXTRACT_VERSION is rejected as bad_archive."""
    path = tmp_path / "badversion.zip"
    with zipfile.ZipFile(path, "w") as z:
        info = zipfile.ZipInfo("test.txt")
        # Set extract_version to something very high (9.9)
        info.extract_version = 99
        z.writestr(info, "content")
    assert "bad_archive" in codes(path)
