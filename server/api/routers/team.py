"""Members and invitations -- the two things an admin administers to bring a
colleague onto the account. All routes are admin-only; a member receives 403
and the UI never shows them the page.

Every account_id (and created_by_id/created_by) comparison here goes through
access.py's visible_* / get_*_in_account helpers rather than being hand-built
-- see access.py's module docstring and tests/test_access.py's guard test.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from access import (
    assert_admin, count_admins, get_invitation_in_account, get_membership_in_account,
    sync_saved_passwords, visible_invitations, visible_memberships,
)
from deps import get_current_membership, get_current_user, get_db
from models import Invitation, Membership, User
from schemas import (
    InvitationCreate, InvitationCreatedOut, InvitationOut,
    TeamMemberOut, TeamMemberRoleUpdate,
)

router = APIRouter(prefix="/team", tags=["team"])

INVITE_TTL = timedelta(days=7)


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _member_out(mem: Membership, user: User) -> TeamMemberOut:
    return TeamMemberOut(
        membership_id=mem.id, user_id=user.id, name=user.name,
        email=user.email, role=mem.role, created_at=mem.created_at,
    )


@router.get("/members", response_model=list[TeamMemberOut])
async def list_members(
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(visible_memberships(membership).order_by(Membership.created_at))
    return [_member_out(mem, user) for mem, user in result.all()]


@router.patch("/members/{membership_id}", response_model=TeamMemberOut)
async def update_member_role(
    membership_id: str,
    body: TeamMemberRoleUpdate,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    target = await get_membership_in_account(db, membership, membership_id)

    if (target.role == "admin" and body.role != "admin"
            and await count_admins(db, membership.account_id) == 1):
        raise HTTPException(400, "An account must keep at least one admin")

    target.role = body.role
    await db.commit()

    # Demotion shrinks what they can see, so stored credentials for machines
    # they just lost must go. Promotion widens it and deletes nothing.
    await sync_saved_passwords(db, target)

    user = (await db.execute(select(User).where(User.id == target.user_id))).scalar_one()
    return _member_out(target, user)


@router.delete("/members/{membership_id}", status_code=204)
async def remove_member(
    membership_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    target = await get_membership_in_account(db, membership, membership_id)

    if target.role == "admin" and await count_admins(db, membership.account_id) == 1:
        raise HTTPException(400, "An account must keep at least one admin")

    # Grants and saved passwords are anchored to membership_id with ON DELETE
    # CASCADE, so removing the membership removes both.
    await db.delete(target)
    await db.commit()


@router.get("/invitations", response_model=list[InvitationOut])
async def list_invitations(
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(visible_invitations(membership).order_by(Invitation.created_at.desc()))
    return list(result.scalars().all())


@router.post("/invitations", response_model=InvitationCreatedOut, status_code=201)
async def create_invitation(
    body: InvitationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    token = secrets.token_urlsafe(32)
    inv = Invitation(
        account_id=membership.account_id,
        token_hash=hash_invite_token(token),
        email=(body.email or None),
        role=body.role,
        expires_at=datetime.now(timezone.utc) + INVITE_TTL,
        created_by_id=user.id,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)
    return InvitationCreatedOut(
        id=inv.id, email=inv.email, role=inv.role,
        expires_at=inv.expires_at, created_at=inv.created_at, token=token,
    )


@router.delete("/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    invitation_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    inv = await get_invitation_in_account(db, membership, invitation_id)
    await db.delete(inv)
    await db.commit()
