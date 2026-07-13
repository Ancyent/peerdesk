from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class UserRegister(BaseModel):
    email: EmailStr
    name: str
    password: str
    remember_me: bool = False


class UserLogin(BaseModel):
    email: EmailStr
    password: str
    remember_me: bool = False


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    requires_2fa: bool = False
    temp_token: Optional[str] = None


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    created_at: datetime
    model_config = {"from_attributes": True}


class MachineRegister(BaseModel):
    peer_id: str
    name: str = "My Machine"
    os: Optional[str] = None


class MachineOut(BaseModel):
    id: str
    peer_id: str
    name: str
    os: Optional[str]
    is_online: bool
    last_seen_at: Optional[datetime]
    created_at: datetime
    company_id: Optional[str] = None
    location_id: Optional[str] = None
    group_id: Optional[str] = None
    approval_status: str = "approved"
    api_key_id: Optional[str] = None
    has_saved_password: bool = False
    model_config = {"from_attributes": True}


class SavedPasswordIn(BaseModel):
    password: str


class SavedPasswordOut(BaseModel):
    password: str


class TokenRedeemResponse(MachineOut):
    api_key: str


class RefreshRequest(BaseModel):
    refresh_token: str


class SessionStart(BaseModel):
    host_peer_id: str
    viewer_user_id: Optional[str] = None
    connection_type: str = "p2p"


class SessionOut(BaseModel):
    id: str
    host_peer_id: str
    viewer_user_id: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]
    connection_type: str
    bytes_transferred: int
    model_config = {"from_attributes": True}


class TOTPSetupResponse(BaseModel):
    secret: str
    qr_uri: str


class TOTPVerifyRequest(BaseModel):
    code: str


class LoginStep2Request(BaseModel):
    temp_token: str
    code: str
    remember_me: bool = False


class BrandingOut(BaseModel):
    brand_name: str
    logo_data_url: Optional[str]
    accent_color: str
    model_config = {"from_attributes": True}


class BrandingUpdate(BaseModel):
    brand_name: Optional[str] = None
    logo_data_url: Optional[str] = None
    accent_color: Optional[str] = None


class CompanyCreate(BaseModel):
    name: str


class CompanyOut(BaseModel):
    id: str
    name: str
    owner_id: str
    created_at: datetime
    model_config = {"from_attributes": True}


class LocationCreate(BaseModel):
    name: str


class LocationOut(BaseModel):
    id: str
    name: str
    company_id: str
    created_at: datetime
    model_config = {"from_attributes": True}


class GroupCreate(BaseModel):
    name: str


class GroupOut(BaseModel):
    id: str
    name: str
    location_id: str
    created_at: datetime
    model_config = {"from_attributes": True}


class MachinePlacement(BaseModel):
    company_id: Optional[str] = None
    location_id: Optional[str] = None
    group_id: Optional[str] = None


class RegistrationTokenCreate(BaseModel):
    company_id: Optional[str] = None
    location_id: Optional[str] = None
    group_id: Optional[str] = None


class RegistrationTokenOut(BaseModel):
    id: str
    token: str
    expires_at: datetime
    used_at: Optional[datetime]
    company_id: Optional[str]
    location_id: Optional[str]
    group_id: Optional[str]
    model_config = {"from_attributes": True}


class TokenRedeemRequest(BaseModel):
    token: str
    peer_id: str
    name: str = "My Machine"
    os: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class ApiKeyCreate(BaseModel):
    name: str = "Default Key"
    auto_approve: bool = False


class ApiKeyOut(BaseModel):
    id: str
    key: str
    name: str
    auto_approve: bool
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime]

    model_config = {"from_attributes": True}


class ApiKeyListOut(BaseModel):
    id: str
    key_preview: str   # first 10 chars of key, e.g. "pd_abc123de..."
    name: str
    auto_approve: bool
    is_active: bool
    created_at: datetime
    last_used_at: Optional[datetime]

    model_config = {"from_attributes": False}


class MachineRegisterViaKey(BaseModel):
    peer_id: str
    name: str = "My Machine"
    os: Optional[str] = None


class MachineApprovalStatus(BaseModel):
    peer_id: str
    approval_status: str  # pending | approved | denied


class LogoutRequest(BaseModel):
    refresh_token: str
