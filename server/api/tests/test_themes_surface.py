from themes import limits, surface


def test_caps_match_the_spec():
    assert limits.MAX_ENTRIES == 200
    assert limits.MAX_ARCHIVE_BYTES == 20 * 1024 * 1024
    assert limits.MAX_UNCOMPRESSED_BYTES == 60 * 1024 * 1024
    assert limits.MAX_EXPANSION_RATIO == 100
    assert limits.MAX_PREVIEWS == 8
    assert limits.MAX_PREVIEW_BYTES == 2 * 1024 * 1024
    assert limits.MAX_PREVIEW_EDGE_PX == 2560
    assert limits.MAX_THEMES_PER_ACCOUNT == 20
    assert limits.MAX_ACCOUNT_BYTES == 200 * 1024 * 1024
    assert limits.MAX_THEME_ID_LENGTH == 64


def test_published_selectors_are_exactly_the_documented_three():
    assert surface.PUBLISHED_SELECTORS == frozenset({
        "[data-pd-btn]", "[data-pd-input]", "[data-pd-machine]",
    })


def test_internal_hooks_are_not_published():
    # slot, spinner and scan exist in the components but are implementation
    # detail. Publishing them would freeze internals into a public contract.
    for internal in ("[data-pd-slot]", "[data-pd-spinner]", "[data-pd-scan]"):
        assert internal not in surface.PUBLISHED_SELECTORS


def test_layout_properties_are_allowed_but_escape_hatches_are_not():
    for allowed in ("width", "height", "margin", "padding", "display", "flex-direction"):
        assert allowed in surface.ALLOWED_PROPERTIES
    for refused in ("position", "z-index", "visibility", "pointer-events"):
        assert refused in surface.REFUSED_PROPERTIES
        assert refused not in surface.ALLOWED_PROPERTIES


def test_theme_id_pattern_rejects_path_separators():
    assert surface.THEME_ID_RE.fullmatch("aurora-glass")
    for hostile in ("../../etc", "a/b", "a\\b", "", "A" * 65, "Aurora Glass"):
        assert surface.THEME_ID_RE.fullmatch(hostile) is None
