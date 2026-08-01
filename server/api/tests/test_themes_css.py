import pytest

from themes.cssfilter import filter_css
from themes.errors import ThemeRejected


def codes(source: str) -> set[str]:
    with pytest.raises(ThemeRejected) as e:
        filter_css(source, "css/web.css")
    return {i.code for i in e.value.issues}


def test_accepts_custom_properties_on_root():
    out = filter_css(":root { --accent: #22c5b0; --radius: 12px; }", "css/tokens.css")
    assert "--accent" in out
    assert "#22c5b0" in out


def test_accepts_the_light_theme_block():
    out = filter_css(":root[data-theme='light'] { --accent: #0d8b7d; }", "css/tokens.css")
    assert "--accent" in out


def test_accepts_a_published_selector_with_allowed_properties():
    out = filter_css("[data-pd-btn] { border-radius: 2px; text-transform: uppercase; }", "css/web.css")
    assert "border-radius" in out


def test_accepts_layout_properties_on_a_published_selector():
    # Deliberately generous: a bigger, squarer button is a legitimate request.
    out = filter_css("[data-pd-btn] { width: 200px; height: 48px; margin: 4px; display: flex; }", "css/web.css")
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
    out = filter_css('[data-pd-btn] { background-image: url("images/tile.png"); }', "css/web.css")
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
    out = filter_css("@media (min-width: 600px) { [data-pd-btn] { width: 100px; } }", "css/web.css")
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
    out = filter_css('[data-pd-btn] { background-image: url(images/tile.png); }', "css/web.css")
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
    out = filter_css('[data-pd-btn] { background-image: foo(bar(baz(url(images/a.png)))); }', "css/web.css")
    assert "images/a.png" in out


def test_rejects_mixed_relative_and_external_urls_in_functions():
    # One relative (accepted), one external (rejected) in different nested functions
    assert "external_url" in codes('[data-pd-btn] { background-image: foo(url(good.png), bar(url(https://attacker.invalid/a))); }')


def test_accepts_calc_without_url():
    # Functions without URLs should pass through unchanged
    out = filter_css('[data-pd-btn] { width: calc(100% - 10px); }', "css/web.css")
    assert "calc" in out and "100%" in out


def test_accepts_linear_gradient_without_url():
    # Complex function without URLs should pass through
    out = filter_css('[data-pd-btn] { background: linear-gradient(to right, red, blue); }', "css/web.css")
    assert "linear-gradient" in out and "red" in out
