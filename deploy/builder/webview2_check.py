"""Check whether an MSI carries the WebView2-bootstrap machinery that the
official Tauri-built installer carries: a set of registry searches that
detect an installed WebView2 runtime, a custom action that downloads and
runs the Evergreen bootstrapper when none is found, and a sequence entry
that runs that action (but not during uninstall).

`parse` and `differences` are text-in, differences-out: they do not touch the
filesystem or invoke any MSI tooling themselves. Callers run
`msiinfo export <msi> <table>` for each of RegLocator, AppSearch, CustomAction
and InstallExecuteSequence and pass the raw stdout in as a dict.

Run as a script (`python3 webview2_check.py <path-to-msi>`), the module does
that shelling-out itself, for build.sh's convenience: it prints every
difference to stderr and exits non-zero if any exist, zero otherwise.

The comparison is deliberately behavioural, not textual:
- The custom action's Target is checked for the substrings that matter (the
  bootstrapper URL, `/silent`, `/install`, and the TLS 1.2 clause), not
  compared whole. Our own custom action will not be byte-identical to
  Tauri's: the temp filename and the exact PowerShell phrasing are ours to
  choose.
- The custom action's Type is checked for the behavioural bits that matter,
  not compared to the number 1058. `wixl` cannot produce the
  `Directory`-sourced form that yields exactly 1058, so a correct installer
  built through wixl will always have a different Type number.

  1058 decomposes as 34 (`msidbCustomActionTypeExe` 2 | `...TypeDirectory`
  32, an EXE whose working directory comes from a Directory) plus 1024
  (`msidbCustomActionTypeInScript`, i.e. deferred). It does NOT set 2048
  (`msidbCustomActionTypeNoImpersonate`) -- the reference action runs
  impersonated. Ours is 3122 = 50 (`...TypeExe` 2 | `...TypeProperty` 48,
  the Property-sourced form wixl can build) | 1024 | 2048: deferred and
  non-impersonated. The 2048 divergence is deliberate and documented at the
  CustomAction in deploy/builder/installers/peerdesk-viewer.wxs.

  Checked here: bit 64 (ignore return code) and bit 128 (run asynchronously)
  must be clear, and bit 1024 (deferred) must be set. Dropping
  `Execute="deferred"` clears 1024 and yields 2098, whose 64 and 128 bits are
  still clear -- so without the 1024 assertion that passes, and an immediate,
  unelevated action at 6599 cannot install a machine-wide runtime.
- The sequence entry's Sequence number is checked against the same dump's
  InstallInitialize and InstallFinalize rows, not against a fixed number.
  `wixl` has been observed resolving `Before="InstallFinalize"` to a
  sequence number outside the install transaction (e.g. 1402, right after
  RemoveExistingProducts), which is a defect a row simply existing with the
  right condition would not catch.
- The `AppSearch` *standard action* must itself be sequenced in
  InstallExecuteSequence. The AppSearch table only says which property a
  search fills; it is the standard action that runs the searches. Drop it and
  INSTALLED_WEBVIEW2_VERSION is never set, the condition below is always
  true, and the bootstrapper runs on every install -- including on machines
  that already have the runtime, and failing outright on offline ones.

What this does NOT check: the `Property` table, where a Property-sourced
custom action's executable path lives. A defect there has passed this check
before. Passing is necessary, not sufficient.
"""

from __future__ import annotations

import subprocess
import sys
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

# The TLS 1.2 clause, checked by the two tokens that survive both the
# reference's Formatted-field escaping ("[\[]Net.ServicePointManager[\]]") and
# any equivalent phrasing of the same assignment. On a host whose PowerShell
# defaults to TLS 1.0 the HTTPS fetch fails and, with Return="check", the
# whole install fails with it. Matching on the escaped bracket form instead
# would assert the reference's exact spelling rather than the behaviour.
EXPECTED_TLS_TOKENS = ("::SecurityProtocol", "::Tls12")

# AppSearch is a standard action, not one of ours; it is what actually runs
# the RegLocator searches and fills the property the condition reads.
APPSEARCH_ACTION = "AppSearch"

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
_DEFERRED_BIT = 1024


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


def _sequence_number(sequence: list[dict[str, str]], action_name: str) -> int | None:
    row = next((r for r in sequence if r.get("Action") == action_name), None)
    return _as_int(row.get("Sequence")) if row is not None else None


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

    # The searches above only describe what AppSearch would do. The AppSearch
    # standard action is what runs them; without a row here the property is
    # never set, the condition below is always true, and the bootstrapper runs
    # on every install -- including on machines that already have the runtime,
    # and failing outright on offline ones.
    if _sequence_number(facts.sequence, APPSEARCH_ACTION) is None:
        diffs.append(
            f"InstallExecuteSequence: the {APPSEARCH_ACTION!r} standard action is "
            f"not sequenced, so the registry searches never run and "
            f"{EXPECTED_PROPERTY!r} is never set; the bootstrapper would then run "
            f"on every install, including on machines that already have the runtime"
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

        for token in EXPECTED_TLS_TOKENS:
            if token not in target:
                diffs.append(
                    f"CustomAction {action_name!r}: Target is missing {token!r}, "
                    f"part of the TLS 1.2 clause the reference installer carries; "
                    f"without it the download fails on a host whose PowerShell "
                    f"still defaults to TLS 1.0, and Return=check turns that into "
                    f"a failed install"
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
            if not action_type & _DEFERRED_BIT:
                diffs.append(
                    f"CustomAction {action_name!r}: Type {action_type} does not set "
                    f"the deferred bit (1024); an immediate action runs unelevated "
                    f"and cannot install a machine-wide runtime. Note this is "
                    f"invisible to the bits above: dropping Execute=\"deferred\" "
                    f"yields type 2098, whose 64 and 128 bits are both clear"
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

            # A row with the right condition is not enough: `wixl` has been
            # observed resolving Before="InstallFinalize" to a sequence
            # number outside the install transaction (e.g. 1402, right after
            # RemoveExistingProducts). A deferred, non-impersonated action
            # scheduled there cannot write its script record, and Windows
            # Installer fails it with error 2762 -- which, given
            # Return="check", aborts and rolls back the whole install. The
            # bounds are read from the same dump rather than hardcoded, since
            # InstallInitialize (1500) and InstallFinalize (6600) are fixed
            # MSI standard-action sequence numbers, not ours to assume.
            action_seq = _as_int(seq_row.get("Sequence"))
            init_seq = _sequence_number(facts.sequence, "InstallInitialize")
            finalize_seq = _sequence_number(facts.sequence, "InstallFinalize")
            if action_seq is None:
                diffs.append(
                    f"InstallExecuteSequence: {action_name!r} has no numeric Sequence"
                )
            elif init_seq is None or finalize_seq is None:
                diffs.append(
                    "InstallExecuteSequence: cannot verify "
                    f"{action_name!r} runs inside the install transaction because "
                    "InstallInitialize and/or InstallFinalize is missing from this dump"
                )
            elif not (init_seq < action_seq < finalize_seq):
                diffs.append(
                    f"InstallExecuteSequence: {action_name!r} is scheduled at "
                    f"{action_seq}, which is not strictly between InstallInitialize "
                    f"({init_seq}) and InstallFinalize ({finalize_seq}); outside the "
                    "install transaction a deferred action fails with error 2762"
                )

    return diffs


def _msiinfo_export(msi_path: str, table: str) -> str:
    """Run `msiinfo export` for one table, the same way build.sh's callers do.

    A table `wixl` never populated (nothing searches the registry, no custom
    action was added) makes `msiinfo` itself exit non-zero rather than print
    an empty table. That is indistinguishable, for this checker's purposes,
    from the table existing and being empty, so both are folded to "" and
    left to `parse`/`differences` to report as missing machinery.
    """
    result = subprocess.run(
        ["msiinfo", "export", msi_path, table],
        capture_output=True,
        text=True,
    )
    return result.stdout if result.returncode == 0 else ""


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: webview2_check.py <path-to-msi>", file=sys.stderr)
        return 2

    msi_path = argv[1]
    dumps = {
        table: _msiinfo_export(msi_path, table)
        for table in ("RegLocator", "AppSearch", "CustomAction", "InstallExecuteSequence")
    }
    diffs = differences(parse(dumps))
    for line in diffs:
        print(line, file=sys.stderr)
    return 1 if diffs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
