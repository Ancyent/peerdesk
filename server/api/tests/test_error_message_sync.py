"""Guards that every web errors:server.* value is still a real server HTTPException detail.
If a server message is reworded without updating web/src/i18n/locales/en/errors.json (and
web/src/api/errors.ts's SERVER_MESSAGE_KEYS), the client mapping silently stops localizing —
this test catches that drift."""
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ERRORS_EN = REPO / "web" / "src" / "i18n" / "locales" / "en" / "errors.json"
SERVER_SRC = REPO / "server" / "api"

# Matches both `HTTPException(404, "...")` and `HTTPException(status_code=404, detail="...")`.
_HTTPEXC = re.compile(
    r'HTTPException\(\s*(?:status_code\s*=\s*)?\d+\s*,\s*(?:detail\s*=\s*)?(["\'])(.+?)\1'
)


def _raised_details() -> set[str]:
    details: set[str] = set()
    for py in SERVER_SRC.rglob("*.py"):
        if "tests" in py.parts:
            continue
        for m in _HTTPEXC.finditer(py.read_text(encoding="utf-8")):
            details.add(m.group(2))
    return details


def test_localized_server_messages_match_real_details():
    en = json.loads(ERRORS_EN.read_text(encoding="utf-8"))
    server_values = list(en.get("server", {}).values())
    assert server_values, "no errors.json server.* values found"
    raised = _raised_details()
    missing = [v for v in server_values if v not in raised]
    assert not missing, (
        "errors.json server.* values not raised by the server (reworded message?): "
        + repr(missing)
    )
