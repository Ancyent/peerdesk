from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class UserRegister(BaseModel):
    email: EmailStr
    name: str
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


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
    model_config = {"from_attributes": True}


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
