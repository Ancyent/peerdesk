"""Parse a theme stylesheet and keep only what the surface contract allows.

tinycss2 rather than a regular expression, because CSS has comments, strings,
escapes and nesting, and a pattern that looks right will be wrong on the input
that matters.

Every rule below is stated affirmatively — "accept only what matches this" —
rather than as a list of known-bad forms. That is not a style preference: the
excluding form was tried on this branch for SVG attributes, for quoted versus
unquoted urls, for CSS function names, for entry-name characters and for the
manifest self-reference, and each time it was defeated by the first case nobody
had listed.

Note what this can and cannot do. It stops a theme reaching elements it was not
given, stops it declaring tokens it was not given, and stops it fetching from
anywhere but its own archive. It does not — and cannot — stop a theme making a
component it *was* given unreadable, because colour and typography are the
point of a theme.
"""
import posixpath
from dataclasses import dataclass

import tinycss2

from . import surface
from .archive import is_safe_entry_name
from .errors import IssueList, ThemeIssue, ThemeRejected


@dataclass(frozen=True)
class FilteredCss:
    """What a stylesheet leaves behind.

    `css` is the re-serialised text — what the parser understood, not whatever
    bytes happened to arrive. `urls` is every archive path its url() references
    resolved to; the caller requires each to exist and adds it to the write
    set, which is the only reason a CSS-referenced image is shipped at all.
    """
    css: str
    urls: frozenset[str]


def _resolve_url(value: str, stylesheet: str) -> str | None:
    """Resolve a url() to the archive path the browser would fetch.

    Returns None if the reference is not a usable same-archive path, in which
    case the caller rejects it.

    Affirmative rule. A usable reference is:
      - non-empty, with no query and no fragment;
      - free of any scheme and any authority, so it cannot name another host;
      - resolved by the ordinary URL rules, relative to the directory holding
        the stylesheet itself — which is where the browser will resolve it, so
        what validates is what renders;
      - still inside the archive after that resolution; and
      - a legal archive entry name.

    The last clause is what makes the rest hold. Entry names are already
    restricted to an ASCII allowlist, so percent-encoded traversal, NUL bytes,
    backslashes and Unicode homographs are refused here for the same reason
    they are refused in the archive: they cannot name a file that exists.
    """
    raw = value.strip()
    if not raw:
        return None
    if "?" in raw or "#" in raw:
        return None
    if raw.startswith("/"):
        # Absolute, and protocol-relative, which is absolute with a host.
        return None
    head = raw.split("/", 1)[0]
    if ":" in head:
        # Any scheme at all: http:, data:, javascript:, and C: on Windows.
        return None

    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(stylesheet), raw))
    if resolved == ".." or resolved.startswith("../"):
        return None
    if not is_safe_entry_name(resolved):
        return None
    return resolved


def _record_url(
    value: str, filename: str, line: int, issues: IssueList,
    urls: set[str], stylesheet: str,
) -> None:
    target = _resolve_url(value, stylesheet)
    if target is None:
        issues.append(ThemeIssue(
            file=filename, code="external_url", line=line,
            message=f"url({value}) must resolve to a file inside the theme archive",
        ))
        return
    urls.add(target)


def _walk_value(
    token, filename: str, line: int, issues: IssueList, urls: set[str]
) -> None:
    """Check every url() in a declaration value, at any depth.

    Walks the whole token tree rather than recognising function names, because
    a name list is defeated by the first vendor-prefixed or newly-standardised
    function that can hold a url — image-set, cross-fade, -webkit-image-set,
    and whatever comes next.
    """
    if token.type == "error":
        issues.append(ThemeIssue(
            file=filename, code="bad_css", line=line,
            message=getattr(token, "message", "parse error in declaration"),
        ))
        return

    if token.type == "url":
        # The unquoted url(...) form, which the tokenizer resolves itself.
        _record_url(token.value, filename, line, issues, urls, stylesheet=filename)
        return

    if token.type != "function":
        return

    if token.lower_name == "url":
        # The quoted form arrives as a function block. Exactly one string
        # argument is the whole of the grammar; anything else — a var(), a bare
        # ident, two arguments — is not a url this validator can resolve, and
        # passing it through would mean shipping a reference nobody checked.
        args = [a for a in token.arguments if a.type != "whitespace"]
        if len(args) == 1 and args[0].type == "string":
            _record_url(args[0].value, filename, line, issues, urls, stylesheet=filename)
        else:
            issues.append(ThemeIssue(
                file=filename, code="bad_css", line=line,
                message="url() must contain a single quoted path",
            ))
        return

    for arg in token.arguments:
        _walk_value(arg, filename, line, issues, urls)


def _check_declarations(
    content: list, selector: str, filename: str, issues: IssueList, urls: set[str]
) -> None:
    is_token_block = selector in surface.TOKEN_SELECTORS

    for decl in tinycss2.parse_blocks_contents(content):
        if issues.stopped():
            return
        if decl.type == "error":
            issues.append(ThemeIssue(
                file=filename, code="bad_css", message=decl.message,
                line=getattr(decl, "source_line", None),
            ))
            continue
        if decl.type != "declaration":
            continue

        line = decl.source_line

        if decl.name.startswith("--"):
            # Custom property names are case-sensitive, so this one is compared
            # as written rather than through lower_name.
            name = decl.name
            if not is_token_block:
                issues.append(ThemeIssue(
                    file=filename, code="token_outside_root", line=line,
                    message=f"{name} may only be declared on :root",
                ))
            elif name.startswith(surface.RESERVED_TOKEN_PREFIX):
                issues.append(ThemeIssue(
                    file=filename, code="token_not_settable", line=line,
                    message=(
                        f"{name} is reserved: tokens beginning "
                        f"{surface.RESERVED_TOKEN_PREFIX} carry security-critical UI "
                        f"and no theme may set them"
                    ),
                ))
            elif name not in surface.SETTABLE_TOKENS:
                issues.append(ThemeIssue(
                    file=filename, code="token_not_settable", line=line,
                    message=f"{name} is not a token this app reads, so setting it would do nothing",
                ))
        elif is_token_block:
            issues.append(ThemeIssue(
                file=filename, code="property_outside_component", line=line,
                message=f"{decl.lower_name} on {selector} — only custom properties belong here",
            ))
        elif decl.lower_name in surface.REFUSED_PROPERTIES:
            issues.append(ThemeIssue(
                file=filename, code="refused_property", line=line,
                message=f"{decl.lower_name} is not allowed in a theme",
            ))
        elif decl.lower_name not in surface.ALLOWED_PROPERTIES:
            issues.append(ThemeIssue(
                file=filename, code="property_not_allowed", line=line,
                message=f"{decl.lower_name} is not on the allowed property list",
            ))

        for token in decl.value:
            _walk_value(token, filename, line, issues, urls)


def _check_font_face(
    content: list, filename: str, line: int, issues: IssueList, urls: set[str]
) -> None:
    """@font-face holds declarations, not rules.

    Recursing into it with parse_rule_list — which is what a generic "block
    at-rule" branch does — reports every real @font-face as a syntax error,
    which is how the format came to ship a fonts/ directory that no theme could
    reference.
    """
    for decl in tinycss2.parse_blocks_contents(content):
        if issues.stopped():
            return
        if decl.type == "error":
            issues.append(ThemeIssue(
                file=filename, code="bad_css", message=decl.message,
                line=getattr(decl, "source_line", line),
            ))
            continue
        if decl.type != "declaration":
            continue

        if decl.name.startswith("--") or decl.lower_name not in surface.FONT_FACE_PROPERTIES:
            issues.append(ThemeIssue(
                file=filename, code="property_not_allowed", line=decl.source_line,
                message=f"{decl.name} is not allowed inside @font-face",
            ))

        for token in decl.value:
            _walk_value(token, filename, decl.source_line, issues, urls)


def _canonical_attribute(block) -> str | None:
    """Canonical text for one attribute selector, or None if it is not one.

    Accepts `[name]` and `[name=value]` with the value written bare, single- or
    double-quoted, and with whitespace anywhere. All four spellings select the
    same elements, so all four canonicalise to the same string — otherwise
    `:root[data-theme=light]` is refused for being spelled differently from the
    published form, which is a bug report rather than a security control.
    """
    parts = [t for t in block.content if t.type != "whitespace"]
    if len(parts) == 1 and parts[0].type == "ident":
        return f"[{parts[0].value}]"
    if (
        len(parts) == 3
        and parts[0].type == "ident"
        and parts[1].type == "literal" and parts[1].value == "="
        and parts[2].type in ("ident", "string")
    ):
        return f"[{parts[0].value}='{parts[2].value}']"
    return None


def _parse_compound(tokens: list) -> tuple[str, str | None] | None:
    """Split one compound selector into (base, state), or None if unparsable.

    The grammar accepted, in full:

        compound := base state?
        base     := ':root' attribute?     -- the token blocks
                  | attribute              -- a published component
        state    := ':' ident

    Everything else — descendant combinators, element names, classes, ids,
    pseudo-elements, functional pseudo-classes, two attribute selectors in a
    row — falls outside it and is refused. Naming the accepted shape rather
    than the refused ones is what lets `[a],[b]` and `[a]:hover` through while
    still refusing `input[value^='a']`.
    """
    index = 0
    base: str

    if index < len(tokens) and tokens[index].type == "literal" and tokens[index].value == ":":
        if (
            index + 1 >= len(tokens)
            or tokens[index + 1].type != "ident"
            or tokens[index + 1].lower_value != "root"
        ):
            return None
        base = ":root"
        index += 2
        if index < len(tokens) and tokens[index].type == "[] block":
            attribute = _canonical_attribute(tokens[index])
            if attribute is None:
                return None
            base += attribute
            index += 1
    elif index < len(tokens) and tokens[index].type == "[] block":
        attribute = _canonical_attribute(tokens[index])
        if attribute is None:
            return None
        base = attribute
        index += 1
    else:
        return None

    state: str | None = None
    if index < len(tokens):
        if (
            tokens[index].type == "literal" and tokens[index].value == ":"
            and index + 1 < len(tokens) and tokens[index + 1].type == "ident"
        ):
            state = tokens[index + 1].lower_value
            index += 2
        else:
            return None

    if index != len(tokens):
        return None
    return base, state


def _split_compounds(prelude: list) -> list[list]:
    """Split a selector list on its top-level commas, dropping whitespace.

    Whitespace between two simple selectors is a descendant combinator, and
    dropping it here does not admit one: `_parse_compound` accepts a fixed
    number of tokens in a fixed order, so `[data-pd-btn] span` still fails on
    the trailing ident it has no rule for.
    """
    groups: list[list] = [[]]
    for token in prelude:
        if token.type == "whitespace":
            continue
        if token.type == "literal" and token.value == ",":
            groups.append([])
        else:
            groups[-1].append(token)
    return groups


def _check_qualified_rule(rule, filename: str, issues: IssueList, urls: set[str]) -> None:
    bases: set[str] = set()

    for group in _split_compounds(rule.prelude):
        text = tinycss2.serialize(group).strip()
        parsed = _parse_compound(group)
        if parsed is None:
            issues.append(ThemeIssue(
                file=filename, code="selector_not_published", line=rule.source_line,
                message=(
                    f"{text!r} is not a published selector; a theme may select only "
                    f"{sorted(surface.PUBLISHED_SELECTORS)} or a token block, "
                    f"each optionally with one state pseudo-class"
                ),
            ))
            return

        base, state = parsed
        if base not in surface.TOKEN_SELECTORS | surface.PUBLISHED_SELECTORS:
            issues.append(ThemeIssue(
                file=filename, code="selector_not_published", line=rule.source_line,
                message=f"{text!r} is not a published selector",
            ))
            return
        if state is not None:
            if base not in surface.PUBLISHED_SELECTORS:
                issues.append(ThemeIssue(
                    file=filename, code="state_not_allowed", line=rule.source_line,
                    message=(
                        f"{text!r}: a state pseudo-class belongs on a component, "
                        f"not on a token block"
                    ),
                ))
                return
            if state not in surface.STATE_PSEUDO_CLASSES:
                issues.append(ThemeIssue(
                    file=filename, code="state_not_allowed", line=rule.source_line,
                    message=(
                        f":{state} is not an allowed state; a theme may use "
                        f"{sorted(':' + s for s in surface.STATE_PSEUDO_CLASSES)}"
                    ),
                ))
                return
        bases.add(base)

    if not bases:
        issues.append(ThemeIssue(
            file=filename, code="selector_not_published", line=rule.source_line,
            message="a rule must name at least one published selector",
        ))
        return

    # A token block and a component take mutually exclusive declaration rules,
    # so a group spanning both cannot be valid whichever way it is read.
    if bases & surface.TOKEN_SELECTORS and bases - surface.TOKEN_SELECTORS:
        issues.append(ThemeIssue(
            file=filename, code="selector_group_mixed", line=rule.source_line,
            message="a rule may not group a token block with a component; split it in two",
        ))
        return

    # Homogeneous by the check above, so any base decides which rules apply.
    _check_declarations(rule.content, next(iter(bases)), filename, issues, urls)


def _check_rule(rule, filename: str, issues: IssueList, urls: set[str]) -> None:
    if rule.type == "at-rule":
        keyword = rule.lower_at_keyword
        if keyword == "import":
            issues.append(ThemeIssue(
                file=filename, code="import_rejected", line=rule.source_line,
                message="@import is not allowed in a theme",
            ))
        elif keyword == "font-face":
            if rule.content is None:
                issues.append(ThemeIssue(
                    file=filename, code="bad_css", line=rule.source_line,
                    message="@font-face must have a declaration block",
                ))
            else:
                _check_font_face(rule.content, filename, rule.source_line, issues, urls)
        elif keyword in surface.BLOCK_AT_RULES:
            if rule.content is None:
                issues.append(ThemeIssue(
                    file=filename, code="bad_css", line=rule.source_line,
                    message=f"@{rule.at_keyword} must have a block",
                ))
            else:
                for inner in tinycss2.parse_rule_list(rule.content, skip_whitespace=True):
                    if issues.stopped():
                        return
                    _check_rule(inner, filename, issues, urls)
        else:
            issues.append(ThemeIssue(
                file=filename, code="at_rule_not_allowed", line=rule.source_line,
                message=(
                    f"@{rule.at_keyword} is not allowed in a theme; a theme may use "
                    f"@font-face, @media and @supports"
                ),
            ))
        return

    if rule.type == "error":
        issues.append(ThemeIssue(
            file=filename, code="bad_css", message=rule.message,
            line=getattr(rule, "source_line", None),
        ))
        return

    if rule.type != "qualified-rule":
        return

    _check_qualified_rule(rule, filename, issues, urls)


def filter_css(source: str, filename: str) -> FilteredCss:
    """Validate one stylesheet and report what it references.

    `filename` is the archive path of the stylesheet, not a label: url()
    references resolve relative to the directory holding it, exactly as the
    browser will resolve them once the theme is served.

    Raises ThemeRejected if anything in the stylesheet falls outside the
    contract. Otherwise returns the re-serialised text and the set of archive
    paths its url() references resolved to.
    """
    rules = tinycss2.parse_stylesheet(source, skip_comments=True, skip_whitespace=True)
    issues = IssueList()
    urls: set[str] = set()
    for rule in rules:
        if issues.stopped():
            break
        _check_rule(rule, filename, issues, urls)

    if issues:
        raise ThemeRejected(issues.finish())

    # Re-serialised rather than passed through, so what is stored is what the
    # parser understood, not whatever bytes happened to arrive.
    return FilteredCss(css=tinycss2.serialize(rules), urls=frozenset(urls))
