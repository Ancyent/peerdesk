"""SVG is XML, and XML that a stranger wrote.

Two separate problems. The parser itself must not be talked into fetching a
local file or expanding an entity bomb, which is why defusedxml replaces the
standard parser. Then the document must not carry script, event handlers, or
references off-origin, which is what the allowlists below are for.

An allowlist, not a blocklist: the set of SVG features is large and grows, and a
blocklist is a promise to have thought of everything.
"""
import re
from xml.etree import ElementTree as ET

from defusedxml.common import DefusedXmlException
from defusedxml.ElementTree import fromstring as defused_fromstring

from .errors import ThemeIssue, ThemeRejected

SVG_NS = "http://www.w3.org/2000/svg"

ALLOWED_TAGS = frozenset({
    "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
    "text", "tspan", "defs", "linearGradient", "radialGradient", "stop",
    "clipPath", "mask", "title", "desc", "symbol", "marker", "pattern",
})

ALLOWED_ATTRS = frozenset({
    "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry",
    "width", "height", "viewBox", "points", "transform", "fill", "fill-rule",
    "fill-opacity", "stroke", "stroke-width", "stroke-linecap",
    "stroke-linejoin", "stroke-dasharray", "stroke-opacity", "opacity",
    "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform",
    "font-family", "font-size", "font-weight", "text-anchor",
    "id", "class", "xmlns", "version", "preserveAspectRatio",
})


def _local(tag: str) -> str:
    return tag.split("}", 1)[1] if tag.startswith("{") else tag


def _is_safe_url_value(value: str) -> bool:
    """Check if an attribute value with url() references is safe.

    Only well-formed local fragment references like url(#identifier) are allowed.
    Off-origin references, unterminated tokens, and empty url() are rejected.

    Case-insensitive: URL(), Url(), url() are all treated the same.
    Multiple references: ALL must be well-formed local fragments for the value to be safe.

    Per CSS Syntax Module Level 3, unterminated url() tokens are parse errors but may
    still be emitted by the tokenizer. This function rejects them to ensure renderers
    cannot fetch off-origin references through incomplete tokens.
    """
    # First, find ALL url( tokens, including incomplete ones.
    # Pattern: url followed by optional whitespace and opening paren
    url_token_pattern = r'url\s*\('
    url_tokens = list(re.finditer(url_token_pattern, value, re.IGNORECASE))

    if not url_tokens:
        # No url() token, it's safe
        return True

    # Check each url( token for validity and safety
    for token_match in url_tokens:
        # Find the position of the opening paren
        paren_pos = token_match.end() - 1
        search_start = paren_pos + 1

        # Find the closing paren for this token
        close_paren = value.find(')', search_start)

        if close_paren == -1:
            # No closing paren found - unterminated token, unsafe
            return False

        # Extract the content between parens
        content = value[search_start:close_paren]

        # Remove leading/trailing whitespace and quotes
        reference = content.strip()
        reference = reference.strip('"\'')
        reference = reference.strip()

        # Check for empty url()
        if not reference:
            return False

        # Only allow local fragment references starting with #
        if not reference.startswith('#'):
            return False

    # All url tokens are well-formed and point to local fragments
    return True


def _clean(element: ET.Element) -> None:
    for name in list(element.attrib):
        if _local(name) not in ALLOWED_ATTRS:
            del element.attrib[name]
        else:
            # Check attribute value for unsafe url() references (case-insensitive)
            value = element.attrib[name]
            if not _is_safe_url_value(value):
                del element.attrib[name]

    for child in list(element):
        if _local(child.tag) not in ALLOWED_TAGS:
            element.remove(child)
        else:
            _clean(child)


def sanitize_svg(data: bytes, filename: str) -> bytes:
    try:
        root = defused_fromstring(data)
    except DefusedXmlException as exc:
        raise ThemeRejected([ThemeIssue(
            file=filename, code="unsafe_svg",
            message=f"refused by the XML parser: {type(exc).__name__}",
        )]) from None
    except ET.ParseError as exc:
        raise ThemeRejected([ThemeIssue(
            file=filename, code="bad_svg", message=f"not well-formed XML: {exc}",
        )]) from None

    if _local(root.tag) != "svg":
        raise ThemeRejected([ThemeIssue(
            file=filename, code="not_svg", message="root element must be <svg>",
        )])

    _clean(root)
    ET.register_namespace("", SVG_NS)
    return ET.tostring(root, encoding="utf-8")
