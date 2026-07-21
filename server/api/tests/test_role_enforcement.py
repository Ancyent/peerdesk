"""Every route a member must not reach, asserted to return 403.

Dull by design. This file is the executable form of the endpoint mapping in
the Stage 2 spec, and it guards a hole that is live today: assert_admin has
existed since Stage 1 and is called by zero endpoints.
"""
import pytest

# (method, path, json_body) — each must 403 for a plain member.
ADMIN_ONLY = [
    ("post",   "/companies",                      {"name": "X"}),
    ("patch",  "/companies/co-1",                 {"name": "X"}),
    ("delete", "/companies/co-1",                 None),
    ("post",   "/companies/co-1/locations",       {"name": "X"}),
    ("patch",  "/locations/loc-1",                {"name": "X"}),
    ("delete", "/locations/loc-1",                None),
    ("post",   "/locations/loc-1/groups",         {"name": "X"}),
    ("patch",  "/groups/grp-1",                   {"name": "X"}),
    ("delete", "/groups/grp-1",                   None),
    ("get",    "/api-keys",                       None),
    ("post",   "/api-keys",                       {"name": "K"}),
    ("delete", "/api-keys/key-1",                 None),
    ("post",   "/branding",                       {"brand_name": "X"}),
    ("post",   "/machines/mach-1/approve",        None),
    ("post",   "/machines/mach-1/deny",           None),
    ("delete", "/machines/mach-1",                None),
    ("patch",  "/machines/mach-1/placement",      {"company_id": None}),
]


@pytest.mark.parametrize("method,path,body", ADMIN_ONLY)
async def test_member_is_refused(member_client, method, path, body):
    client, _ = member_client
    kwargs = {"json": body} if body is not None else {}
    r = await getattr(client, method)(path, **kwargs)
    assert r.status_code == 403, (
        f"{method.upper()} {path} returned {r.status_code}, expected 403. "
        f"Body: {r.text}"
    )


MEMBER_ALLOWED = [
    ("get", "/machines"),
    ("get", "/companies"),
    ("get", "/users/me"),
    ("get", "/auth/accounts"),
]


@pytest.mark.parametrize("method,path", MEMBER_ALLOWED)
async def test_member_is_allowed(member_client, method, path):
    """The other half. Without this, someone could make every test above pass
    by refusing members everywhere."""
    client, _ = member_client
    r = await getattr(client, method)(path)
    assert r.status_code == 200, f"{method.upper()} {path} returned {r.status_code}: {r.text}"


async def test_member_cannot_place_a_token_outside_their_subtree(member_client, auth_client):
    """The member may enroll, but only into nodes they can see. Before this
    check, create_token accepted any company_id at all -- including another
    account's -- and redeem_token stamped it onto the machine."""
    client, _ = member_client
    r = await auth_client.post("/companies", json={"name": "Admin Only Co"})
    assert r.status_code == 201, r.text
    hidden_company_id = r.json()["id"]

    r = await client.post("/tokens", json={"company_id": hidden_company_id})
    assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"


async def test_member_can_place_a_token_inside_their_subtree(member_client, auth_client, db):
    """The allowed half — otherwise the check above could pass by refusing
    every placement."""
    from models import AccessGrant
    client, membership_id = member_client
    r = await auth_client.post("/companies", json={"name": "Granted Co"})
    company_id = r.json()["id"]
    db.add(AccessGrant(membership_id=membership_id, company_id=company_id))
    await db.commit()

    r = await client.post("/tokens", json={"company_id": company_id})
    assert r.status_code == 201, r.text
    assert r.json()["company_id"] == company_id
