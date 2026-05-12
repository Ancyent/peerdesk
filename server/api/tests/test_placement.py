import pytest


@pytest.mark.anyio
async def test_set_placement_to_group(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    grp = (await auth_client.post(f"/locations/{loc['id']}/groups", json={"name": "IT"})).json()
    m = (await auth_client.post("/machines", json={"peer_id": "111111111", "name": "PC-01"})).json()

    r = await auth_client.patch(f"/machines/{m['id']}/placement", json={"group_id": grp["id"]})
    assert r.status_code == 200
    assert r.json()["group_id"] == grp["id"]
    assert r.json()["company_id"] is None


@pytest.mark.anyio
async def test_clear_placement(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    m = (await auth_client.post("/machines", json={"peer_id": "222222222", "name": "PC-02"})).json()
    await auth_client.patch(f"/machines/{m['id']}/placement", json={"company_id": co["id"]})
    r = await auth_client.patch(f"/machines/{m['id']}/placement", json={"company_id": None})
    assert r.status_code == 200
    assert r.json()["company_id"] is None
