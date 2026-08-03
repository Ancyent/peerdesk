import importlib.util
import sys
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "webview2_check",
    Path(__file__).resolve().parents[3] / "deploy" / "builder" / "webview2_check.py",
)
_MOD = importlib.util.module_from_spec(_SPEC)
sys.modules["webview2_check"] = _MOD
_SPEC.loader.exec_module(_MOD)
parse = _MOD.parse
differences = _MOD.differences

GUID = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

# Shaped exactly like `msiinfo export`: a column-name row, a column-type row, a
# table-name row, then data. Transcribed from the real CI-built MSI, so the
# fixture cannot quietly drift into agreeing with a wrong parser.
REGLOCATOR = f"""Signature_\tRoot\tKey\tName\tType
s72\ti2\ts255\tS255\tI2
RegLocator\tSignature_
Webview2VersionSystemx64\t2\tSOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{GUID}\tpv\t18
Webview2VersionSystemx86\t2\tSOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{GUID}\tpv\t18
Webview2VersionUser\t1\tSOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{GUID}\tpv\t18
"""

APPSEARCH = """Property\tSignature_
s72\ts72
AppSearch\tProperty\tSignature_
INSTALLED_WEBVIEW2_VERSION\tWebview2VersionSystemx64
INSTALLED_WEBVIEW2_VERSION\tWebview2VersionSystemx86
INSTALLED_WEBVIEW2_VERSION\tWebview2VersionUser
"""

CUSTOMACTION = """Action\tType\tSource\tTarget\tExtendedType
s72\ti2\tS72\tS255\tI4
CustomAction\tAction
DownloadAndInvokeBootstrapper\t1058\tINSTALLDIR\tpowershell.exe -NoProfile -windowstyle hidden Invoke-WebRequest -Uri "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile "$env:TEMP\\MicrosoftEdgeWebview2Setup.exe" ; Start-Process -FilePath "$env:TEMP\\MicrosoftEdgeWebview2Setup.exe" -ArgumentList ('/silent', '/install') -Wait\t
"""

SEQUENCE = """Action\tCondition\tSequence
s72\tS255\tI2
InstallExecuteSequence\tAction
InstallInitialize\t\t1500
DownloadAndInvokeBootstrapper\tNOT(REMOVE OR INSTALLED_WEBVIEW2_VERSION)\t6599
InstallFinalize\t\t6600
"""


def _dumps(**overrides):
    d = {
        "RegLocator": REGLOCATOR,
        "AppSearch": APPSEARCH,
        "CustomAction": CUSTOMACTION,
        "InstallExecuteSequence": SEQUENCE,
    }
    d.update(overrides)
    return d


def test_the_official_installer_has_no_differences():
    assert differences(parse(_dumps())) == []


def test_a_missing_registry_search_is_reported():
    trimmed = "\n".join(
        line for line in REGLOCATOR.splitlines() if "Webview2VersionUser" not in line
    ) + "\n"
    diffs = differences(parse(_dumps(RegLocator=trimmed)))
    assert diffs != []
    assert any("HKCU" in d or "1" in d for d in diffs), diffs


def test_the_64_bit_locator_flag_is_checked():
    """Type 2 is raw; 18 is raw plus the 64-bit flag. Dropping the flag leaves
    XML that reads correctly and a search that looks at the wrong registry
    view. This is the single most likely mistake, so it must be caught."""
    wrong = REGLOCATOR.replace("\tpv\t18", "\tpv\t2")
    diffs = differences(parse(_dumps(RegLocator=wrong)))
    assert any("18" in d for d in diffs), diffs


def test_a_wrong_guid_is_reported():
    wrong = REGLOCATOR.replace(GUID, "{00000000-0000-0000-0000-000000000000}")
    assert differences(parse(_dumps(RegLocator=wrong))) != []


def test_a_search_filling_the_wrong_property_is_reported():
    wrong = APPSEARCH.replace("INSTALLED_WEBVIEW2_VERSION", "SOMETHING_ELSE")
    diffs = differences(parse(_dumps(AppSearch=wrong)))
    assert any("INSTALLED_WEBVIEW2_VERSION" in d for d in diffs), diffs


def test_a_changed_download_url_is_reported():
    wrong = CUSTOMACTION.replace("LinkId=2124703", "LinkId=9999999")
    assert differences(parse(_dumps(CustomAction=wrong))) != []


def test_dropping_silent_install_is_reported():
    """Without /silent the runtime installer shows UI during an unattended
    install, which is how a silent deployment hangs on an invisible dialog."""
    wrong = CUSTOMACTION.replace("('/silent', '/install')", "('/install')")
    assert differences(parse(_dumps(CustomAction=wrong))) != []


def test_an_action_that_ignores_its_return_code_is_reported():
    """Type 1058 has neither the ignore-return bit (64) nor the async bit (128).
    Setting either means a failed bootstrapper leaves an installed application
    that cannot start, which is worse than a failed install."""
    wrong = CUSTOMACTION.replace("\t1058\t", "\t1122\t")  # 1058 + 64
    diffs = differences(parse(_dumps(CustomAction=wrong)))
    assert diffs != [], "an action that ignores its return code must be reported"


def test_a_weakened_condition_is_reported():
    """Losing REMOVE means the bootstrapper runs during uninstall."""
    wrong = SEQUENCE.replace(
        "NOT(REMOVE OR INSTALLED_WEBVIEW2_VERSION)", "NOT INSTALLED_WEBVIEW2_VERSION"
    )
    assert differences(parse(_dumps(InstallExecuteSequence=wrong))) != []


def test_an_msi_with_no_webview2_machinery_at_all_is_reported():
    """The state of our installer before this work: tables present, none of
    them carrying a WebView2 row."""
    empty = {k: v.splitlines()[0] + "\n" for k, v in _dumps().items()}
    diffs = differences(parse(empty))
    assert len(diffs) >= 3, diffs


def test_an_action_outside_the_install_transaction_is_reported():
    """`wixl` mis-resolves Before="InstallFinalize" to a nondeterministic
    sequence number that can land outside the install transaction, e.g. 1402
    (RemoveExistingProducts+1). A deferred, non-impersonated action scheduled
    there cannot write its script record; Windows Installer fails it with
    error 2762, and because Return="check" is set that aborts and rolls back
    the whole install. A row merely existing with the right condition is not
    enough -- its Sequence number must fall strictly between
    InstallInitialize and InstallFinalize."""
    wrong = SEQUENCE.replace("\t6599\n", "\t1402\n")
    diffs = differences(parse(_dumps(InstallExecuteSequence=wrong)))
    assert diffs != [], "an action scheduled outside the install transaction must be reported"


def test_a_missing_table_does_not_crash():
    """wixl omits a table entirely when nothing populates it, so absence is the
    normal shape of 'not implemented', not an error condition."""
    diffs = differences(parse({"RegLocator": REGLOCATOR}))
    assert diffs != []
