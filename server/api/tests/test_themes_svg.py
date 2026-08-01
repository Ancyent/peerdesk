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


def test_strips_use_with_an_external_reference():
    out = sanitize_svg(f'<svg {NS}><use href="https://attacker.invalid/x#y"/></svg>'.encode(), FILE)
    assert b"attacker.invalid" not in out


def test_strips_an_anchor_carrying_a_javascript_url():
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
