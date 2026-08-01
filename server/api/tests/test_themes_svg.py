import pytest

from themes.errors import ThemeRejected
from themes.svgsanitize import sanitize_svg

NS = 'xmlns="http://www.w3.org/2000/svg"'
FILE = "images/logo.svg"


def test_keeps_ordinary_drawing_elements():
    out = sanitize_svg(f'<svg {NS}><path d="M0 0 L8 8"/></svg>'.encode(), FILE)
    assert b"path" in out
    assert b"M0 0 L8 8" in out


def test_strips_a_script_element():
    out = sanitize_svg(f'<svg {NS}><script>fetch("//x")</script><path d="M0 0"/></svg>'.encode(), FILE)
    assert b"script" not in out.lower()
    assert b"path" in out


def test_strips_event_handler_attributes():
    out = sanitize_svg(f'<svg {NS}><path d="M0 0" onload="alert(1)" onclick="x()"/></svg>'.encode(), FILE)
    assert b"onload" not in out.lower()
    assert b"onclick" not in out.lower()


def test_strips_foreignobject_which_can_carry_html():
    out = sanitize_svg(f'<svg {NS}><foreignObject><body/></foreignObject></svg>'.encode(), FILE)
    assert b"foreignObject" not in out


def test_strips_use_tag_which_can_reference_external_svg():
    out = sanitize_svg(f'<svg {NS}><use href="https://attacker.invalid/x#y"/></svg>'.encode(), FILE)
    assert b"attacker.invalid" not in out


def test_strips_anchor_tag_which_can_carry_javascript_url():
    out = sanitize_svg(f'<svg {NS}><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>'.encode(), FILE)
    assert b"javascript" not in out.lower()


def test_rejects_a_document_that_is_not_svg():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(b"<html><body/></html>", FILE)
    assert any(i.code == "not_svg" for i in e.value.issues)


def test_rejects_malformed_xml():
    with pytest.raises(ThemeRejected) as e:
        sanitize_svg(b"<svg><unclosed>", FILE)
    assert any(i.code == "bad_svg" for i in e.value.issues)


def test_rejects_an_entity_expansion_bomb():
    # defusedxml refuses these; this pins that we rely on it.
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "AAAAAAAAAA">'
        b'<!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>'
        b'<svg xmlns="http://www.w3.org/2000/svg"><title>&b;</title></svg>'
    )
    with pytest.raises(ThemeRejected):
        sanitize_svg(bomb, FILE)


def test_rejects_an_external_entity_reference():
    xxe = (
        b'<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        b'<svg xmlns="http://www.w3.org/2000/svg"><title>&x;</title></svg>'
    )
    with pytest.raises(ThemeRejected):
        sanitize_svg(xxe, FILE)


# Additional tests for attribute-level URL reference filtering
def test_strips_fill_attribute_with_external_url_reference_on_allowed_tag():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" fill="url(https://attacker.invalid/x)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out
    assert b'fill=' not in out or b'fill=""' in out or b'fill' not in out.split(b'>')[0]


def test_strips_stroke_attribute_with_external_url_reference_on_allowed_tag():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" stroke="url(https://attacker.invalid/x)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


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


def test_strips_fill_attribute_with_protocol_relative_url():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" fill="url(//attacker.invalid/x)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


def test_strips_fill_attribute_with_data_url():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" fill="url(data:image/png;base64,iVBORw0KGgo=)"/></svg>'.encode(),
        FILE
    )
    assert b"data:" not in out


# Tests for bypass fixes: case sensitivity, multiple references, whitespace
def test_strips_fill_attribute_with_uppercase_url_function():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" fill="URL(https://attacker.invalid/x)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


def test_strips_fill_attribute_with_mixed_case_url_function():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" fill="Url(https://attacker.invalid/x)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


def test_strips_fill_attribute_with_safe_url_followed_by_unsafe_url():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="a"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="url(#a) url(https://attacker.invalid/b)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


def test_strips_fill_attribute_with_unsafe_url_followed_by_safe_url():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="b"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="url(https://attacker.invalid/a) url(#b)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


def test_strips_fill_attribute_with_url_function_and_space_before_paren():
    out = sanitize_svg(
        f'<svg {NS}><path d="M0 0" fill="url (https://attacker.invalid/x)"/></svg>'.encode(),
        FILE
    )
    assert b"attacker.invalid" not in out


def test_keeps_fill_attribute_with_uppercase_url_function_and_local_reference():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="grad"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="URL(#grad)"/></svg>'.encode(),
        FILE
    )
    assert b"grad" in out


def test_keeps_fill_attribute_with_multiple_local_url_references():
    out = sanitize_svg(
        f'<svg {NS}><defs><linearGradient id="a"><stop/></linearGradient>'
        f'<linearGradient id="b"><stop/></linearGradient></defs>'
        f'<path d="M0 0" fill="url(#a) url(#b)"/></svg>'.encode(),
        FILE
    )
    assert b"url(#a)" in out or (b"url" in out and b"#a" in out)
    assert b"url(#b)" in out or (b"url" in out and b"#b" in out)
