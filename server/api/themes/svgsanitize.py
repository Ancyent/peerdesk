"""SVG is XML, and XML that a stranger wrote.

Two separate problems. The parser itself must not be talked into fetching a
local file or expanding an entity bomb, which is why defusedxml replaces the
standard parser. Then the document must not carry script, event handlers, or
references off-origin, which is what the allowlists below are for.

An allowlist, not a blocklist: the set of SVG features is large and grows, and a
blocklist is a promise to have thought of everything.
"""
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


def _clean(element: ET.Element) -> None:
    for name in list(element.attrib):
        if _local(name) not in ALLOWED_ATTRS:
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
