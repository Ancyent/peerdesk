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


def test_builtin_tokens_match_the_web_stylesheet():
    """The built-in theme and web/src/branding.css must not drift.

    They are separate files because the API image cannot see web/. This test
    runs in the repo, never in the image, and is the only thing keeping them
    honest.
    """
    builtin = (BUILTIN_DIR / "css" / "tokens.css").read_text()
    web = (REPO_ROOT / "web" / "src" / "branding.css").read_text()

    for block in (":root", ":root[data-theme='light']"):
        theirs = _tokens(web, block)
        for name, value in _tokens(builtin, block).items():
            assert name in theirs, f"{name} missing from branding.css {block}"
            assert theirs[name] == value, (
                f"{name} differs in {block}: builtin {value!r} vs branding.css {theirs[name]!r}"
            )


def test_builtin_tokens_match_the_desktop_stylesheet():
    builtin = (BUILTIN_DIR / "css" / "tokens.css").read_text()
    desktop = (REPO_ROOT / "desktop" / "src" / "styles.css").read_text()

    theirs = _tokens(desktop, ":root")
    for name, value in _tokens(builtin, ":root").items():
        # Desktop deliberately overrides the glass recipe until the WebKitGTK
        # probe says backdrop-filter composites there.
        if name in {"--surface-bg", "--surface-blur", "--chrome-blur", "--surface-shadow"}:
            continue
        assert name in theirs, f"{name} missing from desktop/src/styles.css"
        assert theirs[name] == value, (
            f"{name} differs: builtin {value!r} vs desktop {theirs[name]!r}"
        )
