"""Check whether an MSI carries the WebView2-bootstrap machinery that the
official Tauri-built installer carries: a set of registry searches that
detect an installed WebView2 runtime, a custom action that downloads and
runs the Evergreen bootstrapper when none is found, and a sequence entry
that runs that action (but not during uninstall).

This module is text-in, differences-out: it does not touch the filesystem
or invoke any MSI tooling itself. Callers run `msiinfo export <msi> <table>`
for each of RegLocator, AppSearch, CustomAction and InstallExecuteSequence
and pass the raw stdout in as a dict.

The comparison is deliberately behavioural, not textual:
- The custom action's Target is checked for the substrings that matter (the
  bootstrapper URL, `/silent`, `/install`), not compared whole. Our own
  custom action will not be byte-identical to Tauri's: the temp filename and
  the exact PowerShell phrasing are ours to choose.
- The custom action's Type is checked for the two behavioural bits that
  matter (bit 64, ignore return code; bit 128, run asynchronously), not
  compared to the number 1058. `wixl` cannot produce the `Directory`-sourced
  form that yields exactly 1058, so a correct installer built through wixl
  will always have a different Type number.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# The registry key Microsoft's own WebView2 bootstrapper writes to, under
# each of the three views a machine- or user-scoped install can land in.
_WEBVIEW2_CLIENT_GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
_KEY_HKLM_WOW6432 = (
    f"SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{_WEBVIEW2_CLIENT_GUID}"
)
_KEY_HKLM_NATIVE = f"SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{_WEBVIEW2_CLIENT_GUID}"
_KEY_HKCU = f"SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{_WEBVIEW2_CLIENT_GUID}"

_ROOT_NAMES = {-1: "HKMU", 0: "HKCR", 1: "HKCU", 2: "HKLM", 3: "HKU"}

EXPECTED_PROPERTY = "INSTALLED_WEBVIEW2_VERSION"
EXPECTED_URL = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
EXPECTED_ARGS = ("/silent", "/install")
EXPECTED_CONDITION = "NOT(REMOVE OR INSTALLED_WEBVIEW2_VERSION)"

# Type 18 = msidbLocatorTypeRawValue (2) | msidbLocatorType64bit (16): a raw
# registry value read from the 64-bit view. HKLM is probed in both the
# WOW6432Node (32-bit view of a 64-bit key written by a 32-bit installer)
# and native (64-bit view) locations because the bootstrapper's own install
# location depends on which bitness wrote it; HKCU covers a per-user install.
EXPECTED_SEARCHES = (
    (2, _KEY_HKLM_WOW6432, "pv", 18),
    (2, _KEY_HKLM_NATIVE, "pv", 18),
    (1, _KEY_HKCU, "pv", 18),
)

_IGNORE_RETURN_BIT = 64
_ASYNC_BIT = 128


@dataclass
class Facts:
    reglocator: list[dict[str, str]] = field(default_factory=list)
    appsearch: list[dict[str, str]] = field(default_factory=list)
    customaction: list[dict[str, str]] = field(default_factory=list)
    sequence: list[dict[str, str]] = field(default_factory=list)


def _parse_table(text: str) -> list[dict[str, str]]:
    """Parse one `msiinfo export` dump into a list of column->value rows.

    `msiinfo export` always emits exactly three header lines before data:
    column names, column types, then the table name followed by its key
    columns. An empty or missing table (wixl omits tables nothing
    populates) yields an empty list rather than an error.
    """
    if not text:
        return []
    lines = text.splitlines()
    if len(lines) < 3:
        return []
    columns = lines[0].split("\t")
    rows = []
    for line in lines[3:]:
        if line == "":
            continue
        values = line.split("\t")
        rows.append(dict(zip(columns, values)))
    return rows


def parse(dumps: dict[str, str]) -> Facts:
    return Facts(
        reglocator=_parse_table(dumps.get("RegLocator", "")),
        appsearch=_parse_table(dumps.get("AppSearch", "")),
        customaction=_parse_table(dumps.get("CustomAction", "")),
        sequence=_parse_table(dumps.get("InstallExecuteSequence", "")),
    )


def _as_int(value: str | None) -> int | None:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def _signatures_matching(
    rows: list[dict[str, str]], root: int, key: str, name: str, type_: int
) -> list[str]:
    matches = []
    for row in rows:
        if (
            _as_int(row.get("Root")) == root
            and row.get("Key") == key
            and row.get("Name") == name
            and _as_int(row.get("Type")) == type_
        ):
            signature = row.get("Signature_")
            if signature is not None:
                matches.append(signature)
    return matches


def _property_is_filled_by(appsearch: list[dict[str, str]], signatures: list[str]) -> bool:
    return any(
        row.get("Property") == EXPECTED_PROPERTY and row.get("Signature_") in signatures
        for row in appsearch
    )


def _find_download_action(customaction: list[dict[str, str]]) -> dict[str, str] | None:
    for row in customaction:
        if EXPECTED_URL in row.get("Target", ""):
            return row
    return None


def differences(facts: Facts) -> list[str]:
    diffs: list[str] = []

    for root, key, name, type_ in EXPECTED_SEARCHES:
        root_name = _ROOT_NAMES.get(root, str(root))
        signatures = _signatures_matching(facts.reglocator, root, key, name, type_)
        if not signatures:
            diffs.append(
                f"RegLocator: missing a search for {root_name}\\{key}\\{name} "
                f"with type {type_} (raw value, 64-bit view)"
            )
            continue
        if not _property_is_filled_by(facts.appsearch, signatures):
            diffs.append(
                f"AppSearch: no entry fills {EXPECTED_PROPERTY!r} from the "
                f"RegLocator search on {root_name}\\{key}\\{name}"
            )

    action = _find_download_action(facts.customaction)
    if action is None:
        diffs.append(
            f"CustomAction: no action found whose Target contains the "
            f"WebView2 bootstrapper URL {EXPECTED_URL!r}"
        )
    else:
        action_name = action.get("Action", "<unnamed>")
        target = action.get("Target", "")
        for arg in EXPECTED_ARGS:
            if arg not in target:
                diffs.append(
                    f"CustomAction {action_name!r}: Target is missing the "
                    f"argument {arg!r}"
                )

        action_type = _as_int(action.get("Type"))
        if action_type is None:
            diffs.append(f"CustomAction {action_name!r}: Type is missing or not an integer")
        else:
            if action_type & _IGNORE_RETURN_BIT:
                diffs.append(
                    f"CustomAction {action_name!r}: Type {action_type} sets the "
                    f"ignore-return bit (64); a failed bootstrapper must not be ignored"
                )
            if action_type & _ASYNC_BIT:
                diffs.append(
                    f"CustomAction {action_name!r}: Type {action_type} sets the "
                    f"async bit (128); the install must wait for the bootstrapper"
                )

        seq_row = next(
            (row for row in facts.sequence if row.get("Action") == action_name), None
        )
        if seq_row is None:
            diffs.append(
                f"InstallExecuteSequence: no entry schedules {action_name!r}"
            )
        else:
            condition = seq_row.get("Condition", "")
            if condition != EXPECTED_CONDITION:
                diffs.append(
                    f"InstallExecuteSequence: condition for {action_name!r} is "
                    f"{condition!r}, expected {EXPECTED_CONDITION!r}"
                )

    return diffs
