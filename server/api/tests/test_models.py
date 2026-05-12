import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from models import User, Machine

def test_user_defaults():
    u = User(email="test@test.com", name="Test", password_hash="hash")
    assert u.email == "test@test.com"
    assert u.id is not None
    assert u.is_active is True

def test_machine_defaults():
    m = Machine(peer_id="123456789", owner_id="some-uuid")
    assert m.peer_id == "123456789"
    assert m.is_online is False
    assert m.name == "My Machine"
    assert m.id is not None
