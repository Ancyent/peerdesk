from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from deps import get_db, get_current_user, get_current_membership
from models import Account, Branding, Membership, User
from schemas import BrandingOut, BrandingUpdate
from access import assert_admin, branding_for_account

router = APIRouter(prefix="/branding", tags=["branding"])


async def _first_account_id(db: AsyncSession) -> str | None:
    result = await db.execute(select(Account.id).order_by(Account.created_at).limit(1))
    return result.scalar_one_or_none()


async def _get_or_create(db: AsyncSession, account_id: str | None = None) -> Branding:
    """Branding is per-account: each account gets its own row, looked up by
    account_id — not a single shared row every tenant reads and writes.

    update_branding is authenticated and always passes the caller's own
    membership.account_id, so writes only ever touch that account's row.

    get_branding is public (the login page calls it before anyone is
    authenticated), so it has no account to scope to. It falls back to the
    oldest account's row for display purposes — the same fallback 0013 uses
    for orphan rows — so a single-tenant deployment's login page still shows
    whatever branding was configured. If that account has no row yet, or no
    account exists at all (fresh install, nobody registered), in-memory
    defaults are returned without persisting anything.
    """
    resolved_account_id = account_id if account_id is not None else await _first_account_id(db)
    if resolved_account_id is None:
        # Fresh install: nobody has registered yet, so no account exists at all.
        return Branding()

    result = await db.execute(branding_for_account(resolved_account_id))
    branding = result.scalar_one_or_none()
    if branding:
        return branding

    if account_id is None:
        # Public read, and the fallback account has never configured branding.
        # Don't create a row on its behalf — just show defaults.
        return Branding()

    branding = Branding(account_id=account_id)
    db.add(branding)
    try:
        await db.commit()
    except IntegrityError:
        # Lost a race against another request creating this account's row
        # concurrently (branding.account_id is UNIQUE — see migration 0015).
        # The other request's commit already succeeded, so read its row back
        # instead of surfacing an error for a race this caller did not cause.
        await db.rollback()
        result = await db.execute(branding_for_account(account_id))
        return result.scalar_one()
    await db.refresh(branding)
    return branding


@router.get("", response_model=BrandingOut)
async def get_branding(db: AsyncSession = Depends(get_db)):
    """Public — returns current branding config."""
    return await _get_or_create(db)


@router.post("", response_model=BrandingOut)
async def update_branding(
    body: BrandingUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    """Update branding. Requires authentication and the admin role."""
    assert_admin(membership)
    branding = await _get_or_create(db, account_id=membership.account_id)

    if body.brand_name is not None:
        if not body.brand_name.strip():
            raise HTTPException(400, "brand_name cannot be empty")
        branding.brand_name = body.brand_name.strip()

    if body.logo_data_url is not None:
        branding.logo_data_url = body.logo_data_url if body.logo_data_url else None

    if body.accent_color is not None:
        color = body.accent_color.strip()
        if not (color.startswith("#") and len(color) in (4, 7) and
                all(c in "0123456789abcdefABCDEF" for c in color[1:])):
            raise HTTPException(400, "accent_color must be a valid hex color like #2563eb")
        branding.accent_color = color

    from datetime import datetime, timezone
    branding.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(branding)
    return branding
