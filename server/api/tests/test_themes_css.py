import pytest

from themes.cssfilter import filter_css
from themes.errors import ThemeRejected


def codes(source: str) -> set[str]:
    with pytest.raises(ThemeRejected) as e:
        filter_css(source, "css/web.css")
    return {i.code for i in e.value.issues}


def test_accepts_custom_properties_on_root():
    out = filter_css(":root { --accent: #22c5b0; --radius: 12px; }", "css/tokens.css").css
    assert "--accent" in out
    assert "#22c5b0" in out


def test_accepts_the_light_theme_block():
    out = filter_css(":root[data-theme='light'] { --accent: #0d8b7d; }", "css/tokens.css").css
    assert "--accent" in out


def test_accepts_a_published_selector_with_allowed_properties():
    out = filter_css("[data-pd-btn] { border-radius: 2px; text-transform: uppercase; }", "css/web.css").css
    assert "border-radius" in out


def test_accepts_layout_properties_on_a_published_selector():
    # Deliberately generous: a bigger, squarer button is a legitimate request.
    out = filter_css("[data-pd-btn] { width: 200px; height: 48px; margin: 4px; display: flex; }", "css/web.css").css
    for prop in ("width", "height", "margin", "display"):
        assert prop in out


def test_rejects_an_unpublished_selector():
    assert "selector_not_published" in codes(".sidebar { color: red; }")


def test_rejects_an_internal_hook():
    assert "selector_not_published" in codes("[data-pd-spinner] { color: red; }")


def test_rejects_a_bare_element_selector():
    assert "selector_not_published" in codes("button { color: red; }")


def test_rejects_a_universal_selector():
    assert "selector_not_published" in codes("* { color: red; }")


def test_rejects_a_refused_property():
    assert "refused_property" in codes("[data-pd-btn] { position: fixed; }")


def test_rejects_visibility_and_pointer_events():
    assert "refused_property" in codes("[data-pd-btn] { visibility: hidden; }")
    assert "refused_property" in codes("[data-pd-btn] { pointer-events: none; }")


def test_rejects_an_unknown_property_rather_than_passing_it_through():
    assert "property_not_allowed" in codes("[data-pd-btn] { -webkit-app-region: drag; }")


def test_rejects_a_declaration_that_is_not_a_token_in_a_token_block():
    assert "property_outside_component" in codes(":root { color: red; }")


def test_rejects_a_custom_property_outside_a_token_block():
    assert "token_outside_root" in codes("[data-pd-btn] { --sneaky: 1; }")


def test_rejects_an_external_url():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("https://attacker.invalid/p.png"); }')


def test_rejects_a_protocol_relative_url():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("//attacker.invalid/p.png"); }')


def test_rejects_a_data_url_because_it_bypasses_the_asset_checks():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("data:image/svg+xml,<svg/>"); }')


def test_accepts_a_relative_url_pointing_into_the_archive():
    out = filter_css('[data-pd-btn] { background-image: url("images/tile.png"); }', "css/web.css").css
    assert "images/tile.png" in out


def test_rejects_an_import():
    assert "import_rejected" in codes('@import url("https://attacker.invalid/x.css");')


def test_rejects_a_relative_import_too():
    # Even inside the archive: it would let one file smuggle rules past the
    # per-file checks the caller applies.
    assert "import_rejected" in codes('@import "other.css";')


def test_rejects_z_index_at_any_value():
    # Refused outright rather than capped: a theme that needs to stack above its
    # own component is reaching for something it was not given.
    assert "refused_property" in codes("[data-pd-btn] { z-index: 9999; }")
    assert "refused_property" in codes("[data-pd-btn] { z-index: 5; }")


def test_reports_the_line_number():
    with pytest.raises(ThemeRejected) as e:
        filter_css("\n\n[data-pd-btn] {\n  position: fixed;\n}\n", "css/web.css")
    issue = next(i for i in e.value.issues if i.code == "refused_property")
    assert issue.line == 4
    assert issue.file == "css/web.css"


def test_reports_every_problem_in_one_pass():
    assert codes(
        ".nope { color: red; }\n"
        "[data-pd-btn] { position: fixed; }\n"
        '[data-pd-input] { background: url("https://x.invalid/a"); }\n'
    ) == {"selector_not_published", "refused_property", "external_url"}


def test_rejects_a_media_query_wrapping_an_unpublished_selector():
    assert "selector_not_published" in codes("@media (min-width: 600px) { .sidebar { color: red; } }")


def test_accepts_a_media_query_wrapping_a_published_selector():
    out = filter_css("@media (min-width: 600px) { [data-pd-btn] { width: 100px; } }", "css/web.css").css
    assert "min-width" in out


def test_rejects_an_unquoted_external_url():
    assert "external_url" in codes('[data-pd-btn] { background-image: url(https://attacker.invalid/a.png); }')


def test_rejects_an_unquoted_protocol_relative_url():
    assert "external_url" in codes('[data-pd-btn] { background-image: url(//attacker.invalid/a.png); }')


def test_rejects_an_unquoted_data_url():
    assert "external_url" in codes('[data-pd-btn] { background-image: url(data:image/svg+xml,<svg/>); }')


def test_rejects_uppercase_url_with_external_target():
    assert "external_url" in codes('[data-pd-btn] { background-image: URL(https://attacker.invalid/a.png); }')


def test_rejects_url_inside_image_set_with_external_target():
    assert "external_url" in codes('[data-pd-btn] { background-image: image-set(url(https://attacker.invalid/a) 1x); }')


def test_rejects_url_in_custom_property_with_external_target():
    assert "external_url" in codes(':root { --x: url(https://attacker.invalid/a); }')


def test_rejects_javascript_scheme():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("javascript:alert(1)"); }')


def test_rejects_vbscript_scheme():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("vbscript:msgbox(1)"); }')


def test_rejects_mailto_scheme():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("mailto:x@x.com"); }')


def test_rejects_custom_scheme():
    assert "external_url" in codes('[data-pd-btn] { background-image: url("myapp://exfiltrate"); }')


def test_rejects_bad_url_tokens():
    assert "bad_css" in codes('[data-pd-btn] { background-image: url(var(--x)); }')


def test_accepts_unquoted_relative_url():
    out = filter_css('[data-pd-btn] { background-image: url(images/tile.png); }', "css/web.css").css
    assert "images/tile.png" in out


def test_rejects_cross_fade_with_external_url():
    # Generic function recursion test: cross-fade can contain urls
    assert "external_url" in codes('[data-pd-btn] { background-image: cross-fade(url(https://attacker.invalid/a) 50%, url(good.png) 50%); }')


def test_rejects_webkit_image_set_with_external_url():
    # Vendor-prefixed function should still be recursively checked
    assert "external_url" in codes('[data-pd-btn] { background-image: -webkit-image-set(url(https://attacker.invalid/a.png) 1x); }')


def test_rejects_nested_image_set_with_external_url():
    # Nested same-function: image-set(image-set(url(...)))
    assert "external_url" in codes('[data-pd-btn] { background-image: image-set(image-set(url(https://attacker.invalid/a) 1x) 1x); }')


def test_rejects_url_buried_three_functions_deep():
    # Generic unknown function at arbitrary depth
    assert "external_url" in codes('[data-pd-btn] { background-image: foo(bar(baz(url(https://attacker.invalid/a)))); }')


def test_accepts_url_buried_three_functions_deep_with_relative_path():
    # Same structure but with relative path should be accepted
    out = filter_css('[data-pd-btn] { background-image: foo(bar(baz(url(images/a.png)))); }', "css/web.css").css
    assert "images/a.png" in out


def test_rejects_mixed_relative_and_external_urls_in_functions():
    # One relative (accepted), one external (rejected) in different nested functions
    assert "external_url" in codes('[data-pd-btn] { background-image: foo(url(good.png), bar(url(https://attacker.invalid/a))); }')


def test_accepts_calc_without_url():
    # Functions without URLs should pass through unchanged
    out = filter_css('[data-pd-btn] { width: calc(100% - 10px); }', "css/web.css").css
    assert "calc" in out and "100%" in out


def test_accepts_linear_gradient_without_url():
    # Complex function without URLs should pass through
    out = filter_css('[data-pd-btn] { background: linear-gradient(to right, red, blue); }', "css/web.css").css
    assert "linear-gradient" in out and "red" in out


# --- C1: the token channel is an allowlist, not an open door ----------------


def test_accepts_a_token_the_app_actually_reads():
    # The whole point of a theme. --text-1: transparent is a terrible theme and
    # still a legitimate one; the format does not police taste.
    out = filter_css(":root { --text-1: transparent; }", "css/tokens.css").css
    assert "--text-1" in out


def test_rejects_a_token_the_app_does_not_read():
    with pytest.raises(ThemeRejected) as e:
        filter_css(":root { --not-a-real-token: red; }", "css/tokens.css")
    issue = next(i for i in e.value.issues if i.code == "token_not_settable")
    # Unknown and reserved are different author mistakes and must read
    # differently: one is a typo, the other is a refusal.
    assert "not a token this app reads" in issue.message


def test_rejects_a_reserved_token_and_says_it_is_reserved():
    with pytest.raises(ThemeRejected) as e:
        filter_css(":root { --pd-sys-text: red; }", "css/tokens.css")
    issue = next(i for i in e.value.issues if i.code == "token_not_settable")
    assert "reserved" in issue.message


def test_a_theme_cannot_blank_the_confirm_dialog_through_reserved_tokens():
    """The archive that motivated the token allowlist, one rule at a time.

    Every token the confirm dialog now reads must be refused. Before this, all
    of them were accepted on :root and the dialog rendered transparent on
    transparent without a single selector naming it.
    """
    for token in (
        "--pd-sys-text-1", "--pd-sys-text-2", "--pd-sys-accent",
        "--pd-sys-danger", "--pd-sys-border", "--pd-sys-surface-bg",
        "--pd-sys-surface-border", "--pd-sys-surface-shadow", "--pd-sys-overlay",
    ):
        with pytest.raises(ThemeRejected) as e:
            filter_css(f":root {{ {token}: transparent; }}", "css/tokens.css")
        assert any(i.code == "token_not_settable" for i in e.value.issues), token


def test_a_reserved_token_is_refused_outside_a_token_block_too():
    assert "token_outside_root" in codes("[data-pd-btn] { --pd-sys-accent: red; }")


# --- I8: selectors are parsed, not string-compared --------------------------


def test_accepts_an_ordinary_selector_group():
    out = filter_css("[data-pd-btn],[data-pd-input]{ color: red; }", "css/web.css").css
    assert "data-pd-btn" in out and "data-pd-input" in out


def test_accepts_a_state_pseudo_class_on_a_published_selector():
    for state in (":hover", ":focus-visible", ":active", ":disabled"):
        out = filter_css(f"[data-pd-btn]{state}{{ opacity: 0.5; }}", "css/web.css").css
        assert state in out


def test_accepts_the_light_token_block_however_it_is_spelled():
    for spelling in (
        ":root[data-theme=light]",
        ":root[data-theme='light']",
        ':root[data-theme="light"]',
        ":root[data-theme = 'light']",
    ):
        out = filter_css(f"{spelling}{{ --accent: #0d8b7d; }}", "css/tokens.css").css
        assert "--accent" in out, spelling


def test_rejects_a_state_that_is_not_a_state():
    # A plain pseudo-class the grammar can read, but not one of the four.
    assert "state_not_allowed" in codes("[data-pd-btn]:visited { color: red; }")
    assert "state_not_allowed" in codes("[data-pd-btn]:root { color: red; }")


def test_rejects_a_functional_pseudo_class_outright():
    # :nth-child(2) selects by position rather than by published hook, so it
    # falls outside the grammar entirely rather than being a disallowed state.
    assert "selector_not_published" in codes("[data-pd-btn]:nth-child(2) { color: red; }")
    assert "selector_not_published" in codes("[data-pd-btn]:not([disabled]) { color: red; }")


def test_rejects_a_state_on_a_token_block():
    assert "state_not_allowed" in codes(":root:hover { --accent: red; }")


def test_rejects_a_descendant_selector_under_a_published_hook():
    # A theme may style the button, not everything inside every button.
    assert "selector_not_published" in codes("[data-pd-btn] span { color: red; }")


def test_rejects_a_group_where_only_one_member_is_published():
    assert "selector_not_published" in codes("[data-pd-btn],.sidebar { color: red; }")


def test_rejects_an_attribute_value_prefix_match():
    # The exfiltration selector: input[value^='a'] leaks typed characters one
    # request at a time. Only = is a match operator this grammar describes.
    assert "selector_not_published" in codes("[data-pd-input^='a'] { color: red; }")


def test_rejects_a_group_mixing_a_token_block_with_a_component():
    assert "selector_group_mixed" in codes(":root,[data-pd-btn] { --accent: red; }")


def test_rejects_a_pseudo_element():
    assert "selector_not_published" in codes("[data-pd-btn]::before { content: 'x'; }")


# --- I4: @font-face is a declaration block ----------------------------------


def test_accepts_a_font_face_referencing_a_shipped_font():
    result = filter_css(
        "@font-face{ font-family:'Inter'; src:url(../fonts/inter.woff2) format('woff2');"
        " font-weight:400; font-style:normal; font-display:swap; }",
        "css/web.css",
    )
    assert "font-family" in result.css
    assert result.urls == frozenset({"fonts/inter.woff2"})


def test_rejects_a_font_face_loading_from_another_host():
    assert "external_url" in codes(
        "@font-face{ font-family:'X'; src:url(https://attacker.invalid/x.woff2); }"
    )


def test_rejects_a_property_that_does_not_belong_in_font_face():
    assert "property_not_allowed" in codes(
        "@font-face{ font-family:'X'; behavior:url(x.htc); }"
    )


def test_rejects_an_at_rule_that_is_not_media_supports_or_font_face():
    issues_codes = codes("@keyframes spin { from { opacity: 0; } }")
    assert "at_rule_not_allowed" in issues_codes


def test_rejects_an_unknown_at_rule_by_name():
    with pytest.raises(ThemeRejected) as e:
        filter_css("@page { margin: 0; }", "css/web.css")
    issue = next(i for i in e.value.issues if i.code == "at_rule_not_allowed")
    assert "@page" in issue.message


# --- I2: url() must resolve inside the archive ------------------------------


def test_rejects_a_traversing_url():
    for hostile in (
        "url(../../../../etc/passwd)",
        'url("../../other-account/theme/css/tokens.css")',
        "url(../../../x.png)",
    ):
        assert "external_url" in codes(f"[data-pd-btn]{{ background-image: {hostile} }}"), hostile


def test_rejects_a_traversing_url_in_a_token_value():
    assert "external_url" in codes(":root{ --page-image: url(../../../x.png) }")


def test_rejects_percent_encoded_traversal():
    # The browser decodes this before fetching, so the check has to refuse the
    # encoded form too. It does, because % is not a legal entry-name character.
    assert "external_url" in codes("[data-pd-btn]{ background-image: url(%2e%2e/%2e%2e/x.png) }")


def test_a_url_resolves_relative_to_the_stylesheet_that_holds_it():
    # Exactly what the browser will do once the theme is served from
    # /themes/<account>/<theme>/css/, so what validates is what renders.
    result = filter_css("[data-pd-btn]{ background-image: url(tile.png) }", "css/web.css")
    assert result.urls == frozenset({"css/tile.png"})

    result = filter_css("[data-pd-btn]{ background-image: url(../images/tile.png) }", "css/web.css")
    assert result.urls == frozenset({"images/tile.png"})


def test_the_accepted_urls_are_reported_to_the_caller():
    result = filter_css(
        "[data-pd-btn]{ background-image: url(../images/a.png) }\n"
        "[data-pd-input]{ background-image: image-set(url(../images/b.png) 1x) }\n",
        "css/web.css",
    )
    assert result.urls == frozenset({"images/a.png", "images/b.png"})


def test_a_url_with_a_query_or_fragment_is_refused():
    # Neither names a file in the archive, and both would be served as-is.
    assert "external_url" in codes("[data-pd-btn]{ background-image: url(../images/a.png?v=2) }")
    assert "external_url" in codes("[data-pd-btn]{ background-image: url(../images/a.png#x) }")


def test_whitespace_inside_a_quoted_url_is_not_mistaken_for_a_path():
    result = filter_css('[data-pd-btn]{ background-image: url( "../images/a.png" ) }', "css/web.css")
    assert result.urls == frozenset({"images/a.png"})


# --- I6: issue collection is bounded ----------------------------------------


def test_issue_collection_stops_at_the_cap_and_says_so(monkeypatch):
    from themes import limits
    monkeypatch.setattr(limits, "MAX_ISSUES", 5)

    source = "\n".join(f".sel{i} {{ color: red; }}" for i in range(500))
    with pytest.raises(ThemeRejected) as e:
        filter_css(source, "css/web.css")

    assert len(e.value.issues) == 6  # the cap, plus the note that it was hit
    assert e.value.issues[-1].code == "issues_truncated"
    assert "more problems were found" in e.value.issues[-1].message
