import pytest


async def _setup(auth_client):
    co = (await auth_client.post("/companies", json={"name": "Firma"})).json()
    loc = (await auth_client.post(f"/companies/{co['id']}/locations", json={"name": "HQ"})).json()
    return loc["id"]


@pytest.mark.anyio
async def test_create_and_list_groups(auth_client):
    lid = await _setup(auth_client)
    r = await auth_client.post(f"/locations/{lid}/groups", json={"name": "IT"})
    assert r.status_code == 201
    assert r.json()["name"] == "IT"
    r2 = await auth_client.get(f"/locations/{lid}/groups")
    assert len(r2.json()) == 1


@pytest.mark.anyio
async def test_update_group(auth_client):
    lid = await _setup(auth_client)
    grp = (await auth_client.post(f"/locations/{lid}/groups", json={"name": "IT"})).json()
    r = await auth_client.patch(f"/groups/{grp['id']}", json={"name": "Dev"})
    assert r.status_code == 200
    assert r.json()["name"] == "Dev"


@pytest.mark.anyio
async def test_delete_group(auth_client):
    lid = await _setup(auth_client)
    grp = (await auth_client.post(f"/locations/{lid}/groups", json={"name": "IT"})).json()
    r = await auth_client.delete(f"/groups/{grp['id']}")
    assert r.status_code == 204
