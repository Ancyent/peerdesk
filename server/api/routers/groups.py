from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_membership
from models import Group, Location, Company, Membership
from schemas import GroupCreate, GroupOut
from access import assert_admin
import access

router = APIRouter(tags=["groups"])


async def _visible_location(location_id: str, membership: Membership, db: AsyncSession) -> Location:
    result = await db.execute(access.visible_locations(membership).where(Location.id == location_id))
    loc = result.scalar_one_or_none()
    if not loc:
        raise HTTPException(404, "Location not found")
    return loc


async def _visible_group(group_id: str, membership: Membership, db: AsyncSession) -> Group:
    result = await db.execute(access.visible_groups(membership).where(Group.id == group_id))
    grp = result.scalar_one_or_none()
    if not grp:
        raise HTTPException(404, "Group not found")
    return grp


@router.get("/locations/{location_id}/groups", response_model=list[GroupOut])
async def list_groups(location_id: str, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    await _visible_location(location_id, membership, db)
    result = await db.execute(access.visible_groups(membership).where(Group.location_id == location_id))
    return result.scalars().all()


@router.post("/locations/{location_id}/groups", response_model=GroupOut, status_code=201)
async def create_group(location_id: str, body: GroupCreate, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    assert_admin(membership)
    await _visible_location(location_id, membership, db)
    group = Group(name=body.name, location_id=location_id)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.patch("/groups/{group_id}", response_model=GroupOut)
async def update_group(group_id: str, body: GroupCreate, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    assert_admin(membership)
    group = await _visible_group(group_id, membership, db)
    group.name = body.name
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/groups/{group_id}", status_code=204)
async def delete_group(group_id: str, db: AsyncSession = Depends(get_db), membership: Membership = Depends(get_current_membership)):
    assert_admin(membership)
    group = await _visible_group(group_id, membership, db)
    await db.delete(group)
    await db.commit()

    # AccessGrant's tree FK is ON DELETE CASCADE, so any grant directly on
    # this group just vanished with it -- a revocation performed by the
    # database with no sync. See access.sync_saved_passwords_for_account.
    await access.sync_saved_passwords_for_account(db, membership.account_id)
