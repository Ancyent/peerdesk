import pytest

from themes.errors import ThemeRejected
from themes.svgsanitize import sanitize_svg

NS = 'xmlns="http://www.w3.org/2000/svg"'
FILE = "images/logo.svg"


# Original tests: basic SVG preservation
def test_keeps_ordinary_drawing_elements():
    out = sanitize_svg(f'<svg {NS}><path d="M0 0 L8 8"/></svg>'.encode(), FILE)
    assert b"path" in out
    assert b"M0 0 L8 8" in out


def test_strips_metadata_elements_silently():
    """Metadata and editor-namespace elements are silently removed, not rejected."""
    out = sanitize_svg(
        f'<svg {NS}><metadata>Copyright 2026</metadata><path d="M0 0"/></svg>'.encode(),
        FILE
    )
    assert b"metadata" not in out.lower()
    assert b"Copyright" not in out
    assert b"path" in out


def test_strips_inkscape_namespaced_elements_silently():
    """Real Inkscape output with metadata and sodipodi namespace is accepted and cleaned."""
    svg_data = (
        f'<svg {NS} xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" '
        f'sodipodi:docname="test.svg"><sodipodi:namedview/>'
        f'<metadata><rdf:RDF/></metadata><path d="M0 0" sodipodi:type="straight"/></svg>'
    ).encode()
    # Note: this SVG has unbound namespace prefix in the serialized form, which causes
    # a parse error. In real Inkscape output, the namespace is properly declared.
    # Test with properly serialized version that defusedxml can parse.
    svg_data_fixed = (
        f'<svg {NS} xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" '
        f'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" '
        f'sodipodi:docname="test.svg"><sodipodi:namedview/>'
        f'<metadata><rdf:RDF/></metadata><path d="M0 0" sodipodi:type="straight"/></svg>'
    ).encode()
    out = sanitize_svg(svg_data_fixed, FILE)
    # Inkscape elements removed, but path kept
    assert b"sodipodi" not in out.lower()
    assert b"metadata" not in out.lower()
    assert b"path" in out
    assert b"M0 0" in out


def test_rejects_script_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><script>fetch("//x")</script><path d="M0 0"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_event_handler_attributes():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><path d="M0 0" onload="alert(1)" onclick="x()"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_event_handler" for i in e.value.issues)


def test_rejects_foreignobject_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><foreignObject><body/></foreignObject></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_use_tag_with_external_reference():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><use href="https://attacker.invalid/x#y"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_anchor_tag_with_javascript_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_animation_element_retargeting_href():
    """Animation elements can retarget attributes, including href."""
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><animate attributeName="href" values="#a;#b"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_document_that_is_not_svg():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(b"<html><body/></html>", FILE)
    assert any(i.code == "not_svg" for i in e.value.issues)


def test_rejects_malformed_xml():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(b"<svg><unclosed>", FILE)
    assert any(i.code == "bad_svg" for i in e.value.issues)


def test_rejects_entity_expansion_bomb():
    # defusedxml refuses these; this pins that we rely on it.
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "AAAAAAAAAA">'
        b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
        b'<svg xmlns="http://www.w3.org/2000/svg"><title>&b;</title></svg>'
    )
    with pytest.raises(ThemeRejected):
        sanitize_svg(bomb, FILE)


def test_rejects_external_entity_reference():
    xxe = (
        b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        b'<svg xmlns="http://www.w3.org/2000/svg"><title>&x;</title></svg>'
    )
    with pytest.raises(ThemeRejected):
        sanitize_svg(xxe, FILE)


# Tests for attribute-level URL reference filtering
def test_rejects_fill_attribute_with_external_url_reference():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="url(https://attacker.invalid/x)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_stroke_attribute_with_external_url_reference():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" stroke="url(https://attacker.invalid/x)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_keeps_fill_attribute_with_local_fragment_reference():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="grad"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="url(#grad)"/></svg>'.encode(),
        FILE
    )
    assert b"url(#grad)" in out
    assert b"grad" in out


def test_keeps_fill_attribute_with_whitespace_and_quotes_around_fragment():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="grad"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="url( \'#grad\' )"/></svg>'.encode(),
        FILE
    )
    assert b"grad" in out


def test_rejects_fill_attribute_with_protocol_relative_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="url(//attacker.invalid/x)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_data_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="url(data:image/png;base64,iVBORw0KGgo=)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


# Tests for case sensitivity and multiple references
def test_rejects_fill_attribute_with_uppercase_url_function():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="URL(https://attacker.invalid/x)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_mixed_case_url_function():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="Url(https://attacker.invalid/x)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_safe_url_followed_by_unsafe_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><defs><linearGradient id="a"><stop/></linearGradient></defs>'
            f'<path d="M0 0" fill="url(#a) url(https://attacker.invalid/b)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_unsafe_url_followed_by_safe_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><defs><linearGradient id="b"><stop/></linearGradient></defs>'
            f'<path d="M0 0" fill="url(https://attacker.invalid/a) url(#b)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_url_function_and_space_before_paren():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="url (https://attacker.invalid/x)"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_keeps_fill_attribute_with_uppercase_url_function_and_local_reference():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="grad"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="URL(#grad)"/></svg>'.encode(),
        FILE
    )
    assert b"URL(#grad)" in out or b"url(#grad)" in out


def test_keeps_fill_attribute_with_multiple_local_url_references():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="a"><stop/></linearGradient>'
        f'<linearGradient id="b"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="url(#a) url(#b)"/></svg>'.encode(),
        FILE
    )
    assert b"url(#a)" in out or (b"url" in out and b"#a" in out)
    assert b"url(#b)" in out or (b"url" in out and b"#b" in out)


# Tests for unterminated url() tokens (Critical fix round 3)
def test_rejects_fill_attribute_with_unterminated_url_offline_reference():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="url(https://attacker.invalid/x"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_unterminated_url_uppercase_offline_reference():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="URL(https://attacker.invalid/x"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_unterminated_url_local_reference():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><defs><linearGradient id="grad"><stop/></linearGradient></defs>'
            f'<path d="M0 0" fill="url(#grad"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_empty_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" fill="url()"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_fill_attribute_with_safe_url_followed_by_unterminated_hostile_url():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><defs><linearGradient id="a"><stop/></linearGradient></defs>'
            f'<path d="M0 0" fill="url(#a) url(https://attacker.invalid/b"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


# Tests for href attribute rejection
def test_rejects_href_attribute_on_allowed_tag():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS}><path d="M0 0" href="https://attacker.invalid/x"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_rejects_xlink_href_attribute():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(
            f'<svg {NS} xmlns:xlink="http://www.w3.org/1999/xlink"><path d="M0 0" xlink:href="https://attacker.invalid/x"/></svg>'.encode(),
            FILE
        )
    assert any(i.code == "svg_external_reference" for i in e.value.issues)
    # Verify message mentions xlink:href, not just href
    assert any("xlink:href" in i.message for i in e.value.issues)


# Tests for case-sensitivity bypass fixes (Critical fix round 5)
def test_rejects_uppercase_script_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><SCRIPT>attack()</SCRIPT></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_mixed_case_script_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><Script>attack()</Script></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_uppercase_foreignobject_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><FOREIGNOBJECT/></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_mixed_case_use_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><Use href="https://attacker.invalid/x"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_uppercase_a_element():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><A href="javascript:alert(1)"><path d="M0 0"/></A></svg>'.encode(), FILE)
    assert any(i.code == "svg_script" for i in e.value.issues)


def test_rejects_uppercase_onload_event_handler():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><path d="M0 0" ONLOAD="alert(1)"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_event_handler" for i in e.value.issues)


def test_rejects_mixed_case_onclick_event_handler():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><path d="M0 0" OnClick="alert(1)"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_event_handler" for i in e.value.issues)


def test_rejects_mixed_case_onload_event_handler():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><path d="M0 0" onLOAD="alert(1)"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_event_handler" for i in e.value.issues)


def test_rejects_uppercase_href_attribute():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><path d="M0 0" HREF="https://attacker.invalid/x"/></svg>'.encode(), FILE)
    assert any(i.code == "svg_external_reference" for i in e.value.issues)


def test_case_insensitive_rejection_preserves_original_spelling():
    """Verify that error messages preserve the original spelling of dangerous elements/attributes."""
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><SCRIPT>attack()</SCRIPT></svg>'.encode(), FILE)
    # The message should mention SCRIPT (as written) not script (normalized)
    message = next(i.message for i in e.value.issues if i.code == "svg_script")
    assert "SCRIPT" in message


def test_case_insensitive_event_handler_preserves_original_spelling():
    """Verify that error messages preserve the original spelling of event handlers."""
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(f'<svg {NS}><path d="M0 0" ONLOAD="alert(1)"/></svg>'.encode(), FILE)
    message = next(i.message for i in e.value.issues if i.code == "svg_event_handler")
    assert "ONLOAD" in message


# --- M1: the root check is namespace-aware ----------------------------------


def test_rejects_an_svg_root_in_another_namespace():
    """<svg xmlns="http://evil.invalid/ns"> is not an SVG.

    A local-name-only check accepted it, and its sanitized output no longer
    probed as SVG by this validator's own probe() — a file admitted as one kind
    and written as another.
    """
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(b'<svg xmlns="http://evil.invalid/ns"><path d="M0 0"/></svg>', FILE)
    assert any(i.code == "not_svg" for i in e.value.issues)


def test_rejects_an_svg_root_with_no_namespace_at_all():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(b'<svg><path d="M0 0"/></svg>', FILE)
    assert any(i.code == "not_svg" for i in e.value.issues)


def test_the_sanitized_output_still_probes_as_an_svg():
    """What comes out must be the kind of file that went in.

    This is the property the namespace check exists to preserve, asserted
    against the validator's own probe rather than against the sanitizer.
    """
    from themes.imageprobe import probe
    out = sanitize_svg(f'<svg {NS}><path d="M0 0"/></svg>'.encode(), FILE)
    assert probe(out) is not None
    assert probe(out).kind == "svg"
