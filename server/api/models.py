import uuid
import secrets
import string
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, ForeignKey, DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email: Mapped[str] = mapped_column(String, unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    totp_secret: Mapped[str | None] = mapped_column(String, nullable=True)
    totp_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    machines: Mapped[list["Machine"]] = relationship("Machine", back_populates="owner", cascade="all, delete-orphan")

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "is_active" not in kwargs:
            kwargs["is_active"] = True
        if "totp_secret" not in kwargs:
            kwargs["totp_secret"] = None
        if "totp_enabled" not in kwargs:
            kwargs["totp_enabled"] = False
        if "created_at" not in kwargs:
            kwargs["created_at"] = utcnow()
        super().__init__(**kwargs)


class Machine(Base):
    __tablename__ = "machines"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    peer_id: Mapped[str] = mapped_column(String(9), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False, default="My Machine")
    os: Mapped[str | None] = mapped_column(String, nullable=True)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    company_id: Mapped[str | None] = mapped_column(String, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    location_id: Mapped[str | None] = mapped_column(String, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    group_id: Mapped[str | None] = mapped_column(String, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)

    owner: Mapped["User"] = relationship("User", back_populates="machines")

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "name" not in kwargs:
            kwargs["name"] = "My Machine"
        if "is_online" not in kwargs:
            kwargs["is_online"] = False
        if "created_at" not in kwargs:
            kwargs["created_at"] = utcnow()
        if "company_id" not in kwargs:
            kwargs["company_id"] = None
        if "location_id" not in kwargs:
            kwargs["location_id"] = None
        if "group_id" not in kwargs:
            kwargs["group_id"] = None
        super().__init__(**kwargs)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    host_peer_id: Mapped[str] = mapped_column(String(9), nullable=False, index=True)
    viewer_user_id: Mapped[str | None] = mapped_column(
        String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    connection_type: Mapped[str] = mapped_column(String(10), default="p2p")  # p2p | relay
    bytes_transferred: Mapped[int] = mapped_column(default=0)

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "connection_type" not in kwargs:
            kwargs["connection_type"] = "p2p"
        if "bytes_transferred" not in kwargs:
            kwargs["bytes_transferred"] = 0
        if "started_at" not in kwargs:
            kwargs["started_at"] = utcnow()
        super().__init__(**kwargs)


class Branding(Base):
    __tablename__ = "branding"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    brand_name: Mapped[str] = mapped_column(String(100), default="PeerDesk")
    logo_data_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    accent_color: Mapped[str] = mapped_column(String(7), default="#2563eb")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not hasattr(self, 'id') or self.id is None:
            pass
        if not self.brand_name:
            self.brand_name = "PeerDesk"
        if not self.accent_color:
            self.accent_color = "#2563eb"
        if self.updated_at is None:
            self.updated_at = utcnow()


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    locations: Mapped[list["Location"]] = relationship("Location", back_populates="company", cascade="all, delete-orphan")

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "created_at" not in kwargs:
            kwargs["created_at"] = utcnow()
        super().__init__(**kwargs)


class Location(Base):
    __tablename__ = "locations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    company_id: Mapped[str] = mapped_column(String, ForeignKey("companies.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    company: Mapped["Company"] = relationship("Company", back_populates="locations")
    groups: Mapped[list["Group"]] = relationship("Group", back_populates="location", cascade="all, delete-orphan")

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "created_at" not in kwargs:
            kwargs["created_at"] = utcnow()
        super().__init__(**kwargs)


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    location_id: Mapped[str] = mapped_column(String, ForeignKey("locations.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    location: Mapped["Location"] = relationship("Location", back_populates="groups")

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "created_at" not in kwargs:
            kwargs["created_at"] = utcnow()
        super().__init__(**kwargs)


def _gen_token() -> str:
    chars = string.ascii_uppercase + string.digits
    return (''.join(secrets.choice(chars) for _ in range(4)) + '-' +
            ''.join(secrets.choice(chars) for _ in range(4)))


class RegistrationToken(Base):
    __tablename__ = "registration_tokens"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    token: Mapped[str] = mapped_column(String(9), unique=True, nullable=False, default=_gen_token)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    company_id: Mapped[str | None] = mapped_column(String, ForeignKey("companies.id", ondelete="SET NULL"), nullable=True)
    location_id: Mapped[str | None] = mapped_column(String, ForeignKey("locations.id", ondelete="SET NULL"), nullable=True)
    group_id: Mapped[str | None] = mapped_column(String, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True)

    def __init__(self, **kwargs):
        if "id" not in kwargs:
            kwargs["id"] = str(uuid.uuid4())
        if "token" not in kwargs:
            kwargs["token"] = _gen_token()
        if "used_at" not in kwargs:
            kwargs["used_at"] = None
        super().__init__(**kwargs)
