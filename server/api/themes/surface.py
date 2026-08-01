"""The public contract a theme is written against.

SURFACE_VERSION is bumped whenever a published selector is added, renamed or
removed. It is separate from SCHEMA_VERSION because the manifest format and the
selector contract evolve independently.

The security boundary of this whole system is PUBLISHED_SELECTORS, not
ALLOWED_PROPERTIES. An element with no published hook cannot be selected at all,
so it cannot be restyled whatever the property rules say. The property list is a
guardrail against carelessness; it cannot prevent a determined theme from making
a published component unreadable, because colour and typography are exactly what
a theme must be able to change.
"""
import re

from . import limits

SCHEMA_VERSION = 1
SURFACE_VERSION = 1

# Built from the cap rather than repeating it, so limits.py stays the one place
# a number lives.
THEME_ID_RE = re.compile(r"[a-z0-9-]{1,%d}" % limits.MAX_THEME_ID_LENGTH)

# Where a theme may declare custom properties.
TOKEN_SELECTORS = frozenset({
    ":root",
    ":root[data-theme='light']",
})

# Components deliberately exposed for restyling. Security-critical UI is absent
# and must stay absent — see CRITICAL_COMPONENT_FILES in shared/ui/themeSurface.ts.
PUBLISHED_SELECTORS = frozenset({
    "[data-pd-btn]",
    "[data-pd-input]",
    "[data-pd-machine]",
})

# Generous on purpose, including layout: a squarer, larger button is a
# legitimate request. `display: none` is included, which means a theme can hide
# a published component. That is accepted — a hidden Connect button is a broken
# theme, not a compromised one, and it reverts in one click.
ALLOWED_PROPERTIES = frozenset({
    "color", "background", "background-color", "background-image",
    "background-position", "background-size", "background-repeat",
    "border", "border-color", "border-style", "border-width", "border-radius",
    "border-top", "border-right", "border-bottom", "border-left",
    "box-shadow", "text-shadow", "opacity", "filter",
    "font", "font-family", "font-size", "font-weight", "font-style",
    "letter-spacing", "line-height", "text-align", "text-transform",
    "text-decoration", "white-space",
    "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
    "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
    "width", "min-width", "max-width", "height", "min-height", "max-height",
    "display", "flex", "flex-direction", "align-items", "justify-content", "gap",
    "transition", "transition-duration", "transition-timing-function",
    "cursor", "outline", "outline-offset", "overflow",
})

# Refused because a theme has no legitimate use for them and a clear abuse:
# escaping the component box, or covering the session-approval prompt.
#
# z-index is refused at every value rather than capped. A cap would have to be
# explained to authors as "you may stack, but only this high", and a theme that
# needs to stack above its own component is reaching for something it was not
# given.
REFUSED_PROPERTIES = frozenset({
    "position", "top", "right", "bottom", "left", "inset",
    "z-index", "visibility", "pointer-events",
})
