"""Parse a theme stylesheet and keep only what the surface contract allows.

tinycss2 rather than a regular expression, because CSS has comments, strings,
escapes and nesting, and a pattern that looks right will be wrong on the input
that matters.

Note what this can and cannot do. It stops a theme reaching elements it was not
given, and stops it talking to another host. It does not — and cannot — stop a
theme making a component it *was* given unreadable, because colour and
typography are the point of a theme. The boundary is the selector list.
"""
import tinycss2

from . import surface
from .errors import ThemeIssue, ThemeRejected


def _normalise(selector: str) -> str:
    return " ".join(selector.split()).replace('"', "'")


def _is_internal_url(value: str) -> bool:
    lowered = value.strip().lower()
    if lowered.startswith(("http://", "https://", "//", "data:", "file:", "blob:")):
        return False
    return not lowered.startswith("/")


def _check_declarations(
    content: list, selector: str, filename: str, issues: list[ThemeIssue]
) -> None:
    is_token_block = selector in surface.TOKEN_SELECTORS

    for decl in tinycss2.parse_blocks_contents(content):
        if decl.type == "error":
            issues.append(ThemeIssue(
                file=filename, code="bad_css", message=decl.message,
                line=getattr(decl, "source_line", None),
            ))
            continue
        if decl.type != "declaration":
            continue

        name = decl.lower_name
        line = decl.source_line

        if name.startswith("--"):
            if not is_token_block:
                issues.append(ThemeIssue(
                    file=filename, code="token_outside_root", line=line,
                    message=f"{name} may only be declared on :root",
                ))
        elif is_token_block:
            issues.append(ThemeIssue(
                file=filename, code="property_outside_component", line=line,
                message=f"{name} on {selector} — only custom properties belong here",
            ))
        elif name in surface.REFUSED_PROPERTIES:
            issues.append(ThemeIssue(
                file=filename, code="refused_property", line=line,
                message=f"{name} is not allowed in a theme",
            ))
        elif name not in surface.ALLOWED_PROPERTIES:
            issues.append(ThemeIssue(
                file=filename, code="property_not_allowed", line=line,
                message=f"{name} is not on the allowed property list",
            ))

        for token in decl.value:
            if token.type == "function" and token.lower_name == "url":
                for arg in token.arguments:
                    if hasattr(arg, "value"):
                        url_value = arg.value
                        if not _is_internal_url(url_value):
                            issues.append(ThemeIssue(
                                file=filename, code="external_url", line=line,
                                message=f"url({url_value}) must point inside the theme archive",
                            ))


def _check_rule(rule, filename: str, issues: list[ThemeIssue]) -> None:
    if rule.type == "at-rule":
        if rule.lower_at_keyword == "import":
            issues.append(ThemeIssue(
                file=filename, code="import_rejected", line=rule.source_line,
                message="@import is not allowed in a theme",
            ))
            return
        if rule.content is not None:
            # @media, @supports: recurse so the selectors inside are checked too.
            for inner in tinycss2.parse_rule_list(rule.content, skip_whitespace=True):
                _check_rule(inner, filename, issues)
        return

    if rule.type == "error":
        issues.append(ThemeIssue(
            file=filename, code="bad_css", message=rule.message,
            line=getattr(rule, "source_line", None),
        ))
        return

    if rule.type != "qualified-rule":
        return

    selector = _normalise(tinycss2.serialize(rule.prelude))
    allowed = surface.TOKEN_SELECTORS | surface.PUBLISHED_SELECTORS
    if selector not in allowed:
        issues.append(ThemeIssue(
            file=filename, code="selector_not_published", line=rule.source_line,
            message=f"{selector!r} is not a published selector",
        ))
        return

    _check_declarations(rule.content, selector, filename, issues)


def filter_css(source: str, filename: str) -> str:
    rules = tinycss2.parse_stylesheet(source, skip_comments=True, skip_whitespace=True)
    issues: list[ThemeIssue] = []
    for rule in rules:
        _check_rule(rule, filename, issues)

    if issues:
        raise ThemeRejected(issues)

    # Re-serialised rather than passed through, so what is stored is what the
    # parser understood, not whatever bytes happened to arrive.
    return tinycss2.serialize(rules)
