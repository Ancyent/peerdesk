from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user, get_current_membership
from models import Account, Branding, Membership, User
from schemas import BrandingOut, BrandingUpdate

router = APIRouter(prefix="/branding", tags=["branding"])


async def _first_account_id(db: AsyncSession) -> str | None:
    result = await db.execute(select(Account.id).order_by(Account.created_at).limit(1))
    return result.scalar_one_or_none()


async def _get_or_create(db: AsyncSession, account_id: str | None = None) -> Branding:
    """Branding is a single, install-wide row (id=1), not per-account — there is
    no visible_branding() in access.py because nothing filters it by account.
    account_id is NOT NULL though, so creating the row still needs *an* account
    to attach to: the caller's own account when known (update_branding), or
    else the oldest account in the system (get_branding, which is public and
    has no caller identity — same fallback migration 0013 uses for orphans).
    """
    result = await db.execute(select(Branding).where(Branding.id == 1))
    branding = result.scalar_one_or_none()
    if branding:
        return branding

    resolved_account_id = account_id or await _first_account_id(db)
    if resolved_account_id is None:
        # Fresh install: nobody has registered yet, so no account exists at all.
        # Return in-memory defaults without persisting — there is nothing valid
        # to put in account_id yet. The row gets created for real the first
        # time an authenticated call (e.g. registration, or update_branding)
        # has an account to attach it to.
        return Branding(id=1)

    branding = Branding(id=1, account_id=resolved_account_id)
    db.add(branding)
    await db.commit()
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
    """Update branding. Requires authentication."""
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
