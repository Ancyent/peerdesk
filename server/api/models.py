import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Boolean, ForeignKey, DateTime
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
