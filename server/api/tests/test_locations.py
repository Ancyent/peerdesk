import pytest


@pytest.mark.anyio
async def test_create_and_list_locations(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    r = await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})
    assert r.status_code == 201
    assert r.json()["name"] == "HQ"
    assert r.json()["company_id"] == co["id"]
    r2 = await auth_client.get(f"/companies/{co['id']}/locations")
    assert len(r2.json()) == 1


@pytest.mark.anyio
async def test_update_location(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    r = await auth_client.patch(f"/locations/{loc['id']}", json={"name": "Depozit"})
    assert r.status_code == 200
    assert r.json()["name"] == "Depozit"


@pytest.mark.anyio
async def test_delete_location(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    r = await auth_client.delete(f"/locations/{loc['id']}")
    assert r.status_code == 204
