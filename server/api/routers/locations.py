from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_membership
from models import Location, Company, Membership
from schemas import LocationCreate, LocationOut
import access

router = APIRouter(tags=["locations"])


@router.get("/companies/{company_id}/locations", response_model=list[LocationOut])
async def list_locations(company_id: str, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    co = (await db.execute(access.visible_companies(membership).where(Company.id == company_id))).scalar_one_or_none()
    if not co:
        raise HTTPException(404, "Company not found")
    result = await db.execute(access.visible_locations(membership).where(Location.company_id == company_id))
    return result.scalars().all()


@router.post("/companies/{company_id}/locations", response_model=LocationOut, status_code=201)
async def create_location(company_id: str, body: LocationCreate, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    co = (await db.execute(access.visible_companies(membership).where(Company.id == company_id))).scalar_one_or_none()
    if not co:
        raise HTTPException(404, "Company not found")
    loc = Location(name=body.name, company_id=company_id)
    db.add(loc)
    await db.commit()
    await db.refresh(loc)
    return loc


@router.patch("/locations/{location_id}", response_model=LocationOut)
async def update_location(location_id: str, body: LocationCreate, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    result = await db.execute(access.visible_locations(membership).where(Location.id == location_id))
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(404, "Location not found")
    loc.name = body.name
    await db.commit()
    await db.refresh(loc)
    return loc


@router.delete("/locations/{location_id}", status_code=204)
async def delete_location(location_id: str, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    result = await db.execute(access.visible_locations(membership).where(Location.id == location_id))
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(404, "Location not found")
    await db.delete(loc)
    await db.commit()
