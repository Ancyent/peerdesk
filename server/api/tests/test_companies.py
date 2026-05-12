import pytest


@pytest.mark.anyio
async def test_list_companies_empty(auth_client):
    r = await auth_client.get("/companies")
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.anyio
async def test_create_company(auth_client):
    r = await auth_client.post("/companies", json={"name": "Firma ABC"})
    assert r.status_code == 201
    assert r.json()["name"] == "Firma ABC"
    assert "id" in r.json()


@pytest.mark.anyio
async def test_list_after_create(auth_client):
    await auth_client.post("/companies", json={"name": "Firma ABC"})
    r = await auth_client.get("/companies")
    assert len(r.json()) == 1


@pytest.mark.anyio
async def test_update_company(auth_client):
    r = await auth_client.post("/companies", json={"name": "Firma ABC"})
    cid = r.json()["id"]
    r2 = await auth_client.patch(f"/companies/{cid}", json={"name": "Firma XYZ"})
    assert r2.status_code == 200
    assert r2.json()["name"] == "Firma XYZ"


@pytest.mark.anyio
async def test_delete_company(auth_client):
    r = await auth_client.post("/companies", json={"name": "Firma"})
    await auth_client.delete(f"/companies/{r.json()['id']}")
    r2 = await auth_client.get("/companies")
    assert r2.json() == []


@pytest.mark.anyio
async def test_company_requires_auth(client):
    r = await client.get("/companies")
    assert r.status_code == 403
