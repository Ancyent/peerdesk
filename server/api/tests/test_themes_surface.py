from pathlib import Path

from themes import limits, surface


def test_settable_tokens_are_derived_and_not_empty():
    """A bug producing an empty set would make every token check pass.

    SETTABLE_TOKENS is derived from the built-in theme's tokens.css. If that
    derivation ever returned nothing, `name not in SETTABLE_TOKENS` would
    reject every token instead of accepting the real ones — or, with the
    condition the other way round, accept everything. Either way the check
    would stop meaning anything, so its input is asserted directly.
    """
    assert len(surface.SETTABLE_TOKENS) > 20
    for token in ("--accent", "--text-1", "--surface-bg", "--radius"):
        assert token in surface.SETTABLE_TOKENS


def test_no_settable_token_carries_the_reserved_prefix():
    """The two sets must not overlap, or the reserved half means nothing."""
    for token in surface.SETTABLE_TOKENS:
        assert not token.startswith(surface.RESERVED_TOKEN_PREFIX)


def test_state_pseudo_classes_are_states_not_structure():
    assert surface.STATE_PSEUDO_CLASSES == frozenset({
        "hover", "focus-visible", "active", "disabled",
    })
    # Anything that selects by position rather than by published hook would be
    # the selector boundary written backwards.
    for structural in ("not", "has", "nth-child", "first-child"):
        assert structural not in surface.STATE_PSEUDO_CLASSES


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
    assert limits.MAX_CSS_BYTES == 256 * 1024
    assert limits.MAX_ISSUES == 200
    assert limits.MAX_NAME_LENGTH == 80
    assert limits.MAX_DESCRIPTION_LENGTH == 500
    assert limits.MAX_CAPTION_LENGTH == 120
    assert limits.MAX_URL_LENGTH == 300


def test_every_module_takes_its_caps_from_limits():
    """No module in the package declares a cap of its own.

    limits.py is meant to be the single reviewed place a number lives. A module
    that grows its own MAX_* constant defeats that quietly, because it always
    looks reasonable at the point it is written.
    """
    package = Path(surface.__file__).parent
    for module in sorted(package.glob("*.py")):
        if module.name == "limits.py":
            continue
        source = module.read_text()
        for line in source.splitlines():
            stripped = line.strip()
            assert not (stripped.startswith("MAX_") and "=" in stripped), (
                f"{module.name} declares its own cap ({stripped}); "
                f"it belongs in limits.py"
            )


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
