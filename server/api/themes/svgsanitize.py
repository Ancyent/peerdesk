"""SVG is XML, and XML that a stranger wrote.

Three separate problems:
1. The parser itself must not be talked into fetching a local file or expanding
   an entity bomb. defusedxml replaces the standard parser.
2. Dangerous elements and attributes (script, event handlers, external references)
   must be rejected, not silently stripped, so the admin learns about the attack.
3. Harmless unknown elements and attributes (metadata, editor namespaces) are
   silently stripped to allow real SVGs from Inkscape, Illustrator, Figma etc.
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

            # Elements that are dangerous and must cause rejection (stored lowercase for case-insensitive matching)
DANGEROUS_TAGS = frozenset({
    "script", "foreignobject", "iframe", "embed", "object", "handler",
    "animate", "animatetransform", "animatemotion", "set",
    "a", "use",
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


def _check_dangerous(element: ET.Element, filename: str) -> list[ThemeIssue]:
    """Check for dangerous elements and attributes.

    Returns a list of ThemeIssue objects for each danger found. If the list is
    non-empty, the caller should raise ThemeRejected(issues).

    Dangerous items include:
    - Elements: script, foreignObject, iframe, embed, object, handler,
                animate, animateTransform, animateMotion, set, a, use
    - Attributes: on* (event handlers), href, xlink:href
    - Attribute values: off-origin url() references
    """
    issues: list[ThemeIssue] = []

    def check_element(el: ET.Element) -> None:
        tag_name = _local(el.tag)

        # Check if element itself is dangerous (case-insensitive)
        if tag_name.lower() in DANGEROUS_TAGS:
            issues.append(ThemeIssue(
                file=filename, code="svg_script",
                message=f"element <{tag_name}> is not allowed in themes",
            ))
            return  # Don't check children of dangerous elements

        # Check attributes for dangerous names and values
        for attr_name, attr_value in el.attrib.items():
            local_name = _local(attr_name)

            # Check for event handlers (on*) case-insensitively
            if local_name.lower().startswith("on"):
                issues.append(ThemeIssue(
                    file=filename, code="svg_event_handler",
                    message=f"attribute {local_name} is an event handler and not allowed",
                ))
                continue

            # Check for href/xlink:href (both local name and prefixed forms) case-insensitively
            if local_name.lower() in ("href", "xlink:href") or attr_name.lower().endswith("}href"):
                # Construct display name for the message, preserving original spelling
                if attr_name.lower().endswith("}href"):
                    # Namespaced href (likely xlink:href)
                    display_name = "xlink:href" if "xlink" in attr_name.lower() else attr_name
                else:
                    display_name = attr_name if ":" in attr_name else local_name
                issues.append(ThemeIssue(
                    file=filename, code="svg_external_reference",
                    message=f"attribute {display_name} references external content and is not allowed",
                ))
                continue

            # Check for off-origin url() in allowed attributes
            if local_name in ALLOWED_ATTRS and not _is_safe_url_value(attr_value):
                issues.append(ThemeIssue(
                    file=filename, code="svg_external_reference",
                    message=f"attribute {local_name} contains an off-origin url() reference and is not allowed",
                ))
                continue

        # Recursively check children
        for child in el:
            check_element(child)

    check_element(element)
    return issues


def _clean(element: ET.Element) -> None:
    """Silently remove non-allowed elements and attributes.

    This runs only after _check_dangerous has verified there are no dangerous items.
    Non-allowed but harmless items (metadata, editor namespaces, unknown attributes)
    are removed without reporting.
    """
    for name in list(element.attrib):
        if _local(name) not in ALLOWED_ATTRS:
            del element.attrib[name]

    for child in list(element):
        if _local(child.tag) not in ALLOWED_TAGS:
            element.remove(child)
        else:
            _clean(child)


def sanitize_svg(data: bytes, filename: str) -> bytes:
    """Sanitize SVG by rejecting dangerous elements/attributes and removing harmless unknowns.

    Raises ThemeRejected if the SVG contains:
    - Script or interactive elements (script, foreignObject, iframe, embed, etc.)
    - Animation elements that can retarget attributes (animate, animateTransform, etc.)
    - Reference elements (a, use)
    - Event handler attributes (on*)
    - href/xlink:href attributes
    - Off-origin url() references in attribute values

    All other non-allowed elements and attributes are silently stripped.

    Returns the re-serialised SVG as bytes.
    """
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

    # Check for dangerous elements and attributes
    issues = _check_dangerous(root, filename)
    if issues:
        raise ThemeRejected(issues)

    # Safe to proceed: silently strip non-allowed elements and attributes
    _clean(root)
    ET.register_namespace("", SVG_NS)
    return ET.tostring(root, encoding="utf-8")
