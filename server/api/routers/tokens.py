from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_current_membership
from models import RegistrationToken, Machine, User, ApiKey, Membership, Company, Location, Group
from schemas import RegistrationTokenCreate, RegistrationTokenOut, TokenRedeemRequest, MachineOut, TokenRedeemResponse
from access import visible_companies, visible_groups, visible_locations

router = APIRouter(prefix="/tokens", tags=["tokens"])


@router.post("", response_model=RegistrationTokenOut, status_code=201)
async def create_token(
    body: RegistrationTokenCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    # Each placement id must be one the caller can actually see. Without this the
    # endpoint accepts any id at all -- including another account's -- and
    # redeem_token then stamps it onto the machine, planting a foreign tree
    # reference. For a member this also confines enrollment to their own subtree.
    await _assert_placement_visible(db, membership, body)

    reg = RegistrationToken(
        created_by=user.id,
        account_id=membership.account_id,
        expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
        company_id=body.company_id,
        location_id=body.location_id,
        group_id=body.group_id,
        name=(body.name.strip() or None) if body.name else None,
    )
    db.add(reg)
    await db.commit()
    await db.refresh(reg)
    return reg


async def _assert_placement_visible(db, membership, body) -> None:
    checks = (
        (body.company_id, visible_companies, Company),
        (body.location_id, visible_locations, Location),
        (body.group_id, visible_groups, Group),
    )
    for target_id, visible, model in checks:
        if target_id is None:
            continue
        found = await db.execute(visible(membership).where(model.id == target_id))
        if found.scalar_one_or_none() is None:
            # 404, not 403: the caller must not learn that an id they cannot
            # reach exists.
            raise HTTPException(404, "Placement target not found")


@router.post("/redeem", response_model=TokenRedeemResponse, status_code=201)
async def redeem_token(body: TokenRedeemRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(RegistrationToken).where(
            RegistrationToken.token == body.token,
            RegistrationToken.used_at.is_(None),
            RegistrationToken.expires_at > datetime.now(timezone.utc),
        ).with_for_update()
    )
    reg = result.scalar_one_or_none()
    if not reg:
        raise HTTPException(400, "Invalid or expired token")

    existing = await db.execute(select(Machine).where(Machine.peer_id == body.peer_id))
    if existing.scalar_one_or_none():
        raise HTTPException(409, "peer_id already registered")

    # A name chosen at token-generation time wins over the agent's hostname default.
    machine_name = reg.name or body.name
    key = ApiKey(name=f"Agent: {machine_name}", auto_approve=True, created_by=reg.created_by, account_id=reg.account_id)
    db.add(key)
    machine = Machine(
        peer_id=body.peer_id, name=machine_name, os=body.os,
        account_id=reg.account_id,
        created_by_id=reg.created_by,
        company_id=reg.company_id, location_id=reg.location_id, group_id=reg.group_id,
        api_key_id=key.id,
    )
    db.add(machine)
    reg.used_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(machine)
    return TokenRedeemResponse(**MachineOut.model_validate(machine).model_dump(), api_key=key.key)
