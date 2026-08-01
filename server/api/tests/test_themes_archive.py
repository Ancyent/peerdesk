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
