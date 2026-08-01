"""The public contract a theme is written against.

SURFACE_VERSION is bumped whenever a published selector is added, renamed or
removed. It is separate from SCHEMA_VERSION because the manifest format and the
selector contract evolve independently.

The security boundary of this whole system is two allowlists working together,
and neither is sufficient alone:

* PUBLISHED_SELECTORS decides what a theme may *select*. An element with no
  published hook cannot be named by a rule.
* SETTABLE_TOKENS decides what a theme may *declare*. Selection is not the only
  way to reach an element: the app is token-driven, so a custom property set on
  :root reaches every element that reads it, including every element with no
  published hook. A theme allowed to declare arbitrary custom properties could
  blank the confirm dialog without ever selecting it.

Security-critical UI therefore renders through tokens carrying
RESERVED_TOKEN_PREFIX, which no theme may declare at all. Those tokens still
follow light and dark — they are declared in both blocks of
web/src/branding.css and desktop/src/styles.css — they simply stop following
the *theme*.

ALLOWED_PROPERTIES is a guardrail against carelessness rather than a boundary.
It cannot prevent a determined theme from making a published component
unreadable, because colour and typography are exactly what a theme must be able
to change.
"""
import re
from pathlib import Path

import tinycss2

from . import limits
from .builtin import BUILTIN_DIR

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

# A published selector may carry one of these and nothing else. They are the
# states a control genuinely has, and a theme system without :hover will not
# survive contact with a real author. Structural and relational pseudo-classes
# are absent on purpose: :not(), :has() and :nth-child() would let a theme
# select by page position rather than by published hook, which is the boundary
# above written backwards.
STATE_PSEUDO_CLASSES = frozenset({
    "hover", "focus-visible", "active", "disabled",
})

# @font-face is a declaration block, not a rule list, and takes its own
# property set. src is checked with the same internal-url() rule as every other
# value, so a theme can only load a font it shipped.
FONT_FACE_PROPERTIES = frozenset({
    "font-family", "src", "font-weight", "font-style", "font-display",
    "unicode-range",
})

# Block at-rules whose body is a rule list, so the selectors inside can be
# checked by recursion. Anything else carrying a block is rejected by name
# rather than recursed into: the parse rule for a declaration block and for a
# rule list are not the same, and guessing wrong turns a valid stylesheet into
# a syntax error, which is exactly what @font-face used to hit.
BLOCK_AT_RULES = frozenset({"media", "supports"})

# Tokens the app reads but a theme may never set. Security-critical dialogs
# render through these, so an accepted theme cannot reach them by inheritance.
RESERVED_TOKEN_PREFIX = "--pd-sys-"


def _declared_custom_properties(path: Path) -> frozenset[str]:
    """Every custom property name declared anywhere in a stylesheet.

    Custom property names are case-sensitive in CSS, so they are collected as
    written rather than lowercased.
    """
    source = path.read_text(encoding="utf-8")
    names: set[str] = set()
    for rule in tinycss2.parse_stylesheet(source, skip_comments=True, skip_whitespace=True):
        if rule.type != "qualified-rule":
            continue
        for declaration in tinycss2.parse_blocks_contents(rule.content):
            if declaration.type == "declaration" and declaration.name.startswith("--"):
                names.add(declaration.name)
    return frozenset(names)


# The tokens a theme may declare, derived from the built-in theme rather than
# hand-listed. The built-in theme is a copy of the app's own token set, kept
# honest by test_themes_builtin.py, so this allowlist cannot drift from what
# the app actually reads: adding a token to branding.css and to the built-in
# theme is what makes it settable, and there is no second copy to forget.
SETTABLE_TOKENS = _declared_custom_properties(BUILTIN_DIR / "css" / "tokens.css")

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
