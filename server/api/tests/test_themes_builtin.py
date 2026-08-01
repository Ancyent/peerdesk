import re
from pathlib import Path

from themes.builtin import BUILTIN_DIR, builtin_theme_id, pack_builtin
from themes.validate import validate_archive

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_the_builtin_theme_passes_the_public_validator(tmp_path):
    # If the default theme cannot satisfy the format, the format is a lie.
    result = validate_archive(pack_builtin(tmp_path))
    assert result.manifest.id == builtin_theme_id()
    assert "css/tokens.css" in result.files


def test_the_builtin_theme_declares_every_target(tmp_path):
    result = validate_archive(pack_builtin(tmp_path))
    assert set(result.manifest.targets) == {"web", "appViewer", "desktop"}
    assert set(result.manifest.themes) == {"dark", "light"}


def test_packing_twice_produces_a_readable_archive_each_time(tmp_path):
    first = pack_builtin(tmp_path / "a")
    second = pack_builtin(tmp_path / "b")
    assert validate_archive(first).manifest.id == validate_archive(second).manifest.id


def _tokens(css: str, block: str) -> dict[str, str]:
    """Pull `--name: value;` pairs out of one selector block."""
    match = re.search(re.escape(block) + r"\s*\{(.*?)\}", css, re.S)
    assert match, f"{block} not found"
    return {
        name: " ".join(value.split())
        for name, value in re.findall(r"(--[a-z0-9-]+)\s*:\s*([^;]+);", match.group(1))
    }


def is_desktop_recipe_token(name: str) -> bool:
    """Whether a token is part of the surface recipe desktop overrides.

    Desktop deliberately replaces the whole recipe (--surface-* and --chrome-*)
    pending a WebKitGTK probe confirming backdrop-filter composites in the Tauri
    window. Until then desktop renders opaque, so those values are expected to
    differ while every other token must match exactly.

    A function rather than an inline condition so the rule itself can be
    tested. Inlined, converting it back to a hard-coded name list — the exact
    regression its own test names — changed nothing that any test could see.
    """
    return name.startswith("--surface-") or name.startswith("--chrome-")


def _settable(tokens: dict[str, str]) -> dict[str, str]:
    """Drop the reserved tokens, which a theme package deliberately lacks.

    --pd-sys-* exists in the app stylesheets and must never exist in a theme:
    the validator rejects any package that declares one. So they are expected
    to be present on one side of the comparison only.
    """
    return {k: v for k, v in tokens.items() if not k.startswith("--pd-sys-")}


def test_builtin_tokens_match_the_web_stylesheet():
    """The built-in theme and web/src/branding.css must not drift.

    They are separate files because the API image cannot see web/. This test
    runs in the repo, never in the image, and is the only thing keeping them
    honest.

    Compared as sets in both directions. One-directional comparison let
    branding.css grow a token the built-in theme lacked, which is drift that
    matters twice over now: SETTABLE_TOKENS is derived from the built-in theme,
    so a token only branding.css knows about is one no theme may set.
    """
    builtin = (BUILTIN_DIR / "css" / "tokens.css").read_text()
    web = (REPO_ROOT / "web" / "src" / "branding.css").read_text()

    for block in (":root", ":root[data-theme='light']"):
        theirs = _settable(_tokens(web, block))
        ours = _tokens(builtin, block)

        assert set(ours) == set(theirs), (
            f"{block} token sets differ: only in the built-in theme "
            f"{sorted(set(ours) - set(theirs))}, only in branding.css "
            f"{sorted(set(theirs) - set(ours))}"
        )
        for name, value in ours.items():
            assert theirs[name] == value, (
                f"{name} differs in {block}: builtin {value!r} vs branding.css {theirs[name]!r}"
            )


def test_builtin_tokens_match_the_desktop_stylesheet():
    builtin = (BUILTIN_DIR / "css" / "tokens.css").read_text()
    desktop = (REPO_ROOT / "desktop" / "src" / "styles.css").read_text()

    theirs = _settable(_tokens(desktop, ":root"))
    ours = _tokens(builtin, ":root")

    assert set(ours) == set(theirs), (
        f"token sets differ: only in the built-in theme {sorted(set(ours) - set(theirs))}, "
        f"only in desktop/src/styles.css {sorted(set(theirs) - set(ours))}"
    )
    for name, value in ours.items():
        if is_desktop_recipe_token(name):
            continue
        assert theirs[name] == value, (
            f"{name} differs: builtin {value!r} vs desktop {theirs[name]!r}"
        )


def test_the_desktop_skip_rule_is_a_prefix_rule():
    """The skip rule itself, exercised as the implementation it is.

    The previous version of this test re-derived the rule locally, so
    converting the real skip to a hard-coded name list — the regression its own
    docstring named — left it green.
    """
    assert is_desktop_recipe_token("--surface-bg")
    assert is_desktop_recipe_token("--chrome-blur")
    # The point of a prefix: a token nobody has written yet is covered too.
    assert is_desktop_recipe_token("--surface-anything-at-all")
    assert is_desktop_recipe_token("--chrome-anything-at-all")

    assert not is_desktop_recipe_token("--accent")
    assert not is_desktop_recipe_token("--accent-hover")
    assert not is_desktop_recipe_token("--text-1")


def test_the_skip_rule_covers_tokens_that_exist_and_spares_the_rest():
    builtin_tokens = _tokens((BUILTIN_DIR / "css" / "tokens.css").read_text(), ":root")
    skipped = [n for n in builtin_tokens if is_desktop_recipe_token(n)]
    compared = [n for n in builtin_tokens if not is_desktop_recipe_token(n)]
    # Neither side may be empty, or the rule would be doing no work in one
    # direction and the comparison above would be vacuous in the other.
    assert len(skipped) >= 4
    assert len(compared) >= 10


def test_the_app_stylesheets_declare_the_reserved_tokens_in_both_themes():
    """Security-critical UI must still follow light and dark.

    The reserved tokens stop following the *theme*, not the appearance, which
    only holds if both blocks of both stylesheets declare the same set.
    """
    for path in (
        REPO_ROOT / "web" / "src" / "branding.css",
        REPO_ROOT / "desktop" / "src" / "styles.css",
    ):
        source = path.read_text()
        dark = {k for k in _tokens(source, ":root") if k.startswith("--pd-sys-")}
        light = {k for k in _tokens(source, ":root[data-theme='light']") if k.startswith("--pd-sys-")}
        assert dark, f"{path.name} declares no reserved tokens"
        assert dark == light, (
            f"{path.name} reserved tokens differ between themes: "
            f"dark only {sorted(dark - light)}, light only {sorted(light - dark)}"
        )


def test_no_reserved_token_is_defined_in_terms_of_a_settable_one():
    """A var() reference would hand the whole guarantee back.

    --pd-sys-text-1: var(--text-1) looks tidy and means a theme setting
    --text-1 blanks the confirm dialog through the indirection, which is the
    finding this reserved set exists to close.
    """
    for path in (
        REPO_ROOT / "web" / "src" / "branding.css",
        REPO_ROOT / "desktop" / "src" / "styles.css",
    ):
        source = path.read_text()
        for block in (":root", ":root[data-theme='light']"):
            for name, value in _tokens(source, block).items():
                if not name.startswith("--pd-sys-"):
                    continue
                assert "var(" not in value, (
                    f"{path.name} {block} {name} is defined as {value!r}; "
                    f"a reserved token must hold a literal value"
                )
