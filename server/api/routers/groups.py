from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user
from models import Group, Location, Company, User
from schemas import GroupCreate, GroupOut

router = APIRouter(tags=["groups"])


async def _owned_location(location_id: str, user_id: str, db: AsyncSession) -> Location:
    result = await db.execute(
        select(Location).join(Company, Location.company_id == Company.id)
        .where(Location.id == location_id, Company.owner_id == user_id)
    )
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(404, "Location not found")
    return loc


async def _owned_group(group_id: str, user_id: str, db: AsyncSession) -> Group:
    result = await db.execute(
        select(Group).join(Location, Group.location_id == Location.id)
        .join(Company, Location.company_id == Company.id)
        .where(Group.id == group_id, Company.owner_id == user_id)
    )
    grp = result.scalar_one_or_none()
    if not grp:
        raise HTTPException(404, "Group not found")
    return grp


@router.get("/locations/{location_id}/groups", response_model=list[GroupOut])
async def list_groups(location_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _owned_location(location_id, user.id, db)
    result = await db.execute(select(Group).where(Group.location_id == location_id))
    return result.scalars().all()


@router.post("/locations/{location_id}/groups", response_model=GroupOut, status_code=201)
async def create_group(location_id: str, body: GroupCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _owned_location(location_id, user.id, db)
    group = Group(name=body.name, location_id=location_id)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(group_id: str, body: GroupCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    group = await _owned_group(group_id, user.id, db)
    group.name = body.name
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    group = await _owned_group(group_id, user.id, db)
    await db.delete(group)
    await db.commit()
