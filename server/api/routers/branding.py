from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from deps import get_db, get_current_user
from models import Branding, User
from schemas import BrandingOut, BrandingUpdate

router = APIRouter(prefix="/branding", tags=["branding"])


async def _get_or_create(db: AsyncSession) -> Branding:
    result = await db.execute(select(Branding).where(Branding.id == 1))
    branding = result.scalar_one_or_none()
    if not branding:
        branding = Branding(id=1)
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
):
    """Update branding. Requires authentication."""
    branding = await _get_or_create(db)

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
