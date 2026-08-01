from themes.errors import ThemeIssue, ThemeRejected


def test_issue_carries_file_and_optional_line():
    issue = ThemeIssue(file="css/web.css", code="refused_property", message="position", line=12)
    assert issue.file == "css/web.css"
    assert issue.line == 12
    assert issue.code == "refused_property"


def test_line_is_optional_because_not_every_rule_is_line_scoped():
    issue = ThemeIssue(file="theme.json", code="bad_manifest", message="id is required")
    assert issue.line is None


def test_rejection_reports_every_issue_not_just_the_first():
    # A theme author fixing one error per upload gives up.
    issues = [
        ThemeIssue(file="css/web.css", code="refused_property", message="position", line=3),
        ThemeIssue(file="css/web.css", code="external_url", message="https://x/", line=9),
    ]
    err = ThemeRejected(issues)
    assert err.issues == issues
    text = str(err)
    assert "css/web.css:3" in text
    assert "css/web.css:9" in text


def test_rejection_renders_a_lineless_issue_without_a_stray_colon():
    err = ThemeRejected([ThemeIssue(file="theme.json", code="bad_manifest", message="id is required")])
    assert "theme.json: id is required" in str(err)


def test_issue_is_hashable_so_duplicates_can_be_collapsed():
    a = ThemeIssue(file="css/web.css", code="refused_property", message="position", line=3)
    b = ThemeIssue(file="css/web.css", code="refused_property", message="position", line=3)
    assert len({a, b}) == 1
