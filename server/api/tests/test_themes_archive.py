import os
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
    # Its own code: a symlink is not a badly-named entry and not traversal.
    assert "symlink_entry" in codes(path)


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


def test_is_safe_entry_name_rejects_all_non_ascii_and_control_characters():
    """All non-ASCII and control characters are rejected.

    This includes C0 control chars, C1 control chars, and special Unicode.
    """
    # C0 control characters (below 0x20)
    assert not is_safe_entry_name("a\tb")  # tab (0x09)
    assert not is_safe_entry_name("a\nb")  # newline (0x0A)
    # C1 control characters (0x80-0x9F range)
    assert not is_safe_entry_name("a\x85b")  # NEL (0x85)
    assert not is_safe_entry_name("a\x9bb")  # CSI (0x9B)
    # Right-to-left override (U+202E)
    assert not is_safe_entry_name("a‮b")
    # Zero-width joiner (U+200D)
    assert not is_safe_entry_name("a‍b")
    # Paragraph separator (U+2029)
    assert not is_safe_entry_name("a b")


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


def test_is_safe_entry_name_rejects_accented_characters():
    """Accented characters like é are rejected (ASCII-only policy).

    This is a deliberate cost to prevent filename spoofing and normalisation
    collisions. Theme authors cannot name files café.png, but the validator
    is more secure and consistent across platforms.
    """
    assert not is_safe_entry_name("café.png")


def test_is_safe_entry_name_rejects_component_of_non_ascii_bytes():
    """A component of 255 non-ASCII characters is rejected.

    This demonstrates why len() on a str was insufficient before: 255 é
    characters would be 255 characters but 510 UTF-8 bytes. Now that we
    restrict to ASCII, len() counts bytes correctly.
    """
    component_255_accents = "é" * 255
    assert not is_safe_entry_name(component_255_accents)
    # Even if it were 255 bytes worth of accented chars, it'd still be rejected
    # because the characters themselves are non-ASCII
    assert len(component_255_accents) == 255
    assert len(component_255_accents.encode("utf-8")) == 510


def test_is_safe_entry_name_accepts_all_allowed_punctuation():
    """All allowed punctuation and space characters are accepted together."""
    # Test a name with every allowed punctuation character: - _ . + ( ) and space
    assert is_safe_entry_name("file-name_v1.0+patch(1).png")
    assert is_safe_entry_name("dir/sub dir/file with space.txt")
    # Test each punctuation character individually
    assert is_safe_entry_name("a-b")
    assert is_safe_entry_name("a_b")
    assert is_safe_entry_name("a.b")
    assert is_safe_entry_name("a+b")
    assert is_safe_entry_name("a(b")
    assert is_safe_entry_name("a)b")
    assert is_safe_entry_name("a b")


# --- I9: one code per cause -------------------------------------------------


def test_a_retina_suffix_is_an_ordinary_asset_name():
    """icon@2x.png is a normal name, and rejecting it was collateral damage."""
    assert is_safe_entry_name("images/logo@2x.png")
    assert is_safe_entry_name("images/icon@3x.png")


def test_a_bad_character_is_reported_as_a_bad_name_and_names_the_character():
    from themes.archive import entry_name_problem
    code, message = entry_name_problem("images/café.png")
    assert code == "bad_entry_name"
    # A retina suffix is not traversal and an accent is not a symlink; the
    # message has to say which of the three it actually is.
    assert "é" in message and "U+00E9" in message
    assert "escape" not in message


def test_traversal_and_bad_names_get_different_codes(tmp_path):
    assert "unsafe_entry" in codes(build(tmp_path, {"../x.png": "x"}, name="a.zip"))
    assert "bad_entry_name" in codes(build(tmp_path, {"images/café.png": "x"}, name="b.zip"))


def test_an_overlong_component_is_a_bad_name_not_traversal():
    from themes.archive import entry_name_problem
    code, _ = entry_name_problem("a" * 256)
    assert code == "bad_entry_name"


# --- I6: the entry count is read before the central directory is parsed -----


def test_too_many_entries_is_decided_without_constructing_zipfile(tmp_path, monkeypatch):
    """The count comes from the end-of-central-directory record.

    Constructing ZipFile parses every central-directory header, which is the
    cost this check exists to avoid: 190k entries took 17 s and 115 MB to
    reject for being too many. Monkeypatching the constructor to explode proves
    the rejection happens before it is reached.
    """
    import zipfile as zf_module
    path = build(tmp_path, {f"f{i}.txt": "x" for i in range(limits_max_entries() + 1)})

    def explode(*args, **kwargs):
        raise AssertionError("ZipFile was constructed before the entry count was checked")

    monkeypatch.setattr(zf_module, "ZipFile", explode)
    assert "too_many_entries" in codes(path)


def limits_max_entries() -> int:
    from themes import limits
    return limits.MAX_ENTRIES


def test_the_declared_entry_count_matches_reality(tmp_path):
    from themes.archive import declared_entry_count
    path = build(tmp_path, {f"f{i}.txt": "x" for i in range(7)})
    assert declared_entry_count(path) == 7


def test_an_unreadable_end_record_falls_back_rather_than_crashing(tmp_path):
    from themes.archive import declared_entry_count
    path = tmp_path / "nope.zip"
    path.write_bytes(b"not a zip at all")
    assert declared_entry_count(path) is None
    # And inspect still rejects it, through the ZipFile path.
    assert "bad_archive" in codes(path)


# --- I11: the total-uncompressed cap had no test at all ---------------------


def test_rejects_an_archive_over_the_uncompressed_cap(tmp_path, monkeypatch):
    """MAX_UNCOMPRESSED_BYTES, which nothing exercised.

    Monkeypatched rather than built at full size: reaching 60 MB uncompressed
    while staying under both the 20 MB archive cap and the 100x expansion cap
    would need a 600 KB-per-second generator and put a minute on the suite for
    a threshold comparison.
    """
    from themes import limits
    monkeypatch.setattr(limits, "MAX_UNCOMPRESSED_BYTES", 100)
    # Random bytes, so the expansion-ratio check cannot fire first and mask it.
    path = build(tmp_path, {"a.bin": os.urandom(500)})
    assert "uncompressed_too_large" in codes(path)


def test_accepts_an_archive_just_under_the_uncompressed_cap(tmp_path, monkeypatch):
    from themes import limits
    monkeypatch.setattr(limits, "MAX_UNCOMPRESSED_BYTES", 1000)
    path = build(tmp_path, {"a.bin": os.urandom(500)})
    assert {e.name for e in inspect(path)} == {"a.bin"}
