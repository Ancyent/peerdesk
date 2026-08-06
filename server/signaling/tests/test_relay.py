"""The relay tuple is a literal list of message types, and a type missing from
it is dropped in silence — which is how multi-monitor signaling stayed broken
for weeks. Assert the membership instead of trusting a read of the file."""
import re
from pathlib import Path


def test_capabilities_is_relayed_to_the_peer():
    source = Path(__file__).resolve().parents[1] / "main.py"
    tuple_body = re.search(r"elif msg_type in \((.*?)\):", source.read_text(), re.S).group(1)
    relayed = set(re.findall(r'"([a-z_]+)"', tuple_body))
    assert "capabilities" in relayed
    # The neighbours the tuple already carries, so an edit that replaces the
    # list instead of extending it fails here rather than in production.
    assert {"offer", "answer", "ice_candidate", "session_mode"} <= relayed
