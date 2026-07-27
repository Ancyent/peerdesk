from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from auth import verify_password
from deps import get_db, get_current_user, get_current_membership
from models import User, ApiKey, Membership
from schemas import ApiKeyCreate, ApiKeyOut, ApiKeyListOut, ApiKeyRevealIn, ApiKeyRevealOut
from access import visible_api_keys, assert_admin
import access

router = APIRouter(prefix="/api-keys", tags=["api-keys"])


@router.get("", response_model=list[ApiKeyListOut])
async def list_api_keys(
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    result = await db.execute(
        visible_api_keys(membership).where(ApiKey.is_active == True)
    )
    keys = result.scalars().all()
    counts = dict(
        (await db.execute(access.machine_counts_by_key(membership.account_id))).all()
    )
    return [
        ApiKeyListOut(
            id=k.id,
            key_preview=k.key[:10] + "•" * 16,
            name=k.name,
            auto_approve=k.auto_approve,
            is_active=k.is_active,
            created_at=k.created_at,
            last_used_at=k.last_used_at,
            machine_count=counts.get(k.id, 0),
        )
        for k in keys
    ]


@router.post("", response_model=ApiKeyOut, status_code=201)
async def create_api_key(
    body: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    key = ApiKey(
        name=body.name,
        auto_approve=body.auto_approve,
        created_by=user.id,
        account_id=membership.account_id,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return key


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: str,
    db: AsyncSession = Depends(get_db),
    membership: Membership = Depends(get_current_membership),
):
    assert_admin(membership)
    # 404, not 403 -- a caller must not learn that a key outside their active
    # account exists (consistent with how machines behave; see access.py).
    result = await db.execute(
        visible_api_keys(membership).where(ApiKey.id == key_id)
    )
    key = result.scalar_one_or_none()
    if not key:
        raise HTTPException(404, "API key not found")
    key.is_active = False
    await db.commit()


@router.post("/{key_id}/reveal", response_model=ApiKeyRevealOut)
async def reveal_api_key(
    key_id: str,
    body: ApiKeyRevealIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    membership: Membership = Depends(get_current_membership),
):
    """Return a stored key in full, gated on the caller's own password.

    Possible only because keys are stored in plaintext; see
    docs/SECURITY-NOTES.md. The response is never logged.
    """
    assert_admin(membership)

    result = await db.execute(
        visible_api_keys(membership).where(
            ApiKey.id == key_id, ApiKey.is_active == True
        )
    )
    key = result.scalar_one_or_none()
    if not key:
        # 404, not 403 — a caller must not learn that a key outside their
        # account exists.
        raise HTTPException(404, "API key not found")

    if not verify_password(body.password, user.password_hash):
        raise HTTPException(403, "Invalid password")

    return ApiKeyRevealOut(key=key.key)
