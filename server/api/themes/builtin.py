"""The theme that ships with the product.

It lives under server/api/ because the API image is built from ../server/api and
cannot see the rest of the repository. That means its tokens are a copy of
web/src/branding.css; test_themes_builtin.py is what keeps the copy honest.
"""
import json
import zipfile
from pathlib import Path

BUILTIN_DIR = Path(__file__).parent / "builtin" / "aurora-glass"


def builtin_theme_id() -> str:
    return json.loads((BUILTIN_DIR / "theme.json").read_text())["id"]


def pack_builtin(destination: Path) -> Path:
    """Write the built-in theme as an archive and return its path.

    Stage 2 serves this as the downloadable example template, so it is built the
    same way a user's upload arrives — through the public format, not a private
    shortcut.
    """
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f"{builtin_theme_id()}.zip"

    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(BUILTIN_DIR.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(BUILTIN_DIR).as_posix())

    return archive
