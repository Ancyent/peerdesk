import pyotp
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from deps import get_db, get_current_user
from models import User
from schemas import TOTPSetupResponse, TOTPVerifyRequest

router = APIRouter(prefix="/auth/2fa", tags=["2fa"])


@router.post("/enable", response_model=TOTPSetupResponse)
async def enable_2fa(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.totp_enabled:
        raise HTTPException(400, "2FA is already enabled")
    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    await db.commit()
    totp = pyotp.TOTP(secret)
    qr_uri = totp.provisioning_uri(current_user.email, issuer_name="PeerDesk")
    return TOTPSetupResponse(secret=secret, qr_uri=qr_uri)


@router.post("/confirm")
async def confirm_2fa(
    body: TOTPVerifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.totp_secret:
        raise HTTPException(400, "2FA not set up — call /auth/2fa/enable first")
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid TOTP code")
    current_user.totp_enabled = True
    await db.commit()
    return {"message": "2FA enabled successfully"}


@router.post("/disable")
async def disable_2fa(
    body: TOTPVerifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not current_user.totp_enabled:
        raise HTTPException(400, "2FA is not enabled")
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid TOTP code")
    current_user.totp_secret = None
    current_user.totp_enabled = False
    await db.commit()
    return {"message": "2FA disabled"}
