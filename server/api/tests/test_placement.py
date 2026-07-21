import pytest


@pytest.mark.anyio
async def test_set_placement_to_group(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    grp = (await auth_client.post(f"/locations/{loc['id']}/groups", json={"name": "IT"})).json()
    m = (await auth_client.post("/machines", json={"peer_id": "111111111", "name": "PC-01"})).json()

    # Placement must give the full consistent path -- company_id/location_id
    # left NULL while group_id is set is the inconsistency set_placement now
    # rejects (see test_role_enforcement.py).
    r = await auth_client.patch(
        f"/machines/{m['id']}/placement",
        json={"company_id": co["id"], "location_id": loc["id"], "group_id": grp["id"]},
    )
    assert r.status_code == 200
    assert r.json()["group_id"] == grp["id"]
    assert r.json()["location_id"] == loc["id"]
    assert r.json()["company_id"] == co["id"]


@pytest.mark.anyio
async def test_clear_placement(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    m = (await auth_client.post("/machines", json={"peer_id": "222222222", "name": "PC-02"})).json()
    await auth_client.patch(f"/machines/{m['id']}/placement", json={"company_id": co["id"]})
    r = await auth_client.patch(f"/machines/{m['id']}/placement", json={"company_id": None})
    assert r.status_code == 200
    assert r.json()["company_id"] is None


@pytest.mark.anyio
async def test_set_placement_rejects_inconsistent_group_and_company(auth_client):
    """visible_machines matches company_id/location_id/group_id independently
    with an OR (see access.py), so the three columns must describe one
    consistent path down the tree. Before this check, a machine could be
    placed with group_id set while company_id pointed at a different company
    (or was left NULL) -- invisible to a grant on the company that actually
    contains it, or matched by the wrong grant."""
    co = (await auth_client.post("/companies", json={"name": "Real Co"})).json()
    other_co = (await auth_client.post("/companies", json={"name": "Wrong Co"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    grp = (await auth_client.post(f"/locations/{loc['id']}/groups", json={"name": "IT"})).json()
    m = (await auth_client.post("/machines", json={"peer_id": "333333333", "name": "PC-03"})).json()

    # group_id's real company is `co`, but company_id claims `other_co`.
    r = await auth_client.patch(
        f"/machines/{m['id']}/placement",
        json={"company_id": other_co["id"], "location_id": loc["id"], "group_id": grp["id"]},
    )
    assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"

    # Same bug, minimal form: group_id set, location_id/company_id both left NULL.
    r2 = await auth_client.patch(
        f"/machines/{m['id']}/placement",
        json={"group_id": grp["id"]},
    )
    assert r2.status_code == 400, f"expected 400, got {r2.status_code}: {r2.text}"

    # location_id set but company_id doesn't match its actual company.
    r3 = await auth_client.patch(
        f"/machines/{m['id']}/placement",
        json={"company_id": other_co["id"], "location_id": loc["id"]},
    )
    assert r3.status_code == 400, f"expected 400, got {r3.status_code}: {r3.text}"
